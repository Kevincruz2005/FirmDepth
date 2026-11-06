import {readFile,writeFile} from "node:fs/promises";
import {network} from "hardhat";
import {buildFirmQuote} from "../../sdk/dist/quote.js";
import {firmQuoteTypedData} from "../../sdk/dist/eip712.js";
import {getDebtRepaymentReceipt,authenticateDebtRepayment} from "../../sdk/dist/debt-repayment.js";
import {createPublicClient,http} from "viem";
import {AAVE_POOL_ABI,AAVE_DEBT_ABI,verifyAaveBase} from "./lib/aave-base.ts";
import {buildAquaOrder,encodeAquaStrategy,buildSoftTakerTraits} from "./lib/base-fork.ts";
const {ethers}=await network.create();
const runtime=JSON.parse(await readFile("../frontend/.runtime/firmdepth.json","utf8"));
if(runtime.environment.kind!=="base-fork"||!runtime.debtRepayment)throw Error("Run setup-debt-fork.ts on the canonical local fork first");
const config=runtime.debtRepayment;
const [,maker,payer,drainer]=await ethers.getSigners();
const payerAddress=await payer.getAddress();
const adapter=await ethers.getContractAt("ProtectedDebtRepayment",config.address,payer);
const settlement=await ethers.getContractAt("ProtectedSettlement",runtime.settlement.address);
const registry=await ethers.getContractAt("FirmCommitmentRegistry",runtime.addresses.registry);
const vault=await ethers.getContractAt("BondVault",runtime.addresses.bondVault);
const router=await ethers.getContractAt("FirmAquaSwapVMRouter",runtime.addresses.firmRouter);
const pool=new ethers.Contract(config.pool,AAVE_POOL_ABI,payer);
const debt=new ethers.Contract(config.variableDebtToken,AAVE_DEBT_ABI,ethers.provider);
const tokenAbi=["function balanceOf(address) view returns(uint256)","function approve(address,uint256) returns(bool)","function transfer(address,uint256) returns(bool)","function allowance(address,address) view returns(uint256)"];
const usdc=new ethers.Contract(runtime.addresses.usdc,[...tokenAbi,"function blacklister() view returns(address)","function blacklist(address)","function unBlacklist(address)"],payer);
const weth=new ethers.Contract(runtime.addresses.weth,tokenAbi,payer);
const firm=runtime.strategies.find((s:any)=>s.kind==="FIRM");
const order={...firm.order,traits:BigInt(firm.order.traits)};
const client=createPublicClient({transport:http(runtime.rpcUrl)});
await verifyAaveBase(ethers.provider,runtime.addresses.usdc);
await authenticateDebtRepayment(client,config.address,{settlement:runtime.settlement.address,...runtime.addresses});
const evidence:any={environment:"LOCAL BASE FORK — REAL AAVE CONTRACTS, NOT PUBLIC MAINNET OR SEPOLIA",chainId:8453,forkBlock:runtime.forkBlock,baseline:"2d823188e981ea44f97dd6421fe2c1638ea8d027",recordedAt:new Date().toISOString(),deployment:{adapterTransactionHash:config.deploymentTransactionHash,adapterBlock:config.deploymentBlock,settlementTransactionHash:runtime.settlement.deploymentTransactionHash,coreDeploymentBlock:runtime.deploymentBlock},addresses:{...runtime.addresses,settlement:runtime.settlement.address,repayment:config.address,pool:config.pool,variableDebtToken:config.variableDebtToken,aToken:config.aToken},borrower:payerAddress,supplyTransaction:config.supplyTransactionHash,borrowTransaction:config.borrowTransactionHash,initialDebt:config.initialDebt,scenarios:[]};
async function wait(tx:any){const r=await tx.wait();if(!r||r.status!==1)throw Error("Transaction failed");return r;}
await wait(await weth.approve(config.address,ethers.MaxUint256));
async function accept(nonce:bigint,maxRepay:bigint,minRepay:bigint,input:bigint,output:bigint){
 const before=(await ethers.provider.getBlock("latest"))!;
 const id=await adapter.planIdFor(payerAddress,nonce);
 const created=await wait(await adapter.createRepaymentPlan(nonce,payerAddress,runtime.addresses.usdc,2,input,ethers.parseEther("0.002"),before.timestamp+3600,maxRepay,minRepay));
 const funded=await wait(await adapter.fundPlan(id));
 const block=(await ethers.provider.getBlock("latest"))!;
 const requiredBond=output*120n/100n;
 const quote=buildFirmQuote({maker:await maker.getAddress(),taker:runtime.settlement.address,executor:runtime.addresses.executor,swapRouter:runtime.addresses.firmRouter,orderHash:firm.orderHash,tokenIn:runtime.addresses.weth,tokenOut:runtime.addresses.usdc,amountIn:input,referenceAmountOut:output,minAmountOut:output,requiredBond,premiumToken:runtime.addresses.weth,sigmaWad:800_000_000_000_000_000n,annualCapitalRateWad:100_000_000_000_000_000n,capacityKBps:10,utilizationAfterWad:await registry.utilizationAfter(await maker.getAddress(),requiredBond),minPremiumOut:1n,expiry:BigInt(block.timestamp+120),nonce},BigInt(block.timestamp));
 const typed=firmQuoteTypedData(runtime.addresses.registry,8453,quote);
 const signature=await maker.signTypedData(typed.domain,typed.types,typed.message);
 const accepted=await wait(await adapter.acceptPlan(id,quote,order,signature));
 const plan=await settlement.getPlan(id);
 if(plan.commitmentId===ethers.ZeroHash||plan.payer.toLowerCase()!==config.address.toLowerCase())throw Error("Adapter plan is not bound to the accepted wrapper commitment");
 console.log("Accepted repayment",id,"commitment",plan.commitmentId);
 return {id,commitmentId:plan.commitmentId,create:created.hash,fund:funded.hash,accept:accepted.hash};
}
async function execute(plan:any,expectedPath:"AQUA"|"BOND",label:string){
 const before={debt:await debt.balanceOf(payerAddress),scaledDebt:await debt.scaledBalanceOf(payerAddress),payerUsdc:await usdc.balanceOf(payerAddress),aTokenUsdc:await usdc.balanceOf(config.aToken)};
 const execution=await wait(await adapter.executePlan(plan.id,order));
 const verified=await getDebtRepaymentReceipt(client,config.address,plan.id,execution.hash,BigInt(runtime.deploymentBlock));
 if(verified.path!==expectedPath||verified.actualRepaid===0n)throw Error("Unexpected actual Aave repayment path");
 const after={debt:await debt.balanceOf(payerAddress),scaledDebt:await debt.scaledBalanceOf(payerAddress),payerUsdc:await usdc.balanceOf(payerAddress),aTokenUsdc:await usdc.balanceOf(config.aToken)};
 if(after.scaledDebt>=before.scaledDebt||after.aTokenUsdc-before.aTokenUsdc!==verified.actualRepaid||after.payerUsdc-before.payerUsdc!==verified.usdcRefund)throw Error("Actual debt or token balances do not reconcile");
 evidence.scenarios.push({label,...plan,execute:execution.hash,block:execution.blockNumber,...verified,before,after});
 console.log("Verified",label,verified.actualRepaid.toString(),"USDC base units via",verified.path,"transaction",execution.hash);
 return verified;
}
const normal=await accept(2001n,200_000_000n,200_000_000n,ethers.parseEther("0.1"),200_000_000n);
await execute(normal,"AQUA","Aqua-backed variable debt repayment");
const covered=await accept(2002n,200_000_000n,200_000_000n,ethers.parseEther("0.1"),200_000_000n);
const aqua=new ethers.Contract(runtime.addresses.aqua,["function ship(address,bytes,address[],uint256[]) returns(bytes32)"],maker);
const sibling=buildAquaOrder(await maker.getAddress(),runtime.addresses.weth,runtime.addresses.usdc,ethers.concat(["0x5000","0x0208",ethers.toBeHex(99,8)]));
const drainAmount=await usdc.balanceOf(await maker.getAddress())-100_000_000n;
await wait(await aqua.ship(runtime.addresses.firmRouter,encodeAquaStrategy(sibling),[runtime.addresses.weth,runtime.addresses.usdc],[0,drainAmount]));
await wait(await weth.connect(drainer).approve(runtime.addresses.firmRouter,ethers.parseEther("1")));
const drain=await wait(await router.connect(drainer).swap(sibling,ethers.parseEther("1"),buildSoftTakerTraits(runtime.addresses.weth,runtime.addresses.usdc)));
const inventory=await usdc.balanceOf(await maker.getAddress());
if(inventory>=200_000_000n)throw Error("Sibling Aqua swap did not deplete shared maker inventory");
evidence.siblingDrain={transactionHash:drain.hash,makerUsdcAfter:inventory};
await execute(covered,"BOND","Bond-backed repayment after real sibling Aqua drain");
// Restore trading inventory with a real transfer from the funded test borrower.
const restored=await wait(await usdc.transfer(await maker.getAddress(),400_000_000n));
evidence.inventoryRestored={transactionHash:restored.hash,source:"Borrower's previously borrowed USDC; no token mint or storage modification"};
const partial=await accept(2003n,300_000_000n,1n,ethers.parseEther("0.15"),300_000_000n);
const partialReceipt=await execute(partial,"AQUA","Debt below authorized cap with exact surplus refund");
if(partialReceipt.actualRepaid>=300_000_000n||partialReceipt.usdcRefund===0n||await debt.scaledBalanceOf(payerAddress)!==0n)throw Error("Partial repayment did not close the smaller debt and refund surplus");
const reborrow=await wait(await pool.borrow(runtime.addresses.usdc,100_000_000n,2,0,payerAddress));
evidence.reborrow=reborrow.hash;
const expired=await accept(2004n,100_000_000n,1n,ethers.parseEther("0.05"),100_000_000n);
const wethBeforeRefund=await weth.balanceOf(payerAddress);
const escrow=(await settlement.getPlan(expired.id)).escrow;
const scaledBeforeExpiry=await debt.scaledBalanceOf(payerAddress);
await ethers.provider.send("evm_increaseTime",[121]);await ethers.provider.send("evm_mine",[]);
const refund=await wait(await adapter.refundPlan(expired.id));
if(await weth.balanceOf(payerAddress)!==wethBeforeRefund+escrow||await debt.scaledBalanceOf(payerAddress)!==scaledBeforeExpiry||Number((await registry.getCommitment(expired.commitmentId)).status)!==4)throw Error("Expiry changed debt or misdirected refund");
evidence.expiry={...expired,refund:refund.hash,wethRefund:escrow,scaledDebtUnchanged:scaledBeforeExpiry};
const rollback=await accept(2005n,50_000_000n,1n,ethers.parseEther("0.05"),100_000_000n);
const blacklisterAddress=await usdc.blacklister();
await ethers.provider.send("hardhat_setBalance",[blacklisterAddress,ethers.toQuantity(ethers.parseEther("1"))]);
await ethers.provider.send("hardhat_impersonateAccount",[blacklisterAddress]);
const blacklister=await ethers.getSigner(blacklisterAddress);
let failedHash:string|undefined;
const failureBefore={scaledDebt:await debt.scaledBalanceOf(payerAddress),aTokenUsdc:await usdc.balanceOf(config.aToken),escrow:(await settlement.getPlan(rollback.id)).escrow,locked:await vault.totalLocked()};
try{
 await wait(await usdc.connect(blacklister).blacklist(payerAddress));
 const prior=await ethers.provider.getBlockNumber();
 try{failedHash=await ethers.provider.send("eth_sendTransaction",[{from:payerAddress,to:config.address,data:adapter.interface.encodeFunctionData("executePlan",[rollback.id,order]),gas:"0x3d0900"}]);}catch{}
 if(!failedHash){const b=await ethers.provider.getBlock("latest");if(b&&b.number>prior)failedHash=b.transactions.at(-1);}
 if(!failedHash||(await ethers.provider.getTransactionReceipt(failedHash))?.status!==0)throw Error("Refund failure did not produce a mined reverted transaction");
 if(await debt.scaledBalanceOf(payerAddress)!==failureBefore.scaledDebt||await usdc.balanceOf(config.aToken)!==failureBefore.aTokenUsdc||(await settlement.getPlan(rollback.id)).escrow!==failureBefore.escrow||await vault.totalLocked()!==failureBefore.locked||Number((await registry.getCommitment(rollback.commitmentId)).status)!==1)throw Error("Failure did not atomically preserve Aave debt, reserve tokens, principal and collateral");
 evidence.safeFailure={...rollback,transactionHash:failedHash,status:0,faultInjection:"Local-fork impersonation of the real USDC blacklister blocks only the payer's surplus refund, after Pool.repay. Real Pool and token bytecode remain unchanged.",...failureBefore};
}finally{
 await wait(await usdc.connect(blacklister).unBlacklist(payerAddress));
 await ethers.provider.send("hardhat_stopImpersonatingAccount",[blacklisterAddress]);
}
await execute(rollback,"AQUA","Retry after refund failure preserves one-time repayment");
if(await settlement.totalEscrow()!==0n||await vault.totalLocked()!==0n||await usdc.balanceOf(config.address)!==0n||await weth.balanceOf(config.address)!==0n||await usdc.allowance(config.address,config.pool)!==0n)throw Error("Residual escrow, output, or Pool approval");
evidence.final={debt:await debt.balanceOf(payerAddress),scaledDebt:await debt.scaledBalanceOf(payerAddress),payerUsdc:await usdc.balanceOf(payerAddress),vaultBalance:await usdc.balanceOf(runtime.addresses.bondVault),vaultLiabilities:await vault.liabilities(),adapterUsdc:await usdc.balanceOf(config.address),adapterWeth:await weth.balanceOf(config.address)};
if(evidence.final.vaultBalance!==evidence.final.vaultLiabilities)throw Error("Bond liabilities do not reconcile");
await writeFile("evidence/protected-debt-base-fork.json",JSON.stringify(evidence,(_,value)=>typeof value==="bigint"?value.toString():value,2)+"\n");
console.log("Verified real Aave repayments through Aqua and covered bond, partial repayment, expiry and atomic refund rollback.");
