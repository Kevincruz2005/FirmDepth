import {readFile,writeFile} from "node:fs/promises";
import {network} from "hardhat";
const {ethers}=await network.create();
const evidence=JSON.parse(await readFile("evidence/protected-settlement-fork.json","utf8"));
const runtime=JSON.parse(await readFile("../frontend/.runtime/firmdepth.json","utf8"));
const a=evidence.addresses;
for(const [name,address] of Object.entries(a)) if(await ethers.provider.getCode(String(address))==="0x")throw Error(`${name}: bytecode missing`);
const wrapper=await ethers.getContractAt("ProtectedSettlement",a.protectedSettlement);
const registry=await ethers.getContractAt("FirmCommitmentRegistry",a.registry);
const vault=await ethers.getContractAt("BondVault",a.bondVault);
const token=new ethers.Contract(a.usdc,["function balanceOf(address) view returns(uint256)","event Transfer(address indexed from,address indexed to,uint256 value)"],ethers.provider);
for(const scenario of evidence.scenarios){
 for(const kind of ["create","fund","accept","execute"]){const r=await ethers.provider.getTransactionReceipt(scenario[kind]);if(!r||r.status!==1)throw Error(`${kind}: receipt missing or failed`);}
 const plan=await wrapper.getPlan(scenario.planId);const c=await registry.getCommitment(plan.commitmentId);
 if(Number(plan.state)!==4||plan.escrow!==0n||Number(c.status)!==(scenario.path==="AQUA"?2:3))throw Error("Terminal state mismatch");
 const receipt=(await ethers.provider.getTransactionReceipt(scenario.execute))!;
 for(const payout of scenario.payouts){
  const transfers=receipt.logs.filter(l=>l.address.toLowerCase()===a.usdc.toLowerCase()).flatMap(l=>{try{return [token.interface.parseLog(l)]}catch{return []}}).filter(l=>l?.name==="Transfer" && l.args.from.toLowerCase()===a.protectedSettlement.toLowerCase() && l.args.to.toLowerCase()===payout.recipient.toLowerCase() && l.args.value===BigInt(payout.amount));
  if(transfers.length!==1 || BigInt(payout.after)-BigInt(payout.before)!==BigInt(payout.amount))throw Error("Recipient payment mismatch");
 }
}
for(const payout of evidence.scenarios.at(-1).payouts)if(await token.balanceOf(payout.recipient)!==BigInt(payout.after))throw Error("Current recipient balance changed");
if((await ethers.provider.getTransactionReceipt(evidence.safeFailure.transactionHash))?.status!==0)throw Error("Missing failure receipt");
if(await wrapper.totalEscrow()!==0n||await vault.totalLocked()!==0n||await token.balanceOf(a.bondVault)!==await vault.liabilities())throw Error("Liabilities mismatch");
const block=await ethers.provider.getBlock(runtime.deploymentBlock+1);
let deploymentTransactionHash=runtime.settlement.deploymentTransactionHash;
if(!deploymentTransactionHash && block)for(const hash of block.transactions){const r=await ethers.provider.getTransactionReceipt(hash);if(r?.contractAddress?.toLowerCase()===a.protectedSettlement.toLowerCase())deploymentTransactionHash=hash;}
if(!deploymentTransactionHash)throw Error("Deployment receipt missing");
await writeFile("../../deployments/protected-base-fork.json",JSON.stringify({schemaVersion:"1",environment:"local-base-fork",publicDeployment:false,chainId:8453,forkBlock:51123118,baseline:"89c4a7910f054042872927a29e162538f6fa7b65",recordedAt:evidence.recordedAt,addresses:a,deploymentTransactionHash,evidence:"packages/contracts/evidence/protected-settlement-fork.json",transactions:evidence.scenarios.map((s:any)=>({path:s.path,acceptance:s.accept,execution:s.execute})),safeFailure:evidence.safeFailure.transactionHash},null,2)+"\n");
console.log("Verified bytecode, receipts, recipient transfers and current balances, failure receipt, and liabilities.");
