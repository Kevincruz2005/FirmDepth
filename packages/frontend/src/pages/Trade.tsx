import { acceptFirm, approveToken, executeFirm, executeSoftSwap, expireFirm } from "@firmdepth/sdk/actions";
import { firmDepthForQuote } from "@firmdepth/sdk/capacity";
import { findCommitmentsForTaker, type CommitmentHistoryItem } from "@firmdepth/sdk/history";
import { validateFirmQuoteEnvelope, firmHorizons, type FirmHorizon, type FirmQuoteEnvelope } from "@firmdepth/sdk/quote-provider";
import { checkFirmEligibility, getLiquidityReality, quoteSwapExactIn, readTokenBalance, type FirmEligibility, type LiquidityReality } from "@firmdepth/sdk/readers";
import { getFirmExecutionReceipt, type FirmExecutionReceipt } from "@firmdepth/sdk/receipt";
import { buildFirmQuoteTakerTraits } from "@firmdepth/sdk/swapvm";
import { ArrowRight, Check, CircleAlert, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { ReceiptView } from "../components/ReceiptView";
import { DepthDiagram } from "../components/Visuals";
import { Eyebrow, Metric, StatusDot, TruthTag } from "../components/Primitives";
import { useRuntime, useWallet } from "../hooks/useRuntime";
import { formatToken, shortHex } from "../lib/format";
import { deserializeOrder, deserializeQuoteEnvelope } from "../lib/runtime";

type ExecutionPhase = "IDLE" | "APPROVING" | "SUBMITTING" | "CONFIRMING" | "COMPLETE" | "ERROR";

export function Trade() {
  const { runtime, loading, error: runtimeError, refresh: refreshRuntime } = useRuntime();
  const wallet = useWallet();
  const [mode, setMode] = useState<"SOFT" | "FIRM">("FIRM");
  const [amount, setAmount] = useState("0.1");
  const [horizon, setHorizon] = useState<FirmHorizon>(30);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [liquidity, setLiquidity] = useState<LiquidityReality | null>(null);
  const [softQuote, setSoftQuote] = useState<Awaited<ReturnType<typeof quoteSwapExactIn>> | null>(null);
  const [firmQuote, setFirmQuote] = useState<FirmQuoteEnvelope | null>(null);
  const [eligibility, setEligibility] = useState<FirmEligibility | null>(null);
  const [commitment, setCommitment] = useState<CommitmentHistoryItem | null>(null);
  const [receipt, setReceipt] = useState<FirmExecutionReceipt | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [phase, setPhase] = useState<ExecutionPhase>("IDLE");
  const [action, setAction] = useState("Ready to inspect");

  const strategy = useMemo(() => runtime?.artifact.strategies.find((item) => item.kind === mode) ?? null, [runtime, mode]);
  const firmStrategy = useMemo(() => runtime?.artifact.strategies.find((item) => item.kind === "FIRM") ?? null, [runtime]);
  const amountResult = useMemo(() => parseAmount(amount, balance), [amount, balance]);
  const accepted = commitment?.commitment.status === "ACCEPTED";
  const acceptedQuote = accepted ? commitment.commitment.quote : firmQuote?.quote ?? null;

  const recoverCommitment = useCallback(async () => {
    if (runtime === null || wallet.account === null || firmStrategy === null) {
      setCommitment(null); setReceipt(null); return;
    }
    const found = await findCommitmentsForTaker(runtime.publicClient, runtime.artifact.addresses.registry, wallet.account, firmStrategy.orderHash, BigInt(runtime.artifact.deploymentBlock));
    const latest = found.find((item) => item.commitment.status === "ACCEPTED") ?? found[0] ?? null;
    setCommitment(latest); setReceipt(null);
    if (latest?.terminalTransactionHash) {
      setReceipt(await getFirmExecutionReceipt(runtime.publicClient, {
        registry: runtime.artifact.addresses.registry, executor: runtime.artifact.addresses.executor,
        router: runtime.artifact.addresses.firmRouter, vault: runtime.artifact.addresses.bondVault,
        commitmentId: latest.commitmentId, acceptanceTransactionHash: latest.acceptanceTransactionHash,
        terminalTransactionHash: latest.terminalTransactionHash,
      }));
      setPhase("COMPLETE"); setAction(`${latest.commitment.status} · receipt reconstructed from chain`);
    } else if (latest?.commitment.status === "ACCEPTED") {
      const block = await runtime.publicClient.getBlock();
      setPhase("COMPLETE");
      setAction(block.timestamp > latest.commitment.quote.expiry ? "ACCEPTED · expired, settlement available" : "Commitment accepted · restored from chain");
      setAmount(formatUnits(latest.commitment.quote.amountIn, 18));
      setHorizon(firmHorizons.includes(latest.commitment.quote.pricingTtl as FirmHorizon) ? latest.commitment.quote.pricingTtl as FirmHorizon : 120);
    }
  }, [firmStrategy, runtime, wallet.account]);

  useEffect(() => { void recoverCommitment().catch((cause) => setInspectError(errorMessage(cause))); }, [recoverCommitment, wallet.epoch]);

  const inspect = useCallback(async () => {
    if (runtime === null || strategy === null) return;
    setInspecting(true); setInspectError(null);
    try {
      const order = deserializeOrder(strategy.order);
      const baseQuery = { aqua: runtime.artifact.addresses.aqua, router: runtime.artifact.addresses.firmRouter, maker: order.maker, orderHash: strategy.orderHash, tokenIn: runtime.artifact.addresses.weth, tokenOut: runtime.artifact.addresses.usdc };
      const nextLiquidity = await getLiquidityReality(runtime.publicClient, baseQuery);
      setLiquidity(nextLiquidity);
      if (wallet.account) setBalance(await readTokenBalance(runtime.publicClient, runtime.artifact.addresses.weth, wallet.account));
      else setBalance(null);
      if (amountResult.value !== null) {
        if (mode === "SOFT") {
          const quoted = await quoteSwapExactIn(runtime.publicClient, runtime.artifact.addresses.firmRouter, order, amountResult.value, strategy.takerTraits);
          if (quoted.orderHash.toLowerCase() !== strategy.orderHash.toLowerCase() || quoted.amountIn !== amountResult.value) throw new Error("SwapVM returned a mismatched Soft quote");
          setSoftQuote(quoted); setEligibility(null);
        } else if (firmQuote !== null) {
          const traits = buildFirmQuoteTakerTraits({ amountOut: firmQuote.quote.minAmountOut, tokenIn: firmQuote.quote.tokenIn, tokenOut: firmQuote.quote.tokenOut, deadline: firmQuote.quote.expiry });
          setEligibility(await checkFirmEligibility(runtime.publicClient, { ...baseQuery, vault: runtime.artifact.addresses.bondVault, requiredBond: firmQuote.quote.requiredBond, requiredOutput: firmQuote.quote.minAmountOut, amountIn: firmQuote.quote.amountIn, order, takerTraits: traits }));
        }
      }
    } catch (cause) { setInspectError(errorMessage(cause)); }
    finally { setInspecting(false); }
  }, [amountResult.value, firmQuote, mode, runtime, strategy, wallet.account]);

  useEffect(() => { void inspect(); }, [inspect]);

  useEffect(() => {
    if (mode !== "FIRM" || accepted || runtime === null || strategy === null || wallet.account === null || amountResult.value === null) {
      if (!accepted) { setFirmQuote(null); setEligibility(null); }
      return;
    }
    setFirmQuote(null); setEligibility(null); setInspectError(null); setInspecting(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(runtime.artifact.quoteProvider.url, { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ chainId: runtime.artifact.chainId, registry: runtime.artifact.addresses.registry, strategyId: strategy.id, orderHash: strategy.orderHash, taker: wallet.account, amountIn: amountResult.value!.toString(), pricingTtl: horizon }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? `Firm quote provider failed (${response.status})`);
        const envelope = deserializeQuoteEnvelope(payload);
        await validateFirmQuoteEnvelope(runtime.publicClient, envelope, { chainId: runtime.artifact.chainId, registry: runtime.artifact.addresses.registry, executor: runtime.artifact.addresses.executor, router: runtime.artifact.addresses.firmRouter, tokenIn: runtime.artifact.addresses.weth, tokenOut: runtime.artifact.addresses.usdc, orderHash: strategy.orderHash, order: deserializeOrder(strategy.order), maker: strategy.order.maker, taker: wallet.account!, amountIn: amountResult.value!, pricingTtl: horizon });
        setFirmQuote(envelope);
      } catch (cause) { if (!controller.signal.aborted) setInspectError(errorMessage(cause)); }
      finally { if (!controller.signal.aborted) setInspecting(false); }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [accepted, amountResult.value, horizon, mode, runtime, strategy, wallet.account, wallet.epoch]);

  async function runTrade() {
    if (runtime === null || strategy === null || wallet.account === null || wallet.walletClient === null || amountResult.value === null) return;
    const clients = { publicClient: runtime.publicClient, walletClient: wallet.walletClient, account: wallet.account };
    const order = deserializeOrder(strategy.order);
    try {
      setReceipt(null);
      if (mode === "SOFT") {
        if (softQuote === null) throw new Error("Refresh the current Soft quote first");
        setPhase("APPROVING"); setAction("Approving WETH for the SwapVM router");
        const approval = await approveToken(clients, runtime.artifact.addresses.weth, runtime.artifact.addresses.firmRouter, amountResult.value);
        await runtime.publicClient.waitForTransactionReceipt({ hash: approval });
        setPhase("SUBMITTING"); setAction("Submitting the current Soft Aqua quote");
        const swap = await executeSoftSwap(clients, runtime.artifact.addresses.firmRouter, order, amountResult.value, strategy.takerTraits);
        setPhase("CONFIRMING"); setAction("Waiting for the Soft swap receipt");
        await runtime.publicClient.waitForTransactionReceipt({ hash: swap.hash });
        setPhase("COMPLETE"); setAction(`Soft execution confirmed · ${formatToken(swap.amountOut, 6, 2)} USDC`);
        await inspect(); return;
      }
      if (!accepted) {
        if (firmQuote === null) throw new Error("Request a current maker-signed Firm quote first");
        await validateFirmQuoteEnvelope(runtime.publicClient, firmQuote, { chainId: runtime.artifact.chainId, registry: runtime.artifact.addresses.registry, executor: runtime.artifact.addresses.executor, router: runtime.artifact.addresses.firmRouter, tokenIn: runtime.artifact.addresses.weth, tokenOut: runtime.artifact.addresses.usdc, orderHash: strategy.orderHash, order, maker: strategy.order.maker, taker: wallet.account, amountIn: amountResult.value, pricingTtl: horizon });
        const traits = buildFirmQuoteTakerTraits({ amountOut: firmQuote.quote.minAmountOut, tokenIn: firmQuote.quote.tokenIn, tokenOut: firmQuote.quote.tokenOut, deadline: firmQuote.quote.expiry });
        const gate = await checkFirmEligibility(runtime.publicClient, { aqua: runtime.artifact.addresses.aqua, router: runtime.artifact.addresses.firmRouter, vault: runtime.artifact.addresses.bondVault, maker: firmQuote.quote.maker, orderHash: firmQuote.quote.orderHash, tokenIn: firmQuote.quote.tokenIn, tokenOut: firmQuote.quote.tokenOut, requiredBond: firmQuote.quote.requiredBond, requiredOutput: firmQuote.quote.minAmountOut, amountIn: firmQuote.quote.amountIn, order, takerTraits: traits });
        setEligibility(gate);
        if (!gate.eligible) throw new Error(`Firm acceptance blocked: ${gate.reasons.join(", ")}`);
        setPhase("APPROVING"); setAction("Approving the exact Firm premium");
        const approval = await approveToken(clients, firmQuote.quote.premiumToken, runtime.artifact.addresses.registry, firmQuote.quote.premiumAmount);
        await runtime.publicClient.waitForTransactionReceipt({ hash: approval });
        setPhase("SUBMITTING"); setAction("Accepting the current maker-signed commitment");
        const result = await acceptFirm(clients, runtime.artifact.addresses.registry, firmQuote.quote, order, firmQuote.makerSignature);
        await runtime.publicClient.waitForTransactionReceipt({ hash: result.hash });
        setPhase("CONFIRMING"); setAction("Reading accepted commitment from chain");
        await recoverCommitment();
        setPhase("COMPLETE"); setAction("Commitment accepted · bond locked");
      } else if (acceptedQuote !== null) {
        setPhase("APPROVING"); setAction("Approving exact trader input");
        const approval = await approveToken(clients, acceptedQuote.tokenIn, runtime.artifact.addresses.executor, acceptedQuote.amountIn);
        await runtime.publicClient.waitForTransactionReceipt({ hash: approval });
        setPhase("SUBMITTING"); setAction("Executing the accepted Firm commitment");
        const executed = await executeFirm(clients, runtime.artifact.addresses.executor, commitment.commitmentId, order);
        await runtime.publicClient.waitForTransactionReceipt({ hash: executed.hash });
        setPhase("CONFIRMING"); setAction("Reconciling terminal onchain evidence");
        await recoverCommitment();
      }
    } catch (cause) { setPhase("ERROR"); setAction(errorMessage(cause)); }
  }

  async function expireAccepted() {
    if (runtime === null || wallet.account === null || wallet.walletClient === null || commitment === null) return;
    try {
      setPhase("SUBMITTING"); setAction("Settling the expired commitment");
      const hash = await expireFirm({ publicClient: runtime.publicClient, walletClient: wallet.walletClient, account: wallet.account }, runtime.artifact.addresses.registry, commitment.commitmentId);
      await runtime.publicClient.waitForTransactionReceipt({ hash });
      await recoverCommitment();
    } catch (cause) { setPhase("ERROR"); setAction(errorMessage(cause)); }
  }

  const quoteOutput = mode === "SOFT" ? softQuote?.amountOut ?? null : acceptedQuote?.minAmountOut ?? null;
  const firmCapacity = liquidity && acceptedQuote ? firmDepthForQuote(liquidity.pullableDepth, eligibility?.availableBond ?? 0n, acceptedQuote.minAmountOut, acceptedQuote.requiredBond) : null;
  const busy = ["APPROVING", "SUBMITTING", "CONFIRMING"].includes(phase);
  const canTrade = runtime !== null && strategy !== null && wallet.walletClient !== null && amountResult.value !== null && !busy && (mode === "SOFT" ? softQuote !== null : accepted || (firmQuote !== null && eligibility?.eligible === true));

  return <div className="app-page trade-page">
    <header className="page-title"><div><Eyebrow>Execution terminal</Eyebrow><h1>Trade the depth you can prove.</h1><p>Quote current Aqua liquidity, then choose a Soft attempt or a maker-signed, collateralized Firm commitment.</p></div><TruthTag value={runtime ? "LIVE" : "ILLUSTRATIVE"} /></header>
    <div className="trade-layout">
      <section className="trade-ticket" aria-labelledby="trade-ticket-title">
        <div className="mode-switch" role="tablist" aria-label="Execution class">{(["SOFT", "FIRM"] as const).map((value) => <button id={`trade-tab-${value.toLowerCase()}`} aria-controls={`trade-panel-${value.toLowerCase()}`} tabIndex={mode === value ? 0 : -1} key={value} role="tab" aria-selected={mode === value} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" || event.key === "ArrowLeft" ? "SOFT" : "FIRM"; setMode(next); document.getElementById(`trade-tab-${next.toLowerCase()}`)?.focus(); } }} onClick={() => { setMode(value); setPhase("IDLE"); setInspectError(null); }}>{value === "FIRM" && <ShieldCheck size={15} />} {value === "SOFT" ? "Soft" : "Firm"}</button>)}</div>
        <div id={`trade-panel-${mode.toLowerCase()}`} role="tabpanel" aria-labelledby={`trade-tab-${mode.toLowerCase()}`}>
          <h2 id="trade-ticket-title" className="sr-only">Trade details</h2>
          <label className="token-field amount-entry"><span>Sell</span><input aria-label="WETH amount" inputMode="decimal" value={amount} disabled={accepted} onChange={(event) => { setAmount(event.target.value); setSoftQuote(null); setFirmQuote(null); setEligibility(null); setPhase("IDLE"); }} /><b>WETH</b><small>{wallet.account ? `Balance ${balance === null ? "…" : formatToken(balance, 18, 4)} WETH` : "Connect wallet to verify balance"}</small></label>
          {amountResult.error && <p className="inline-error"><CircleAlert size={15} />{amountResult.error}</p>}
          <div className="swap-divider"><span>↓</span></div>
          <div className="token-field output"><label>{mode === "FIRM" ? "Receive at least" : "Current quoted output"}</label><strong>{quoteOutput === null ? "—" : formatToken(quoteOutput, 6, 2)}</strong><span>USDC</span><small>{mode === "FIRM" ? "Signed minimum, threshold-bound" : softQuote ? `SwapVM quote · block ${softQuote.blockNumber}` : "Current strategy read required"}</small></div>
          {mode === "FIRM" && !accepted && <fieldset className="horizon-picker"><legend>Firm horizon</legend>{firmHorizons.map((seconds) => <button type="button" key={seconds} aria-pressed={horizon === seconds} onClick={() => { setHorizon(seconds); setFirmQuote(null); setEligibility(null); }}>{seconds}s</button>)}</fieldset>}
          {mode === "FIRM" && acceptedQuote && <div className="premium-row"><span>Firm premium</span><strong>{formatToken(acceptedQuote.premiumAmount, 18, 8)} WETH</strong><small>Pricing v2 · signed TTL {acceptedQuote.pricingTtl}s</small></div>}
          <div className="ticket-status">{runtime === null ? <StatusDot>{loading ? "Checking runtime…" : "Evidence mode · no transaction"}</StatusDot> : inspectError ? <StatusDot tone="bad">Quote unavailable</StatusDot> : inspecting ? <StatusDot>Reading current state…</StatusDot> : mode === "FIRM" && eligibility ? <StatusDot tone={eligibility.eligible ? "good" : "bad"}>{eligibility.eligible ? "Eligible at observed block" : "Not Firm-eligible"}</StatusDot> : <StatusDot tone="live">Strategy live</StatusDot>}{eligibility && <span>block {eligibility.blockNumber.toString()}</span>}</div>
          {runtime === null ? <button className="button button-primary button-wide" onClick={() => void refreshRuntime()} disabled={loading}><RefreshCw size={17} /> Recheck runtime</button> : wallet.account === null || wallet.walletClient === null ? <button className="button button-dark button-wide" onClick={() => void wallet.connect()} disabled={wallet.connecting}><Wallet size={17} />{wallet.connecting ? "Connecting…" : "Connect wallet"}</button> : <button className="button button-primary button-wide" onClick={() => void runTrade()} disabled={!canTrade}>{mode === "FIRM" && accepted ? "Execute accepted commitment" : mode === "FIRM" ? "Accept Firm quote" : "Execute Soft swap"}<ArrowRight size={17} /></button>}
          {(wallet.error || runtimeError || inspectError) && <p className="inline-error"><CircleAlert size={15} />{wallet.error || runtimeError || inspectError}</p>}
          {phase !== "IDLE" && <div className={`action-state ${phase.toLowerCase()}`} aria-live="polite"><span>{phase === "COMPLETE" ? <Check /> : phase === "ERROR" ? <CircleAlert /> : <RefreshCw />}</span><div><small>{phase}</small><strong>{action}</strong></div></div>}
          {commitment?.commitment.status === "ACCEPTED" && acceptedQuote && <button className="button button-outline button-wide" onClick={() => void expireAccepted()} disabled={busy}>Settle if expired</button>}
        </div>
      </section>
      <aside className="depth-inspector" aria-labelledby="depth-inspector-title"><div className="panel-head"><div><Eyebrow>Block-level inspection</Eyebrow><h2 id="depth-inspector-title">Depth reality</h2></div><button className="icon-button" onClick={() => void inspect()} disabled={inspecting || runtime === null} aria-label="Refresh depth"><RefreshCw size={17} /></button></div><DepthDiagram compact /><div className="inspector-metrics"><Metric label="Virtual depth" value={liquidity ? `${formatToken(liquidity.virtualDepth, 6, 2)} USDC` : "—"} /><Metric label="Pullable depth" value={liquidity ? `${formatToken(liquidity.pullableDepth, 6, 2)} USDC` : "—"} detail="min(virtual, real inventory, Aqua allowance)" /><Metric label="Firm depth for quote" value={firmCapacity ? `${formatToken(firmCapacity.firmDepth, 6, 2)} USDC` : "—"} detail={firmCapacity ? `Bond supports ${formatToken(firmCapacity.bondSupportedDepth, 6, 2)} USDC at this policy` : "Requires a current signed Firm quote"} /><Metric label="Available bond" value={eligibility ? `${formatToken(eligibility.availableBond, 6, 2)} USDC` : "—"} /></div>{eligibility && <div className="eligibility-reasons"><strong>Aqua eligibility</strong>{eligibility.reasons.length === 0 ? <p><Check size={14} /> Active, quotable, sufficiently backed</p> : eligibility.reasons.map((reason) => <p key={reason}><CircleAlert size={14} />{reason.replaceAll("_", " ").toLowerCase()}</p>)}</div>}{strategy && <dl className="technical-list"><div><dt>Order</dt><dd>{shortHex(strategy.orderHash)}</dd></div><div><dt>Strategy</dt><dd>{strategy.label}</dd></div><div><dt>Observed</dt><dd>{liquidity ? `block ${liquidity.blockNumber}` : "—"}</dd></div></dl>}</aside>
    </div>
    {(commitment || receipt) && <section className="transaction-strip"><div><small>Commitment</small><strong>{commitment ? shortHex(commitment.commitmentId, 12, 8) : "—"}</strong></div><div><small>Transaction</small><strong>{receipt ? shortHex(receipt.transactionHash, 12, 8) : commitment ? shortHex(commitment.acceptanceTransactionHash, 12, 8) : "—"}</strong></div><div><small>Decoded path</small><strong>{receipt?.path ?? commitment?.commitment.status ?? "—"}</strong></div><a href="/evidence">Open Evidence Lab <ArrowRight size={15} /></a></section>}
    {receipt && <ReceiptView receipt={receipt} />}
  </div>;
}

function parseAmount(value: string, balance: bigint | null): { value: bigint | null; error: string | null } {
  if (value.trim() === "") return { value: null, error: "Enter a WETH amount." };
  if (!/^(?:\d+)(?:\.\d{0,18})?$/.test(value)) return { value: null, error: "Use a valid number with at most 18 decimals." };
  try {
    const parsed = parseUnits(value, 18);
    if (parsed <= 0n) return { value: null, error: "Amount must be greater than zero." };
    if (parsed > 2n ** 256n - 1n) return { value: null, error: "Amount is too large." };
    if (balance !== null && parsed > balance) return { value: null, error: "Amount exceeds the connected wallet balance." };
    return { value: parsed, error: null };
  } catch { return { value: null, error: "Amount is malformed or too large." }; }
}

function errorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Transaction failed";
  if (/rejected|denied|4001/i.test(message)) return "Wallet request rejected.";
  if (/expired|QuoteExpired|lifetime/i.test(message)) return "The Firm quote expired. Request a new horizon quote.";
  if (/insufficient.*balance/i.test(message)) return "Insufficient token balance for this action.";
  return message;
}
