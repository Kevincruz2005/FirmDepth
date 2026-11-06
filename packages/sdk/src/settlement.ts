import { decodeEventLog, getAddress, type Address, type Hex, type PublicClient } from "viem";
import { settlementAbi } from "./settlement-abi.js";
import type { ContractClients } from "./actions.js";
import type { FirmQuote, SwapVMOrder } from "./types.js";
import { getFirmExecutionReceipt } from "./receipt.js";
import { registryAbi } from "./requests.js";
import { erc20Abi } from "./requests.js";
export { settlementAbi };
export const planStates = ["NONE", "CREATED", "FUNDED", "ACCEPTED", "SETTLED", "REFUNDED"] as const;
export interface Payout { recipient: Address; amount: bigint }
export const readPlan = (client: PublicClient, address: Address, id: Hex) => client.readContract({address,abi:settlementAbi,functionName:"getPlan",args:[id]});
export const readPayouts = (client: PublicClient, address: Address, id: Hex) => client.readContract({address,abi:settlementAbi,functionName:"getPayouts",args:[id]});
export async function authenticateSettlement(client: PublicClient, address: Address, expected: {registry: Address; executor: Address; weth: Address; usdc: Address; firmRouter: Address}) {
  if (!await client.getBytecode({address})) throw new Error("Settlement bytecode missing");
  for (const [name,wanted] of [["registry",expected.registry],["executor",expected.executor],["tokenIn",expected.weth],["tokenOut",expected.usdc],["router",expected.firmRouter]] as const) {
    const actual = await client.readContract({address,abi:settlementAbi,functionName:name});
    if (getAddress(actual)!==getAddress(wanted)) throw new Error(`Settlement ${name} mismatch`);
  }
}
export async function createPayoutPlan(c: ContractClients,address:Address,nonce:bigint,amountIn:bigint,maxPremium:bigint,deadline:bigint,payouts:Payout[]) {
  const s=await c.publicClient.simulateContract({address,abi:settlementAbi,functionName:"createPlan",args:[nonce,amountIn,maxPremium,deadline,payouts],account:c.account});
  return {hash:await c.walletClient.writeContract(s.request),planId:s.result};
}
export async function fundPayoutPlan(c:ContractClients,address:Address,id:Hex) {
  const s=await c.publicClient.simulateContract({address,abi:settlementAbi,functionName:"fundPlan",args:[id],account:c.account});return c.walletClient.writeContract(s.request);
}
export async function acceptPayoutPlan(c:ContractClients,address:Address,id:Hex,quote:FirmQuote,order:SwapVMOrder,signature:Hex) {
  const s=await c.publicClient.simulateContract({address,abi:settlementAbi,functionName:"acceptPlan",args:[id,quote,order,signature],account:c.account});return c.walletClient.writeContract(s.request);
}
export async function executePayoutPlan(c:ContractClients,address:Address,id:Hex,order:SwapVMOrder) {
  const s=await c.publicClient.simulateContract({address,abi:settlementAbi,functionName:"executePlan",args:[id,order],account:c.account});return c.walletClient.writeContract(s.request);
}
export async function refundPayoutPlan(c:ContractClients,address:Address,id:Hex) {
  const s=await c.publicClient.simulateContract({address,abi:settlementAbi,functionName:"refundPlan",args:[id],account:c.account});return c.walletClient.writeContract(s.request);
}
export async function getPayoutReceipt(client:PublicClient,address:Address,id:Hex,hash:Hex,deploymentBlock=0n) {
  const [plan,payouts,receipt,tokenOut]=await Promise.all([readPlan(client,address,id),readPayouts(client,address,id),client.getTransactionReceipt({hash}),client.readContract({address,abi:settlementAbi,functionName:"tokenOut"})]);
  if(receipt.status!=="success" || plan.state!==4) throw new Error("Plan is not successfully settled");
  const decoded=receipt.logs.filter(l=>getAddress(l.address)===getAddress(address)).flatMap(l=>{try{return [decodeEventLog({abi:settlementAbi,data:l.data,topics:l.topics})]}catch{return []}});
  const terminal=decoded.filter(e=>e.eventName==="PlanSettled" && e.args.planId===id);
  if(terminal.length!==1) throw new Error("Missing unique settlement event");
  const event=terminal[0]!;
  if(event.eventName!=="PlanSettled" || event.args.commitmentId!==plan.commitmentId) throw new Error("Commitment mismatch");
  const payments=decoded.filter(e=>e.eventName==="RecipientPaid" && e.args.planId===id);
  if(payments.length!==payouts.length) throw new Error("Payment cardinality mismatch");
  const transfers=receipt.logs.filter(l=>getAddress(l.address)===getAddress(tokenOut)).flatMap(l=>{try{return [decodeEventLog({abi:erc20Abi,data:l.data,topics:l.topics})]}catch{return []}}).filter(e=>e.eventName==="Transfer");
  for(let i=0;i<payouts.length;i++) {
    const payout=payouts[i]!;
    const payment=payments[i]!;
    if(payment.eventName!=="RecipientPaid" || payment.args.index!==BigInt(i) || getAddress(payment.args.recipient)!==getAddress(payout.recipient) || payment.args.amount!==payout.amount) throw new Error("Allocation mismatch");
    const matches=transfers.filter(e=>getAddress(e.args.from)===getAddress(address) && getAddress(e.args.to)===getAddress(payout.recipient) && e.args.value===payout.amount);
    const expectedCount = payouts.filter(p=>p.recipient.toLowerCase()===payout.recipient.toLowerCase() && p.amount===payout.amount).length + (plan.payer.toLowerCase()===payout.recipient.toLowerCase() && event.args.surplus===payout.amount ? 1 : 0);
    if(matches.length!==expectedCount) throw new Error("Recipient transfer missing or duplicated");
  }
  const outgoing=transfers.filter(e=>getAddress(e.args.from)===getAddress(address));
  if(outgoing.length!==payouts.length+(event.args.surplus>0n?1:0))throw new Error("Unexpected output transfers");
  if(event.args.surplus>0n && !outgoing.some(e=>getAddress(e.args.to)===getAddress(plan.payer)&&e.args.value===event.args.surplus))throw new Error("Surplus transfer mismatch");
  const incoming=transfers.filter(e=>getAddress(e.args.to)===getAddress(address));
  if(incoming.length!==1 || incoming[0]!.args.value!==event.args.proceeds)throw new Error("Gross output mismatch");
  if(event.args.refund!==plan.maxPremium-plan.premiumPaid)throw new Error("Premium budget mismatch");
  const registry=await client.readContract({address,abi:settlementAbi,functionName:"registry"});
  const executor=await client.readContract({address,abi:settlementAbi,functionName:"executor"});
  const router=await client.readContract({address,abi:settlementAbi,functionName:"router"});
  const vault=await client.readContract({address:registry,abi:registryAbi,functionName:"vault"});
  const commitment=await client.readContract({address:registry,abi:registryAbi,functionName:"getCommitment",args:[plan.commitmentId]});
  if(commitment.acceptedBlock<deploymentBlock || commitment.acceptedBlock>receipt.blockNumber || commitment.acceptedBlock===0n)throw new Error("Acceptance block outside settlement history");
  const accepted=await client.getContractEvents({address:registry,abi:registryAbi,eventName:"CommitmentAccepted",args:{commitmentId:plan.commitmentId},fromBlock:commitment.acceptedBlock,toBlock:commitment.acceptedBlock});
  if(accepted.length!==1 || !accepted[0]!.transactionHash)throw new Error("Acceptance evidence missing");
  const core=await getFirmExecutionReceipt(client,{registry,executor,router,vault,commitmentId:plan.commitmentId,acceptanceTransactionHash:accepted[0]!.transactionHash,terminalTransactionHash:hash});
  if((core.path==="AQUA"?2:core.path==="BOND"?3:4)!==event.args.status)throw new Error("Settlement path mismatch");
  if(core.taker.toLowerCase()!==address.toLowerCase() || core.amountIn!==plan.amountIn || core.premium!==plan.premiumPaid)throw new Error("Underlying commitment mismatch");
  if(event.args.proceeds!==plan.totalOut+event.args.surplus) throw new Error("Output does not reconcile");
  return {planId:id,commitmentId:plan.commitmentId,transactionHash:hash,blockNumber:receipt.blockNumber,payouts,proceeds:event.args.proceeds,surplus:event.args.surplus,refund:event.args.refund,status:event.args.status};
}
