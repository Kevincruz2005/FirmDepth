import {useCallback,useEffect,useState} from "react";
import {formatUnits,isAddress,parseUnits,toHex,type Address,type Hex} from "viem";
import {useRuntime,useWallet} from "../hooks/useRuntime";
import {deserializeOrder,deserializeQuoteEnvelope} from "../lib/runtime";
import {approveToken} from "@firmdepth/sdk/actions";
import {validateFirmQuoteEnvelope,type FirmQuoteEnvelope} from "@firmdepth/sdk/quote-provider";
import {planStates} from "@firmdepth/sdk/settlement";
import {authenticateDebtRepayment,inspectAaveRepaymentReserve,readBorrowerDebt,readDebtPlan,createDebtRepaymentPlan,fundDebtPlan,acceptDebtPlan,executeDebtPlan,refundDebtPlan,getDebtRepaymentReceipt,debtRepaymentAbi} from "@firmdepth/sdk/debt-repayment";

export function DebtRepayment(){
 const {runtime}=useRuntime();const wallet=useWallet();
 const config=runtime?.artifact.debtRepayment;const wrapper=runtime?.artifact.settlement;
 const strategy=runtime?.artifact.strategies.find(s=>s.kind==="FIRM");
 const [borrower,setBorrower]=useState("");const [input,setInput]=useState("0.1");const [premium,setPremium]=useState("0.002");
 const [maximum,setMaximum]=useState("200");const [minimum,setMinimum]=useState("1");
 const [debt,setDebt]=useState<Awaited<ReturnType<typeof readBorrowerDebt>>|null>(null);
 const [id,setId]=useState<Hex|null>(null);const [plan,setPlan]=useState<Awaited<ReturnType<typeof readDebtPlan>>|null>(null);
 const [quote,setQuote]=useState<FirmQuoteEnvelope|null>(null);const [receipt,setReceipt]=useState<Awaited<ReturnType<typeof getDebtRepaymentReceipt>>|null>(null);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 const owned=plan?.repayment.payer.toLowerCase()===wallet.account?.toLowerCase();
 useEffect(()=>{const initial=wallet.account||config?.borrower;if(initial)setBorrower(current=>current||initial);},[wallet.account,config?.borrower]);
 useEffect(()=>{
  let active=true;setDebt(null);
  if(!runtime||!config||!isAddress(borrower))return;
  const timer=setTimeout(()=>{void readBorrowerDebt(runtime.publicClient,borrower).then(value=>{if(active)setDebt(value);}).catch(e=>{if(active)setMessage(String(e));});},300);
  return()=>{active=false;clearTimeout(timer);};
 },[runtime,config,borrower]);
 const refresh=useCallback(async(target:Hex|null)=>{
  if(!runtime||!config||!target)return;
  const p=await readDebtPlan(runtime.publicClient,config.address,target);setPlan(p);setBorrower(p.repayment.borrower);
  setDebt(await readBorrowerDebt(runtime.publicClient,p.repayment.borrower));
  if(p.underlying.state===4){
   const logs=await runtime.publicClient.getContractEvents({address:config.address,abi:debtRepaymentAbi,eventName:"DebtRepaid",args:{planId:target},fromBlock:BigInt(config.deploymentBlock)});
   const hash=logs.at(-1)?.transactionHash;
   if(hash)setReceipt(await getDebtRepaymentReceipt(runtime.publicClient,config.address,target,hash,BigInt(runtime.artifact.deploymentBlock)));
  }
 },[runtime,config]);
 useEffect(()=>{
  let active=true;setId(null);setPlan(null);setReceipt(null);setQuote(null);
  if(!runtime||!config||!wallet.account)return;
  void runtime.publicClient.getContractEvents({address:config.address,abi:debtRepaymentAbi,eventName:"RepaymentCreated",args:{payer:wallet.account},fromBlock:BigInt(config.deploymentBlock)}).then(async logs=>{const found=logs.at(-1)?.args.planId;if(active&&found){setId(found);await refresh(found);}}).catch(e=>{if(active)setMessage(String(e));});
  return()=>{active=false;};
 },[runtime,config,wallet.account,refresh]);
 async function run(action:string){
  if(!runtime||!config||!wrapper||!strategy||!wallet.account||!wallet.walletClient)return;
  setBusy(true);setMessage("");
  try{
   await authenticateDebtRepayment(runtime.publicClient,config.address,{settlement:wrapper.address,...runtime.artifact.addresses});
   if(action!=="refund"){const reserve=await inspectAaveRepaymentReserve(runtime.publicClient,config.address);if(!reserve.active||reserve.paused)throw Error("Aave reserve is inactive or paused. Owner refunds remain available under the plan's expiry rules.");}
   // Base forks share chain 8453 with mainnet. Confirm the wallet's RPC sees this deployment.
   const walletCode=await wallet.walletClient.transport.request({method:"eth_getCode",params:[config.address,"latest"]});
   const actualCode=await runtime.publicClient.getBytecode({address:config.address});
   if(walletCode!==actualCode)throw Error("Connect your wallet to the local fork RPC containing this repayment deployment.");
   const referenceBlock=await runtime.publicClient.getBlock();
   const walletBlock=await wallet.walletClient.transport.request({method:"eth_getBlockByNumber",params:[toHex(referenceBlock.number),false]}) as {hash?:Hex}|null;
   if(walletBlock?.hash!==referenceBlock.hash)throw Error("The wallet RPC does not match the local fork. Select the local fork RPC before submitting transactions.");
   const clients={publicClient:runtime.publicClient,walletClient:wallet.walletClient,account:wallet.account};
   const wait=async(hash:Hex)=>{setMessage(`Submitted ${hash}`);const r=await runtime.publicClient.waitForTransactionReceipt({hash});if(r.status!=="success")throw Error("Transaction reverted");};
   if(action==="create"){
    if(!isAddress(borrower))throw Error("Enter a valid borrower address");
    const block=await runtime.publicClient.getBlock();
    const nonce=BigInt(`0x${Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("")}`);
    const result=await createDebtRepaymentPlan(clients,config.address,{nonce,borrower:borrower as Address,amountIn:parseUnits(input,18),maxPremium:parseUnits(premium,18),deadline:block.timestamp+3600n,maxRepay:parseUnits(maximum,6),minRepay:parseUnits(minimum,6)});
    await wait(result.hash);setReceipt(null);setQuote(null);setId(result.planId);await refresh(result.planId);
   }else if(id&&plan){
    if(action==="fund"){await wait(await approveToken(clients,runtime.artifact.addresses.weth,config.address,plan.underlying.amountIn+plan.underlying.maxPremium));await wait(await fundDebtPlan(clients,config.address,id));}
    if(action==="quote"){
     const response=await fetch(wrapper.quoteUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chainId:runtime.artifact.chainId,settlement:wrapper.address,planId:id,pricingTtl:120})});
     const body=await response.json();if(!response.ok)throw Error(body.error??"Quote unavailable");
     const envelope=deserializeQuoteEnvelope(body);
     await validateFirmQuoteEnvelope(runtime.publicClient,envelope,{chainId:runtime.artifact.chainId,registry:runtime.artifact.addresses.registry,executor:runtime.artifact.addresses.executor,router:runtime.artifact.addresses.firmRouter,tokenIn:runtime.artifact.addresses.weth,tokenOut:runtime.artifact.addresses.usdc,orderHash:strategy.orderHash,order:deserializeOrder(strategy.order),maker:strategy.order.maker,taker:wrapper.address,amountIn:plan.underlying.amountIn,pricingTtl:120});setQuote(envelope);
    }
    if(action==="accept"&&quote){await wait(await acceptDebtPlan(clients,config.address,id,quote.quote,deserializeOrder(strategy.order),quote.makerSignature));setQuote(null);}
    if(action==="execute")await wait(await executeDebtPlan(clients,config.address,id,deserializeOrder(strategy.order)));
    if(action==="refund")await wait(await refundDebtPlan(clients,config.address,id));
    await refresh(id);
   }
  }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 const disabled=busy||!wallet.account||wallet.chainId!==runtime?.artifact.chainId;
 return <div className="settlement-page debt-repayment-page"><p className="eyebrow">Mumbai Continuity · Protected debt repayment</p><h1>One commitment.<br/>Verified debt repaid.</h1><p>Use WETH to fund an atomic Aave V3 USDC repayment through Aqua or FirmDepth’s covered bond settlement.</p>
 {!config||!wrapper?<p role="status">Debt repayment requires the verified Aave V3 native-USDC reserve on the local Base fork. This deployment has no authenticated repayment adapter.</p>:<>
  <p className="truth-tag">{runtime?.artifact.environment.hosting==="azure"?"LIVE AZURE FORK":"LIVE LOCAL FORK"} · real Aave contracts · not public mainnet</p>
  {runtime?.artifact.environment.hosting==="azure"&&<p>This shared demonstration resets when its fork process restarts. <a href="/demo/evidence" target="_blank" rel="noreferrer">Verified hosted transaction evidence</a> · <a href="/demo/deployment" target="_blank" rel="noreferrer">Deployment addresses</a></p>}
  <p>Signed taker: <code>{wrapper.address}</code></p><p>Repayment adapter: <code>{config.address}</code></p><p>Aave Pool: <code>{config.pool}</code> · Variable debt mode 2</p>
  <p>Only the authorized payer can fund, accept, execute or refund this immutable plan. Debt and reserve availability are checked at execution. This action does not guarantee protection from liquidation.</p>
  {(!plan||plan.underlying.state>=4)&&<section><h2>Create immutable debt repayment</h2><label>Borrower address<input value={borrower} onChange={e=>setBorrower(e.target.value)}/></label>
   <p className="verified-debt">{debt?`Verified borrower debt: ${formatUnits(debt.balance,6)} USDC · block ${debt.blockNumber}`:"Enter a borrower address to inspect real Aave debt."}</p>
   <label>Repayment WETH input<input value={input} onChange={e=>setInput(e.target.value)}/></label><label>Repayment premium budget<input value={premium} onChange={e=>setPremium(e.target.value)}/></label>
   <label>Maximum USDC repayment<input value={maximum} onChange={e=>setMaximum(e.target.value)}/></label><label>Minimum USDC repayment<input value={minimum} onChange={e=>setMinimum(e.target.value)}/></label>
   <p>The plan lasts one hour. If debt falls below the cap, the remaining USDC returns to the payer. Execution reverts if actual repayment is below the authorized minimum. Accepted premiums remain payable on expiry.</p>
   <button className="button button-dark" disabled={disabled||!debt||debt.balance===0n} onClick={()=>void run("create")}>Create repayment plan</button>
  </section>}
  {plan&&<section><h2>{planStates[plan.underlying.state]}</h2><code>{id}</code><p>Borrower: <code>{plan.repayment.borrower}</code></p><p>Authorized repayment: {formatUnits(plan.repayment.minRepay,6)}–{formatUnits(plan.repayment.maxRepay,6)} USDC</p><p>WETH input: {formatUnits(plan.underlying.amountIn,18)} · Premium budget: {formatUnits(plan.underlying.maxPremium,18)} · Premium paid: {formatUnits(plan.underlying.premiumPaid,18)}</p><p>Plan deadline: {new Date(Number(plan.underlying.deadline)*1000).toISOString()}</p>
   {debt&&<p>Verified borrower debt: {formatUnits(debt.balance,6)} USDC · block {debt.blockNumber.toString()}</p>}
   {plan.underlying.state===1&&<button className="button button-dark" disabled={disabled||!owned} onClick={()=>void run("fund")}>Approve and fund repayment</button>}
   {plan.underlying.state===2&&<><button className="button button-dark" disabled={disabled||!owned} onClick={()=>void run("quote")}>Inspect repayment quote</button>{quote&&<div><p>USDC minimum: {formatUnits(quote.quote.minAmountOut,6)} · WETH premium: {formatUnits(quote.quote.premiumAmount,18)} · USDC bond: {formatUnits(quote.quote.requiredBond,6)}</p><p>Commitment expiry: {new Date(Number(quote.quote.expiry)*1000).toISOString()}</p><button className="button button-dark" disabled={disabled||!owned} onClick={()=>void run("accept")}>Accept repayment commitment</button></div>}</>}
   {plan.underlying.state===3&&<><p>Commitment: <code>{plan.repayment.commitmentId}</code></p><button className="button button-dark" disabled={disabled||!owned} onClick={()=>void run("execute")}>Execute atomic repayment</button></>}
   {plan.underlying.state>0&&plan.underlying.state<4&&<button className="button button-outline" disabled={disabled||!owned} onClick={()=>void run("refund")}>{plan.underlying.state===3?"Refund repayment after expiry":"Cancel repayment and refund"}</button>}
   <button disabled={busy} onClick={()=>void refresh(id).catch(e=>setMessage(String(e)))}>Refresh repayment</button>
  </section>}
  {receipt&&<section className="verified-repayment"><h2>Verified Aave repayment</h2><p>{receipt.path==="AQUA"?"Aqua settlement":"Covered bond settlement"} · Block {receipt.blockNumber.toString()}</p><p>Actual USDC repaid: {formatUnits(receipt.actualRepaid,6)}</p><p>Debt before: {formatUnits(receipt.debtBefore,6)} USDC · Debt after: {formatUnits(receipt.debtAfter,6)} USDC</p><p>USDC surplus refunded: {formatUnits(receipt.usdcRefund,6)} · WETH budget refunded: {formatUnits(receipt.wethRefund,18)}</p><code>{receipt.transactionHash}</code><p>Pool repayment, scaled debt reduction, token transfers and underlying FirmDepth settlement verified from this local transaction.</p></section>}
  <p role="status" className="settlement-message">{busy?"Waiting for wallet or chain… ":""}{message}</p>
 </>}
 </div>;
}
