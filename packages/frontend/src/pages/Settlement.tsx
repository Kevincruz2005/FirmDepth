import { lazy, Suspense, useEffect, useState } from "react";
import { parseUnits, formatUnits, isAddress, type Hex, type Address } from "viem";
import { useRuntime, useWallet } from "../hooks/useRuntime";
import { deserializeOrder, deserializeQuoteEnvelope } from "../lib/runtime";
import { approveToken } from "@firmdepth/sdk/actions";
import { validateFirmQuoteEnvelope, type FirmQuoteEnvelope } from "@firmdepth/sdk/quote-provider";
import { createPayoutPlan, fundPayoutPlan, acceptPayoutPlan, executePayoutPlan, refundPayoutPlan, readPlan, readPayouts, getPayoutReceipt, settlementAbi, planStates, authenticateSettlement } from "@firmdepth/sdk/settlement";

const DebtRepayment=lazy(()=>import("./DebtRepayment").then(module=>({default:module.DebtRepayment})));
export function Settlement(){
  const [mode,setMode]=useState<"payout"|"debt">("payout");
  return <><div className="settlement-modes" role="group" aria-label="Settlement mode"><button className={`button ${mode==="payout"?"button-dark":"button-outline"}`} aria-pressed={mode==="payout"} onClick={()=>setMode("payout")}>Payout</button><button className={`button ${mode==="debt"?"button-dark":"button-outline"}`} aria-pressed={mode==="debt"} onClick={()=>setMode("debt")}>Debt Repayment</button></div>{mode==="payout"?<PayoutSettlement/>:<Suspense fallback={<p role="status">Loading debt repayment…</p>}><DebtRepayment/></Suspense>}</>;
}
function PayoutSettlement() {
  const {runtime}=useRuntime(); const wallet=useWallet();
  const [rows,setRows]=useState([{recipient:"",amount:"120"},{recipient:"",amount:"80"}]);
  const [input,setInput]=useState("0.1"); const [budget,setBudget]=useState("0.002");
  const [id,setId]=useState<Hex|null>(null); const [plan,setPlan]=useState<Awaited<ReturnType<typeof readPlan>>|null>(null);
  const [allocations,setAllocations]=useState<Awaited<ReturnType<typeof readPayouts>>>([]);
  const [quote,setQuote]=useState<FirmQuoteEnvelope|null>(null); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  const [receipt,setReceipt]=useState<Awaited<ReturnType<typeof getPayoutReceipt>>|null>(null);
  const config=runtime?.artifact.settlement; const strategy=runtime?.artifact.strategies.find(s=>s.kind==="FIRM");
  const publicSepolia=runtime?.artifact.chainId===11155111&&runtime.artifact.environment.kind==="deployment";
  const settlementBlock=config?.deploymentBlock??runtime?.artifact.deploymentBlock??0;
  useEffect(()=>{if(publicSepolia){setInput("0.0001");setBudget("0.00002");setRows([{recipient:"",amount:"0.12"},{recipient:"",amount:"0.08"}]);}},[publicSepolia]);
  const owned=plan?.payer.toLowerCase()===wallet.account?.toLowerCase();
  async function refresh(target=id) {
    if(!runtime||!config||!target)return;
    const [p,a]=await Promise.all([readPlan(runtime.publicClient,config.address,target),readPayouts(runtime.publicClient,config.address,target)]);
    setPlan(p);setAllocations(a);
    if(p.state===4){
      const logs=await runtime.publicClient.getContractEvents({address:config.address,abi:settlementAbi,eventName:"PlanSettled",args:{planId:target},fromBlock:BigInt(settlementBlock)});
      const hash=logs.at(-1)?.transactionHash;if(hash)setReceipt(await getPayoutReceipt(runtime.publicClient,config.address,target,hash,BigInt(settlementBlock)));
    }
  }
  useEffect(()=>{setPlan(null);setId(null);setReceipt(null);setQuote(null);if(!runtime||!config||!wallet.account)return;
    let active=true;
    void runtime.publicClient.getContractEvents({address:config.address,abi:settlementAbi,eventName:"PlanCreated",args:{payer:wallet.account},fromBlock:BigInt(settlementBlock)}).then(async logs=>{const last=logs.at(-1)?.args.planId;if(active&&last){setId(last);await refresh(last);}}).catch(e=>setMessage(String(e)));
    return()=>{active=false};
  },[runtime,config,wallet.account]);
  async function run(action:string) {
    if(!runtime||!config||!strategy||!wallet.account||!wallet.walletClient)return;
    setBusy(true);setMessage("");
    try {
      await authenticateSettlement(runtime.publicClient,config.address,runtime.artifact.addresses);
      const clients={publicClient:runtime.publicClient,walletClient:wallet.walletClient,account:wallet.account};
      const wait=async(hash:Hex)=>{setMessage(`Submitted ${hash}`);const r=await runtime.publicClient.waitForTransactionReceipt({hash});if(r.status!=="success")throw new Error("Transaction reverted");};
      if(action==="create"){
        if(rows.some(r=>!isAddress(r.recipient)))throw new Error("Enter valid recipient addresses");
        const block=await runtime.publicClient.getBlock();
        const nonce=BigInt(`0x${Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("")}`);
        const result=await createPayoutPlan(clients,config.address,nonce,parseUnits(input,18),parseUnits(budget,18),block.timestamp+3600n,rows.map(r=>({recipient:r.recipient as Address,amount:parseUnits(r.amount,6)})));
        await wait(result.hash);setId(result.planId);await refresh(result.planId);
      } else if(id&&plan){
        if(action==="fund"){await wait(await approveToken(clients,runtime.artifact.addresses.weth,config.address,plan.amountIn+plan.maxPremium));await wait(await fundPayoutPlan(clients,config.address,id));}
        if(action==="quote"){
          const response=await fetch(config.quoteUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chainId:runtime.artifact.chainId,settlement:config.address,planId:id,pricingTtl:120})});
          const body=await response.json();if(!response.ok)throw new Error(body.error??"Quote unavailable");
          const envelope=deserializeQuoteEnvelope(body);
          await validateFirmQuoteEnvelope(runtime.publicClient,envelope,{chainId:runtime.artifact.chainId,registry:runtime.artifact.addresses.registry,executor:runtime.artifact.addresses.executor,router:runtime.artifact.addresses.firmRouter,tokenIn:runtime.artifact.addresses.weth,tokenOut:runtime.artifact.addresses.usdc,orderHash:strategy.orderHash,order:deserializeOrder(strategy.order),maker:strategy.order.maker,taker:config.address,amountIn:plan.amountIn,pricingTtl:120});setQuote(envelope);
        }
        if(action==="accept"&&quote){await wait(await acceptPayoutPlan(clients,config.address,id,quote.quote,deserializeOrder(strategy.order),quote.makerSignature));setQuote(null);}
        if(action==="execute")await wait(await executePayoutPlan(clients,config.address,id,deserializeOrder(strategy.order)));
        if(action==="refund")await wait(await refundPayoutPlan(clients,config.address,id));
        await refresh();
      }
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  const disabled=busy||!wallet.account||wallet.chainId!==runtime?.artifact.chainId;
  return <div className="settlement-page"><p className="eyebrow">Mumbai Continuity · Protected settlement</p><h1>One commitment.<br/>Every recipient paid.</h1><p>Fund a fixed payout plan with WETH. Accepted FirmDepth collateral protects the USDC settlement when shared Aqua capacity disappears.</p>
    {!config?<p role="status">Protected settlement is unavailable on this deployment. Start the protected local fork to create a plan.</p>:<>
      <p className="truth-tag">{runtime?.artifact.environment.kind==="base-fork"?"LIVE LOCAL FORK · not public testnet":"SEPOLIA TESTNET · LIVE"}</p>
      {publicSepolia&&<p>Public testnet defaults use scaled 0.12 / 0.08 USDC payouts. Use the local Base fork for the 120 / 80 USDC sibling-drain demonstration.</p>}
      <p>Signed taker: <code>{config.address}</code></p><p>Payer: <code>{wallet.account??"Connect your treasury wallet"}</code></p>
      {(!plan||plan.state>=4)?<section><h2>Create immutable payouts</h2><p>The payer receives surplus and refunds. The plan deadline is one hour; accepted quotes last 120 seconds. Accepted premiums are retained by the maker, including on expiry.</p>
        <label>WETH principal<input value={input} onChange={e=>setInput(e.target.value)}/></label><label>Maximum WETH premium<input value={budget} onChange={e=>setBudget(e.target.value)}/></label>
        {rows.map((r,i)=><div className="payout-row" key={i}><label>Recipient {i+1}<input value={r.recipient} onChange={e=>setRows(rows.map((v,j)=>j===i?{...v,recipient:e.target.value}:v))}/></label><label>USDC allocation {i+1}<input value={r.amount} onChange={e=>setRows(rows.map((v,j)=>j===i?{...v,amount:e.target.value}:v))}/></label>{rows.length>1&&<button onClick={()=>setRows(rows.filter((_,j)=>i!==j))}>Remove</button>}</div>)}
        <button disabled={rows.length>=32} onClick={()=>setRows([...rows,{recipient:"",amount:""}])}>Add recipient</button><button className="button button-dark" disabled={disabled} onClick={()=>void run("create")}>Create payout plan</button>
      </section>:null}
      {plan&&<section><h2>{planStates[plan.state]}</h2><code>{id}</code><p>Escrow: {formatUnits(plan.escrow,18)} WETH · Premium paid: {formatUnits(plan.premiumPaid,18)} WETH</p><ul>{allocations.map((a,i)=><li key={i}><code>{a.recipient}</code> — {formatUnits(a.amount,6)} USDC</li>)}</ul>
        {plan.state===1&&<button className="button button-dark" disabled={disabled||!owned} onClick={()=>void run("fund")}>Approve and fund</button>}
        {plan.state===2&&<><button className="button button-dark" disabled={disabled||!owned} onClick={()=>void run("quote")}>Inspect signed quote</button>{quote&&<div><p>Output: {formatUnits(quote.quote.minAmountOut,6)} USDC · Premium: {formatUnits(quote.quote.premiumAmount,18)} WETH · Bond: {formatUnits(quote.quote.requiredBond,6)} USDC</p><p>Expires: {new Date(Number(quote.quote.expiry)*1000).toISOString()}</p><button className="button button-dark" disabled={disabled||!owned} onClick={()=>void run("accept")}>Accept commitment</button></div>}</>}
        {plan.state===3&&<><p>Commitment: <code>{plan.commitmentId}</code></p><button className="button button-dark" disabled={disabled||!owned} onClick={()=>void run("execute")}>Execute atomic payouts</button></>}
        {plan.state>0&&plan.state<4&&<button className="button button-outline" disabled={disabled||!owned} onClick={()=>void run("refund")}>{plan.state===3?"Refund after expiry":"Cancel and refund"}</button>}
        <button disabled={busy} onClick={()=>void refresh().catch(e=>setMessage(String(e)))}>Refresh plan</button>
      </section>}
      {receipt&&<section><h2>Verified recipient payments</h2><p>{receipt.status===2?"Aqua settlement":"Covered bond settlement"} · Block {receipt.blockNumber.toString()}</p><code>{receipt.transactionHash}</code><p>Paid {formatUnits(receipt.proceeds-receipt.surplus,6)} USDC · Surplus {formatUnits(receipt.surplus,6)} USDC · WETH refund {formatUnits(receipt.refund,18)}</p></section>}
      <p role="status" className="settlement-message">{busy?"Waiting for wallet or chain… ":""}{message}</p>
    </>}
  </div>;
}
