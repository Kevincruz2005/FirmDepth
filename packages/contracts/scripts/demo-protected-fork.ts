import {readFile,writeFile} from "node:fs/promises";
import {network} from "hardhat";
import {buildFirmQuote} from "../../sdk/dist/quote.js";
import {firmQuoteTypedData} from "../../sdk/dist/eip712.js";
import {buildAquaOrder,encodeAquaStrategy,buildSoftTakerTraits} from "./lib/base-fork.ts";
const {ethers}=await network.create();
const runtime=JSON.parse(await readFile("../frontend/.runtime/firmdepth.json","utf8"));
const a=runtime.addresses;
const [,maker,payer,drainer,alice,bob]=await ethers.getSigners();
const wrapper=await ethers.getContractAt("ProtectedSettlement",runtime.settlement.address);
const registry=await ethers.getContractAt("FirmCommitmentRegistry",a.registry);
const router=await ethers.getContractAt("FirmAquaSwapVMRouter",a.firmRouter);
const vault=await ethers.getContractAt("BondVault",a.bondVault);
const usdc=new ethers.Contract(a.usdc,["function balanceOf(address) view returns(uint256)"],ethers.provider);
const weth=new ethers.Contract(a.weth,["function approve(address,uint256) returns(bool)","function balanceOf(address) view returns(uint256)"],payer);
const strategy=runtime.strategies.find((s:any)=>s.kind==="FIRM");
const order={...strategy.order,traits:BigInt(strategy.order.traits)};
const payouts=[{recipient:await alice.getAddress(),amount:120_000_000n},{recipient:await bob.getAddress(),amount:80_000_000n}];
const evidence:any={provenance:"LOCAL BASE FORK — NOT PUBLIC TESTNET",chainId:8453,forkBlock:51123118,recordedAt:new Date().toISOString(),addresses:{...a,protectedSettlement:runtime.settlement.address},scenarios:[]};
async function wait(tx:any){const r=await tx.wait();if(r.status!==1)throw Error("Transaction failed");return r;}
await wait(await weth.approve(runtime.settlement.address,ethers.MaxUint256));
for(const nonce of [1001n,1002n]){
 const time=(await ethers.provider.getBlock("latest"))!.timestamp;
 const id=await wrapper.planIdFor(await payer.getAddress(),nonce);
 const create=await wait(await wrapper.connect(payer).createPlan(nonce,ethers.parseEther("0.1"),ethers.parseEther("0.002"),time+3600,payouts));
 const fund=await wait(await wrapper.connect(payer).fundPlan(id));
 const block=(await ethers.provider.getBlock("latest"))!;
 const quote=buildFirmQuote({maker:await maker.getAddress(),taker:runtime.settlement.address,executor:a.executor,swapRouter:a.firmRouter,orderHash:strategy.orderHash,tokenIn:a.weth,tokenOut:a.usdc,amountIn:ethers.parseEther("0.1"),referenceAmountOut:200_000_000n,minAmountOut:200_000_000n,requiredBond:240_000_000n,premiumToken:a.weth,sigmaWad:800_000_000_000_000_000n,annualCapitalRateWad:100_000_000_000_000_000n,capacityKBps:10,utilizationAfterWad:await registry.utilizationAfter(await maker.getAddress(),240_000_000n),minPremiumOut:1n,expiry:BigInt(block.timestamp+120),nonce},BigInt(block.timestamp));
 const typed=firmQuoteTypedData(a.registry,8453,quote);
 const signature=await maker.signTypedData(typed.domain,typed.types,typed.message);
 const accepted=await wait(await wrapper.connect(payer).acceptPlan(id,quote,order,signature));
 if(nonce===1002n){
  const aqua=new ethers.Contract(a.aqua,["function ship(address,bytes,address[],uint256[]) returns(bytes32)"],maker);
  const soft=buildAquaOrder(await maker.getAddress(),a.weth,a.usdc,ethers.concat(["0x5000","0x0208",ethers.toBeHex(88,8)]));
  const balance=await usdc.balanceOf(await maker.getAddress());
  await wait(await aqua.ship(a.firmRouter,encodeAquaStrategy(soft),[a.weth,a.usdc],[0,balance-100_000_000n]));
  await wait(await weth.connect(drainer).approve(a.firmRouter,ethers.parseEther("1")));
  const drain=await wait(await router.connect(drainer).swap(soft,ethers.parseEther("1"),buildSoftTakerTraits(a.weth,a.usdc)));
  evidence.siblingDrain={hash:drain.hash,makerBalance:await usdc.balanceOf(await maker.getAddress())};
 }
 if(nonce===1001n){
  const executorCode=await ethers.provider.getCode(a.executor);
  const lockBefore=await vault.lockedOf(await maker.getAddress());
  const principalBefore=await weth.balanceOf(runtime.settlement.address);
  const balancesBefore=await Promise.all(payouts.map(p=>usdc.balanceOf(p.recipient)));
  await ethers.provider.send("hardhat_setCode",[a.executor,"0x60006000fd"]);
  let failedHash:string|undefined;
  const beforeBlock=await ethers.provider.getBlockNumber();
  try { failedHash=await ethers.provider.send("eth_sendTransaction",[{from:await payer.getAddress(),to:runtime.settlement.address,data:wrapper.interface.encodeFunctionData("executePlan",[id,order]),gas:"0x1e8480"}]); } catch {}
  await ethers.provider.send("hardhat_setCode",[a.executor,executorCode]);
  if(!failedHash){const latest=await ethers.provider.getBlock("latest");if(latest && latest.number>beforeBlock)failedHash=latest.transactions.at(-1);}
  if(!failedHash)throw Error("Failure probe did not produce a mined transaction");
  const failure=await ethers.provider.getTransactionReceipt(failedHash);
  if(!failure || failure.status!==0 || await vault.lockedOf(await maker.getAddress())!==lockBefore || await weth.balanceOf(runtime.settlement.address)!==principalBefore)throw Error("Failure did not preserve principal and collateral");
  for(let i=0;i<payouts.length;i++)if(await usdc.balanceOf(payouts[i].recipient)!==balancesBefore[i])throw Error("Failed execution paid a recipient");
  if(Number((await wrapper.getPlan(id)).state)!==3)throw Error("Failed execution changed plan state");
  evidence.safeFailure={transactionHash:failedHash,status:failure.status,faultInjection:"Local fork executor bytecode temporarily replaced with REVERT and restored",lockedBond:lockBefore,principalPreserved:principalBefore};
 }
 const before=await Promise.all(payouts.map(p=>usdc.balanceOf(p.recipient)));
 const executed=await wait(await wrapper.connect(payer).executePlan(id,order));
 const after=await Promise.all(payouts.map(p=>usdc.balanceOf(p.recipient)));
 for(let i=0;i<2;i++)if(after[i]-before[i]!==payouts[i].amount)throw Error("Recipient delta mismatch");
 const plan=await wrapper.getPlan(id);const c=await registry.getCommitment(plan.commitmentId);
 if(Number(c.status)!==(nonce===1001n?2:3)||Number(plan.state)!==4||plan.escrow!==0n)throw Error("Terminal mismatch");
 evidence.scenarios.push({planId:id,commitmentId:plan.commitmentId,path:nonce===1001n?"AQUA":"BOND",create:create.hash,fund:fund.hash,accept:accepted.hash,execute:executed.hash,block:executed.blockNumber,payouts:payouts.map((p,i)=>({...p,before:before[i],after:after[i]}))});
}
if(await wrapper.totalEscrow()!==0n||await vault.totalLocked()!==0n)throw Error("Residual liabilities");
evidence.final={vaultBalance:await usdc.balanceOf(a.bondVault),vaultLiabilities:await vault.liabilities()};
if(evidence.final.vaultBalance!==evidence.final.vaultLiabilities)throw Error("Vault mismatch");
await writeFile("evidence/protected-settlement-fork.json",JSON.stringify(evidence,(_,v)=>typeof v==="bigint"?v.toString():v,2)+"\n");
console.log("Verified both payout paths",runtime.settlement.address);
