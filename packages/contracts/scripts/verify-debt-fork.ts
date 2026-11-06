import {readFile,writeFile} from "node:fs/promises";
import {network} from "hardhat";
import {createPublicClient,http} from "viem";
import {authenticateDebtRepayment,getDebtRepaymentReceipt,readDebtPlan} from "../../sdk/dist/debt-repayment.js";
import {verifyAaveBase,AAVE_DEBT_ABI,AAVE_POOL_ABI} from "./lib/aave-base.ts";
const {ethers}=await network.create();
const evidence=JSON.parse(await readFile("evidence/protected-debt-base-fork.json","utf8"));
const a=evidence.addresses;
const metadata=await ethers.provider.send("hardhat_metadata",[]);
if(metadata.forkedNetwork?.forkBlockNumber!==51123118||evidence.chainId!==8453||evidence.forkBlock!==51123118)throw Error("Evidence does not belong to the canonical local Base fork");
const client=createPublicClient({transport:http(process.env.FIRMDEPTH_FORK_RPC_URL??"http://127.0.0.1:8545")});
const compatibility=await verifyAaveBase(ethers.provider,a.usdc);
await authenticateDebtRepayment(client,a.repayment,{settlement:a.settlement,...a});
async function receipt(hash:string,status=1){const r=await ethers.provider.getTransactionReceipt(hash);if(!r||r.status!==status)throw Error("Receipt is missing or has wrong status: "+hash);return r;}
const adapterDeployment=await receipt(evidence.deployment.adapterTransactionHash);
const wrapperDeployment=await receipt(evidence.deployment.settlementTransactionHash);
if(adapterDeployment.contractAddress?.toLowerCase()!==a.repayment.toLowerCase()||wrapperDeployment.contractAddress?.toLowerCase()!==a.settlement.toLowerCase())throw Error("Deployment receipt/address mismatch");
const borrow=await receipt(evidence.borrowTransaction);
const borrowTx=await ethers.provider.getTransaction(evidence.borrowTransaction);
const borrowCall=new ethers.Interface(AAVE_POOL_ABI).parseTransaction(borrowTx!);
if(borrow.to?.toLowerCase()!==a.pool.toLowerCase()||borrowCall?.name!=="borrow"||borrowCall.args[0].toLowerCase()!==a.usdc.toLowerCase()||borrowCall.args[1]!==600_000_000n||borrowCall.args[2]!==2n||borrowCall.args[4].toLowerCase()!==evidence.borrower.toLowerCase())throw Error("Position was not created by an actual supported Aave borrow");
let aquaCount=0,bondCount=0;
for(const scenario of evidence.scenarios){
 await receipt(scenario.create);await receipt(scenario.fund);await receipt(scenario.accept);
 const verified=await getDebtRepaymentReceipt(client,a.repayment,scenario.planId,scenario.transactionHash,BigInt(wrapperDeployment.blockNumber));
 for(const field of ["actualRepaid","debtBefore","debtAfter","scaledDebtBefore","scaledDebtAfter","debtIndex","usdcRefund","wethRefund","proceeds"]as const)if(verified[field]!==BigInt(scenario[field]))throw Error("Recorded repayment evidence changed: "+field);
 if(verified.path!==scenario.path)throw Error("Recorded path does not match real receipt");
 if(verified.path==="AQUA")aquaCount++;else bondCount++;
}
if(aquaCount<1||bondCount!==1)throw Error("Both actual repayment paths were not demonstrated");
const drain=await receipt(evidence.siblingDrain.transactionHash);
const bond=evidence.scenarios.find((s:any)=>s.path==="BOND");
const acceptance=await receipt(bond.accept);
const bondExecution=await receipt(bond.transactionHash);
if(!(acceptance.blockNumber<drain.blockNumber&&drain.blockNumber<bondExecution.blockNumber))throw Error("Sibling drain is not between acceptance and bond repayment");
const usdc=new ethers.Contract(a.usdc,["function balanceOf(address) view returns(uint256)"],ethers.provider);
const registry=await ethers.getContractAt("FirmCommitmentRegistry",a.registry);
const vault=await ethers.getContractAt("BondVault",a.bondVault);
const debt=new ethers.Contract(a.variableDebtToken,AAVE_DEBT_ABI,ethers.provider);
const expired=await receipt(evidence.expiry.refund);
const expiryPlan=await readDebtPlan(client,a.repayment,evidence.expiry.id);
if(expiryPlan.underlying.state!==5||Number((await registry.getCommitment(evidence.expiry.commitmentId)).status)!==4)throw Error("Expiry did not refund the plan");
if(expired.logs.some(log=>log.address.toLowerCase()===a.pool.toLowerCase()))throw Error("Expiry unexpectedly called Aave repayment");
const failed=await receipt(evidence.safeFailure.transactionHash,0);
if(failed.logs.length!==0)throw Error("Reverted transaction retained logs");
const scaledAtFailure=await debt.scaledBalanceOf(evidence.borrower,{blockTag:failed.blockNumber});
const reserveAtFailure=await usdc.balanceOf(a.aToken,{blockTag:failed.blockNumber});
const lockAtFailure=await vault.totalLocked({blockTag:failed.blockNumber});
if(scaledAtFailure!==BigInt(evidence.safeFailure.scaledDebt)||reserveAtFailure!==BigInt(evidence.safeFailure.aTokenUsdc)||lockAtFailure!==BigInt(evidence.safeFailure.locked))throw Error("Failure did not preserve debt, reserve cash and locked collateral");
const trace=await ethers.provider.send("debug_traceTransaction",[failed.hash,{disableMemory:true,disableStorage:true}]);
const poolCalls=trace.structLogs.filter((step:any)=>step.op==="CALL"&&step.stack?.at(-2)?.replace(/^0x/,"").slice(-40).toLowerCase()===a.pool.slice(2).toLowerCase());
if(!trace.failed||poolCalls.length!==1)throw Error("Rollback trace does not prove the real Pool.repay was reached");
const finalBlock=bondExecution.blockNumber>0?Math.max(...evidence.scenarios.map((s:any)=>Number(s.blockNumber))):0;
const finalDebt=await debt.balanceOf(evidence.borrower,{blockTag:finalBlock});
if(finalDebt!==BigInt(evidence.final.debt)||await debt.scaledBalanceOf(evidence.borrower,{blockTag:finalBlock})!==BigInt(evidence.final.scaledDebt))throw Error("Final Aave debt balance mismatch");
if(await usdc.balanceOf(evidence.borrower,{blockTag:finalBlock})!==BigInt(evidence.final.payerUsdc)||await vault.liabilities({blockTag:finalBlock})!==BigInt(evidence.final.vaultLiabilities))throw Error("Final token or vault balance mismatch");
const codeHashes:Record<string,string>={...compatibility.codeHashes};
for(const[name,address]of Object.entries(a) as [string,string][]){const code=await ethers.provider.getCode(address);if(code==="0x")throw Error("Missing deployment code: "+name);codeHashes[name]=ethers.keccak256(code);}
// Keep the completed historical demonstration distinct from an optional fresh
// interactive fixture on the same retained node. Both must have real receipts.
const runtime=JSON.parse(await readFile("../frontend/.runtime/firmdepth.json","utf8"));
let interactive:Record<string,unknown>|undefined;
if(runtime.debtRepayment?.address.toLowerCase()!==a.repayment.toLowerCase()){
 const d=runtime.debtRepayment;
 if(!d)throw Error("Interactive runtime has no repayment adapter");
 await authenticateDebtRepayment(client,d.address,{...runtime.addresses,settlement:runtime.settlement.address,...d});
 const deployed=await receipt(d.deploymentTransactionHash);
 if(deployed.contractAddress?.toLowerCase()!==d.address.toLowerCase())throw Error("Interactive deployment receipt mismatch");
 const borrowed=await receipt(d.borrowTransactionHash);
 const transaction=await ethers.provider.getTransaction(d.borrowTransactionHash);
 const call=new ethers.Interface(AAVE_POOL_ABI).parseTransaction(transaction!);
 if(borrowed.to?.toLowerCase()!==a.pool.toLowerCase()||call?.name!=="borrow"||call.args[0].toLowerCase()!==a.usdc.toLowerCase()||call.args[1]!==600_000_000n||call.args[2]!==2n||call.args[4].toLowerCase()!==d.borrower.toLowerCase())throw Error("Interactive position lacks an actual supported Aave borrow");
 const block=await ethers.provider.getBlockNumber();
 const currentDebt=await debt.balanceOf(d.borrower,{blockTag:block});
 if(currentDebt<600_000_000n)throw Error("Interactive borrower has no fresh 600 USDC debt position");
 interactive={repayment:d.address,settlement:runtime.settlement.address,borrower:d.borrower,initialDebt:d.initialDebt,observedDebt:currentDebt.toString(),observedBlock:block,deploymentTransactionHash:d.deploymentTransactionHash,borrowTransactionHash:d.borrowTransactionHash,frontendUrl:"http://127.0.0.1:4173/settlement",rpcUrl:"http://127.0.0.1:8545"};
}
await writeFile("../../deployments/protected-debt-base-fork.json",JSON.stringify({schemaVersion:"1",environment:evidence.environment,chainId:8453,forkBlock:51123118,recordedAt:new Date().toISOString(),baseline:evidence.baseline,addresses:a,codeHashes,deployment:evidence.deployment,borrower:evidence.borrower,borrowTransaction:evidence.borrowTransaction,evidence:"packages/contracts/evidence/protected-debt-base-fork.json",transactions:evidence.scenarios.map((s:any)=>({path:s.path,planId:s.planId,acceptance:s.accept,execution:s.transactionHash,actualRepaid:s.actualRepaid,debtBefore:s.debtBefore,debtAfter:s.debtAfter})),safeFailure:failed.hash,...(interactive?{interactive}:{}),verified:{realAavePool:true,realReserveTokens:true,aquaRepayment:true,bondRepayment:true,expiryRefund:true,atomicAaveRollback:true,scaledDebtAndTokenTransfers:true}},null,2)+"\n");
console.log("Independently verified actual Aave borrowing, Aqua/bond repayments, scaled debt reductions, ERC-20 receipts, expiry and Pool.repay rollback trace.");
