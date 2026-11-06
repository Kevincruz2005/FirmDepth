import {decodeEventLog,getAddress,parseAbi,type Address,type Hex,type PublicClient} from "viem";
import type {ContractClients} from "./actions.js";
import {debtRepaymentAbi} from "./debt-repayment-abi.js";
import {authenticateSettlement,fundPayoutPlan,acceptPayoutPlan,executePayoutPlan,refundPayoutPlan,getPayoutReceipt,settlementAbi} from "./settlement.js";
import {erc20Abi} from "./requests.js";
export {debtRepaymentAbi};
export const aaveBaseMarket={chainId:8453,pool:"0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",asset:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",weth:"0x4200000000000000000000000000000000000006",variableDebtToken:"0x59dca05b6c26dbd64b5381374aAaC5CD05644C28",aToken:"0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",debtMode:2} as const;
export const aavePoolAbi=parseAbi(["function ADDRESSES_PROVIDER() view returns(address)","function getConfiguration(address) view returns(uint256)","event Repay(address indexed reserve,address indexed user,address indexed repayer,uint256 amount,bool useATokens)"]);
export const aaveDebtAbi=parseAbi(["function POOL() view returns(address)","function UNDERLYING_ASSET_ADDRESS() view returns(address)","function balanceOf(address) view returns(uint256)","function scaledBalanceOf(address) view returns(uint256)"]);
const providerAbi=parseAbi(["function getPool() view returns(address)","function getPoolDataProvider() view returns(address)"]);
const dataProviderAbi=parseAbi(["function getReserveTokensAddresses(address) view returns(address,address,address)"]);
const same=(a:Address,b:Address)=>getAddress(a)===getAddress(b);

export async function authenticateDebtRepayment(client:PublicClient,address:Address,expected:{settlement:Address;registry:Address;executor:Address;weth:Address;usdc:Address;firmRouter:Address}){
 if(await client.getChainId()!==aaveBaseMarket.chainId || !same(expected.usdc,aaveBaseMarket.asset)||!same(expected.weth,aaveBaseMarket.weth))throw Error("Aave debt repayment is supported only for the verified Base native-USDC market");
 if(!await client.getBytecode({address}))throw Error("Debt adapter bytecode missing");
 for(const[name,wanted]of [["settlement",expected.settlement],["pool",aaveBaseMarket.pool],["tokenOut",expected.usdc],["tokenIn",expected.weth],["variableDebtToken",aaveBaseMarket.variableDebtToken],["aToken",aaveBaseMarket.aToken]]as const){
  const actual=await client.readContract({address,abi:debtRepaymentAbi,functionName:name});if(!same(actual,wanted))throw Error(`Debt adapter ${name} mismatch`);
 }
 const chain=await client.readContract({address,abi:debtRepaymentAbi,functionName:"authorizedChainId"});
 const mode=await client.readContract({address,abi:debtRepaymentAbi,functionName:"DEBT_MODE"});
 if(chain!==8453n||mode!==2n)throw Error("Debt adapter authorization domain mismatch");
 await authenticateSettlement(client,expected.settlement,expected);
 const pool=aaveBaseMarket.pool,asset=aaveBaseMarket.asset,debt=aaveBaseMarket.variableDebtToken;
 const provider=await client.readContract({address:pool,abi:aavePoolAbi,functionName:"ADDRESSES_PROVIDER"});
 const configuredProvider=await client.readContract({address,abi:debtRepaymentAbi,functionName:"addressesProvider"});
 const dataProvider=await client.readContract({address:provider,abi:providerAbi,functionName:"getPoolDataProvider"});
 const configuredDataProvider=await client.readContract({address,abi:debtRepaymentAbi,functionName:"dataProvider"});
 const registeredPool=await client.readContract({address:provider,abi:providerAbi,functionName:"getPool"});
 const [aToken,,variableDebt]=await client.readContract({address:dataProvider,abi:dataProviderAbi,functionName:"getReserveTokensAddresses",args:[asset]});
 const debtPool=await client.readContract({address:debt,abi:aaveDebtAbi,functionName:"POOL"});
 const underlying=await client.readContract({address:debt,abi:aaveDebtAbi,functionName:"UNDERLYING_ASSET_ADDRESS"});
 const config=await client.readContract({address:pool,abi:aavePoolAbi,functionName:"getConfiguration",args:[asset]});
 if(!same(provider,configuredProvider)||!same(dataProvider,configuredDataProvider)||!same(registeredPool,pool)||!same(aToken,aaveBaseMarket.aToken)||!same(variableDebt,debt)||!same(debtPool,pool)||!same(underlying,asset)||((config>>56n)&1n)!==1n||((config>>60n)&1n)!==0n||((config>>48n)&255n)!==6n)throw Error("Aave reserve configuration mismatch");
}
export async function readDebtPlan(client:PublicClient,address:Address,id:Hex){const[repayment,underlying]=await client.readContract({address,abi:debtRepaymentAbi,functionName:"getRepaymentPlan",args:[id]});return {repayment,underlying};}
export async function readBorrowerDebt(client:PublicClient,borrower:Address){
 const block=await client.getBlock();
 const[balance,scaledBalance]=await Promise.all([client.readContract({address:aaveBaseMarket.variableDebtToken,abi:aaveDebtAbi,functionName:"balanceOf",args:[borrower],blockNumber:block.number}),client.readContract({address:aaveBaseMarket.variableDebtToken,abi:aaveDebtAbi,functionName:"scaledBalanceOf",args:[borrower],blockNumber:block.number})]);
 return {balance,scaledBalance,blockNumber:block.number};
}
export async function createDebtRepaymentPlan(c:ContractClients,address:Address,params:{nonce:bigint;borrower:Address;amountIn:bigint;maxPremium:bigint;deadline:bigint;maxRepay:bigint;minRepay:bigint}){
 const s=await c.publicClient.simulateContract({address,abi:debtRepaymentAbi,functionName:"createRepaymentPlan",args:[params.nonce,params.borrower,aaveBaseMarket.asset,2n,params.amountIn,params.maxPremium,params.deadline,params.maxRepay,params.minRepay],account:c.account});
 return {hash:await c.walletClient.writeContract(s.request),planId:s.result};
}
// These adapter entry points intentionally use the existing action selectors and simulations.
export const fundDebtPlan=fundPayoutPlan;
export const acceptDebtPlan=acceptPayoutPlan;
export const executeDebtPlan=executePayoutPlan;
export const refundDebtPlan=refundPayoutPlan;

export async function getDebtRepaymentReceipt(client:PublicClient,address:Address,id:Hex,hash:Hex,deploymentBlock=0n){
 const [{repayment:p,underlying},receipt,settlement]=await Promise.all([readDebtPlan(client,address,id),client.getTransactionReceipt({hash}),client.readContract({address,abi:debtRepaymentAbi,functionName:"settlement"})]);
 if(receipt.status!=="success"||underlying.state!==4||p.actualRepaid===0n)throw Error("Debt repayment is not successfully settled");
 if(!same(underlying.payer,address)||p.commitmentId!==underlying.commitmentId)throw Error("Repayment commitment binding mismatch");
 const decoded=receipt.logs.filter(l=>same(l.address,address)).flatMap(l=>{try{return[decodeEventLog({abi:debtRepaymentAbi,data:l.data,topics:l.topics})]}catch{return[]}});
 const matches=decoded.filter(e=>e.eventName==="DebtRepaid"&&e.args.planId===id);
 if(matches.length!==1)throw Error("Missing unique debt repayment event");
 const event=matches[0]!;if(event.eventName!=="DebtRepaid")throw Error("Invalid repayment event");
 const e=event.args;
 if(e.commitmentId!==p.commitmentId||!same(e.borrower,p.borrower)||e.actualRepaid!==p.actualRepaid||e.debtBefore!==p.debtBefore||e.debtAfter!==p.debtAfter||e.actualRepaid<p.minRepay||e.actualRepaid>p.maxRepay||e.debtAfter>=e.debtBefore||e.scaledDebtAfter>=e.scaledDebtBefore)throw Error("Repayment debt evidence mismatch");
 const reduction=e.debtBefore-e.debtAfter;
 if((reduction>e.actualRepaid?reduction-e.actualRepaid:e.actualRepaid-reduction)>1n)throw Error("Debt reduction exceeds rounding tolerance");
 const pool=await client.readContract({address,abi:debtRepaymentAbi,functionName:"pool"});
 const asset=await client.readContract({address,abi:debtRepaymentAbi,functionName:"tokenOut"});
 const input=await client.readContract({address,abi:debtRepaymentAbi,functionName:"tokenIn"});
 const aToken=await client.readContract({address,abi:debtRepaymentAbi,functionName:"aToken"});
 if(!same(pool,aaveBaseMarket.pool)||!same(asset,aaveBaseMarket.asset)||!same(input,aaveBaseMarket.weth)||!same(aToken,aaveBaseMarket.aToken))throw Error("Unrecognized Aave repayment market");
 const repayments=receipt.logs.filter(l=>same(l.address,pool)).flatMap(l=>{try{return[decodeEventLog({abi:aavePoolAbi,data:l.data,topics:l.topics})]}catch{return[]}});
 if(repayments.length!==1)throw Error("Missing unique Aave Pool repayment");
 const r=repayments[0]!.args;
 if(!same(r.reserve,asset)||!same(r.user,p.borrower)||!same(r.repayer,address)||r.amount!==e.actualRepaid||r.useATokens)throw Error("Aave Pool repayment does not match authorization");
 const core=await getPayoutReceipt(client,settlement,id,hash,deploymentBlock);
 if(core.commitmentId!==p.commitmentId||core.payouts.length!==1||!same(core.payouts[0]!.recipient,address)||core.payouts[0]!.amount!==p.maxRepay||e.actualRepaid+e.usdcRefund!==core.proceeds||e.wethRefund!==core.refund)throw Error("Repayment balance conservation mismatch");
 const transfers=(token:Address)=>receipt.logs.filter(l=>same(l.address,token)).flatMap(l=>{try{return[decodeEventLog({abi:erc20Abi,data:l.data,topics:l.topics})]}catch{return[]}}).filter(e=>e.eventName==="Transfer").map(e=>e.args);
 const outgoing=transfers(asset).filter(t=>same(t.from,address));
 if(outgoing.length!==(e.usdcRefund>0n?2:1)||outgoing.filter(t=>same(t.to,aToken)&&t.value===e.actualRepaid).length!==1||(e.usdcRefund>0n&&outgoing.filter(t=>same(t.to,p.payer)&&t.value===e.usdcRefund).length!==1))throw Error("Repayment or surplus ERC-20 transfer mismatch");
 const wethOutgoing=transfers(input).filter(t=>same(t.from,address));
 if(wethOutgoing.length!==(e.wethRefund>0n?1:0)||(e.wethRefund>0n&&(!same(wethOutgoing[0]!.to,p.payer)||wethOutgoing[0]!.value!==e.wethRefund)))throw Error("Premium budget refund transfer mismatch");
 const approval=await client.readContract({address:asset,abi:erc20Abi,functionName:"allowance",args:[address,pool],blockNumber:receipt.blockNumber});
 if(approval!==0n)throw Error("Repayment Pool allowance was not cleared");
 return {planId:id,commitmentId:p.commitmentId,transactionHash:hash,blockNumber:receipt.blockNumber,payer:p.payer,borrower:p.borrower,path:core.status===2?"AQUA"as const:"BOND"as const,actualRepaid:e.actualRepaid,debtBefore:e.debtBefore,debtAfter:e.debtAfter,scaledDebtBefore:e.scaledDebtBefore,scaledDebtAfter:e.scaledDebtAfter,usdcRefund:e.usdcRefund,wethRefund:e.wethRefund,proceeds:core.proceeds};
}
