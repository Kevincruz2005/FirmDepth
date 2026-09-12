import { acceptFirm, approveToken, executeFirm, executeSoftSwap, expireFirm } from "@firmdepth/sdk/actions";
import { checkFirmEligibility, getLiquidityReality, type FirmEligibility, type LiquidityReality } from "@firmdepth/sdk/readers";
import { getFirmExecutionReceipt, type FirmExecutionReceipt } from "@firmdepth/sdk/receipt";
import { ArrowRight, Check, CircleAlert, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { DepthDiagram } from "../components/Visuals";
import { Eyebrow, Metric, StatusDot, TruthTag } from "../components/Primitives";
import { useRuntime, useWallet } from "../hooks/useRuntime";
import { formatToken, shortHex } from "../lib/format";
import { deserializeOrder, deserializeQuote } from "../lib/runtime";

type ExecutionPhase = "IDLE" | "APPROVING" | "SUBMITTING" | "CONFIRMING" | "COMPLETE" | "ERROR";

export function Trade() {
  const { runtime, loading, error: runtimeError, refresh: refreshRuntime } = useRuntime();
  const wallet = useWallet();
  const [mode, setMode] = useState<"SOFT" | "FIRM">("FIRM");
  const [liquidity, setLiquidity] = useState<LiquidityReality | null>(null);
  const [eligibility, setEligibility] = useState<FirmEligibility | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [phase, setPhase] = useState<ExecutionPhase>("IDLE");
  const [action, setAction] = useState("Ready to inspect");
  const [commitmentId, setCommitmentId] = useState<Hex | null>(null);
  const [acceptanceHash, setAcceptanceHash] = useState<Hex | null>(null);
  const [terminalHash, setTerminalHash] = useState<Hex | null>(null);
  const [receipt, setReceipt] = useState<FirmExecutionReceipt | null>(null);

  const strategy = useMemo(() => runtime?.artifact.strategies.find((item) => item.kind === mode) ?? null, [runtime, mode]);

  const inspect = useCallback(async () => {
    if (runtime === null || strategy === null) return;
    setInspecting(true);
    setInspectError(null);
    try {
      const order = deserializeOrder(strategy.order);
      const baseQuery = {
        aqua: runtime.artifact.addresses.aqua,
        router: runtime.artifact.addresses.firmRouter,
        maker: order.maker,
        orderHash: strategy.orderHash,
        tokenIn: runtime.artifact.addresses.weth,
        tokenOut: runtime.artifact.addresses.usdc,
      };
      const nextLiquidity = await getLiquidityReality(runtime.publicClient, baseQuery);
      setLiquidity(nextLiquidity);
      if (mode === "FIRM" && strategy.firm !== undefined) {
        const quote = deserializeQuote(strategy.firm.quote);
        setEligibility(await checkFirmEligibility(runtime.publicClient, {
          ...baseQuery,
          vault: runtime.artifact.addresses.bondVault,
          requiredBond: quote.requiredBond,
          requiredOutput: quote.minAmountOut,
          amountIn: quote.amountIn,
          order,
          takerTraits: strategy.takerTraits,
        }));
      } else {
        setEligibility(null);
      }
    } catch (cause) {
      setInspectError(cause instanceof Error ? cause.message : "Depth inspection failed");
    } finally {
      setInspecting(false);
    }
  }, [mode, runtime, strategy]);

  useEffect(() => { void inspect(); }, [inspect]);

  async function runTrade() {
    if (runtime === null || strategy === null || wallet.account === null || wallet.walletClient === null) return;
    const clients = { publicClient: runtime.publicClient, walletClient: wallet.walletClient, account: wallet.account };
    const order = deserializeOrder(strategy.order);
    try {
      setReceipt(null);
      setTerminalHash(null);
      if (mode === "SOFT") {
        setPhase("APPROVING"); setAction("Approving WETH for the SwapVM router");
        const approval = await approveToken(clients, runtime.artifact.addresses.weth, runtime.artifact.addresses.firmRouter, BigInt(strategy.amountIn));
        await runtime.publicClient.waitForTransactionReceipt({ hash: approval });
        setPhase("SUBMITTING"); setAction("Submitting the Soft Aqua swap");
        const swap = await executeSoftSwap(clients, runtime.artifact.addresses.firmRouter, order, BigInt(strategy.amountIn), strategy.takerTraits);
        setPhase("CONFIRMING"); setAction("Waiting for the Soft swap receipt");
        await runtime.publicClient.waitForTransactionReceipt({ hash: swap.hash });
        setTerminalHash(swap.hash);
        setPhase("COMPLETE"); setAction(`Soft execution confirmed · ${formatToken(swap.amountOut, 6, 2)} USDC`);
      } else {
        if (strategy.firm === undefined) throw new Error("Runtime is missing the signed Firm quote");
        const quote = deserializeQuote(strategy.firm.quote);
        if (wallet.account.toLowerCase() !== quote.taker.toLowerCase()) throw new Error(`Connected account must be signed taker ${shortHex(quote.taker)}`);
        if (commitmentId === null) {
          setPhase("APPROVING"); setAction("Approving the exact Firm premium");
          const approval = await approveToken(clients, quote.premiumToken, runtime.artifact.addresses.registry, quote.premiumAmount);
          await runtime.publicClient.waitForTransactionReceipt({ hash: approval });
          setPhase("SUBMITTING"); setAction("Accepting maker-signed commitment");
          const accepted = await acceptFirm(clients, runtime.artifact.addresses.registry, quote, order, strategy.firm.makerSignature);
          setPhase("CONFIRMING"); setAction("Waiting for bond lock confirmation");
          await runtime.publicClient.waitForTransactionReceipt({ hash: accepted.hash });
          setCommitmentId(accepted.commitmentId);
          setAcceptanceHash(accepted.hash);
          setPhase("COMPLETE"); setAction("Commitment accepted · bond locked");
          await inspect();
        } else {
          setPhase("APPROVING"); setAction("Approving exact trader input");
          const approval = await approveToken(clients, quote.tokenIn, runtime.artifact.addresses.executor, quote.amountIn);
          await runtime.publicClient.waitForTransactionReceipt({ hash: approval });
          setPhase("SUBMITTING"); setAction("Executing the accepted Firm commitment");
          const executed = await executeFirm(clients, runtime.artifact.addresses.executor, commitmentId, order);
          setPhase("CONFIRMING"); setAction("Reconciling terminal onchain evidence");
          await runtime.publicClient.waitForTransactionReceipt({ hash: executed.hash });
          if (acceptanceHash === null) throw new Error("Acceptance transaction hash is missing");
          const decoded = await getFirmExecutionReceipt(runtime.publicClient, {
            registry: runtime.artifact.addresses.registry,
            executor: runtime.artifact.addresses.executor,
            router: runtime.artifact.addresses.firmRouter,
            vault: runtime.artifact.addresses.bondVault,
            commitmentId,
            acceptanceTransactionHash: acceptanceHash,
            terminalTransactionHash: executed.hash,
          });
          setTerminalHash(executed.hash);
          setReceipt(decoded);
          setPhase("COMPLETE"); setAction(`${decoded.finalState} · receipt reconciled`);
          await inspect();
        }
      }
    } catch (cause) {
      setPhase("ERROR");
      setAction(cause instanceof Error ? cause.message : "Transaction failed");
    }
  }

  async function expireAccepted() {
    if (runtime === null || wallet.account === null || wallet.walletClient === null || commitmentId === null || acceptanceHash === null) return;
    const clients = { publicClient: runtime.publicClient, walletClient: wallet.walletClient, account: wallet.account };
    try {
      setPhase("SUBMITTING"); setAction("Settling the naturally expired commitment");
      const hash = await expireFirm(clients, runtime.artifact.addresses.registry, commitmentId);
      setPhase("CONFIRMING"); setAction("Reconciling expiry and bond unlock");
      await runtime.publicClient.waitForTransactionReceipt({ hash });
      const decoded = await getFirmExecutionReceipt(runtime.publicClient, {
        registry: runtime.artifact.addresses.registry, executor: runtime.artifact.addresses.executor,
        router: runtime.artifact.addresses.firmRouter, vault: runtime.artifact.addresses.bondVault,
        commitmentId, acceptanceTransactionHash: acceptanceHash, terminalTransactionHash: hash,
      });
      setTerminalHash(hash); setReceipt(decoded); setPhase("COMPLETE"); setAction(`${decoded.finalState} · bond unlocked`);
      await inspect();
    } catch (cause) {
      setPhase("ERROR"); setAction(cause instanceof Error ? cause.message : "Expiry settlement failed");
    }
  }

  const required = strategy?.firm ? deserializeQuote(strategy.firm.quote).minAmountOut : BigInt(strategy?.expectedAmountOut ?? 0);
  const canTrade = runtime !== null && strategy !== null && wallet.account !== null && !["APPROVING", "SUBMITTING", "CONFIRMING"].includes(phase) && (mode === "SOFT" || commitmentId !== null || eligibility?.eligible === true);

  return <div className="app-page trade-page">
    <header className="page-title"><div><Eyebrow>Execution terminal</Eyebrow><h1>Trade the depth you can prove.</h1><p>Compare live strategy accounting, then choose an ordinary Soft attempt or a signed, collateralized Firm commitment.</p></div><TruthTag value={runtime ? "LIVE" : "ILLUSTRATIVE"} /></header>

    <div className="trade-layout">
      <section className="trade-ticket" aria-labelledby="trade-ticket-title">
        <div className="mode-switch" role="tablist" aria-label="Execution class"><button role="tab" aria-selected={mode === "SOFT"} onClick={() => { setMode("SOFT"); setCommitmentId(null); setPhase("IDLE"); }}>Soft</button><button role="tab" aria-selected={mode === "FIRM"} onClick={() => { setMode("FIRM"); setCommitmentId(null); setPhase("IDLE"); }}><ShieldCheck size={15} /> Firm</button></div>
        <h2 id="trade-ticket-title" className="sr-only">Trade details</h2>
        <div className="token-field"><label>Sell</label><strong>{strategy ? formatToken(BigInt(strategy.amountIn), 18, 4) : "0.2000"}</strong><span>WETH</span><small>{strategy ? "Runtime fixture amount" : "Evidence preview only"}</small></div>
        <div className="swap-divider"><span>↓</span></div>
        <div className="token-field output"><label>{mode === "FIRM" ? "Receive at least" : "Quoted output"}</label><strong>{strategy ? formatToken(required, 6, 2) : "690.00"}</strong><span>USDC</span><small>{mode === "FIRM" ? "Signed minimum, independently threshold-bound" : "Not reserved; execution can revert"}</small></div>
        {mode === "FIRM" && strategy?.firm && <div className="premium-row"><span>Firm premium</span><strong>{formatToken(deserializeQuote(strategy.firm.quote).premiumAmount, 18, 8)} WETH</strong><small>Pricing v2 · TTL {strategy.firm.quote.pricingTtl}s</small></div>}
        <div className="ticket-status">
          {runtime === null ? <StatusDot>{loading ? "Checking runtime…" : "Evidence mode · no transaction"}</StatusDot> : inspectError ? <StatusDot tone="bad">Inspection failed</StatusDot> : inspecting ? <StatusDot>Reading block…</StatusDot> : mode === "FIRM" && eligibility ? <StatusDot tone={eligibility.eligible ? "good" : "bad"}>{eligibility.eligible ? "Eligible at observed block" : "Not Firm-eligible"}</StatusDot> : <StatusDot tone="live">Strategy live</StatusDot>}
          {eligibility && <span>block {eligibility.blockNumber.toString()}</span>}
        </div>
        {runtime === null ? <button className="button button-primary button-wide" onClick={() => void refreshRuntime()} disabled={loading}><RefreshCw size={17} /> Recheck runtime</button> : wallet.account === null ? <button className="button button-dark button-wide" onClick={() => void wallet.connect()} disabled={wallet.connecting}><Wallet size={17} /> {wallet.connecting ? "Connecting…" : "Connect wallet"}</button> : <button className="button button-primary button-wide" onClick={() => void runTrade()} disabled={!canTrade}>{mode === "FIRM" && commitmentId !== null ? "Execute accepted commitment" : mode === "FIRM" ? "Accept Firm quote" : "Execute Soft swap"}<ArrowRight size={17} /></button>}
        {(wallet.error || runtimeError || inspectError) && <p className="inline-error"><CircleAlert size={15} />{wallet.error || runtimeError || inspectError}</p>}
        {phase !== "IDLE" && <div className={`action-state ${phase.toLowerCase()}`} aria-live="polite"><span>{phase === "COMPLETE" ? <Check /> : phase === "ERROR" ? <CircleAlert /> : <RefreshCw />}</span><div><small>{phase}</small><strong>{action}</strong></div></div>}
        {phase === "ERROR" && commitmentId !== null && mode === "FIRM" && <button className="button button-outline button-wide" onClick={() => void expireAccepted()}>Settle expired commitment</button>}
      </section>

      <aside className="depth-inspector" aria-labelledby="depth-inspector-title">
        <div className="panel-head"><div><Eyebrow>Block-level inspection</Eyebrow><h2 id="depth-inspector-title">Depth reality</h2></div><button className="icon-button" onClick={() => void inspect()} disabled={inspecting || runtime === null} aria-label="Refresh depth"><RefreshCw size={17} /></button></div>
        <DepthDiagram compact />
        <div className="inspector-metrics">
          <Metric label="Virtual depth" value={liquidity ? `${formatToken(liquidity.virtualDepth, 6, 2)} USDC` : "—"} />
          <Metric label="Pullable backing" value={liquidity ? `${formatToken(liquidity.pullableBacking, 6, 2)} USDC` : "—"} detail={liquidity ? `min(real ${formatToken(liquidity.realBalance, 6, 0)}, allowance ${formatToken(liquidity.aquaAllowance, 6, 0)})` : undefined} />
          <Metric label="Firm depth" value={liquidity ? `${formatToken(liquidity.firmDepth, 6, 2)} USDC` : "—"} />
          <Metric label="Available bond" value={eligibility ? `${formatToken(eligibility.availableBond, 6, 2)} USDC` : "—"} />
        </div>
        {eligibility && <div className="eligibility-reasons"><strong>Aqua eligibility</strong>{eligibility.reasons.length === 0 ? <p><Check size={14} /> Active, quotable, sufficiently backed</p> : eligibility.reasons.map((reason) => <p key={reason}><CircleAlert size={14} />{reason.replaceAll("_", " ").toLowerCase()}</p>)}</div>}
        {strategy && <dl className="technical-list"><div><dt>Order</dt><dd>{shortHex(strategy.orderHash)}</dd></div><div><dt>Strategy</dt><dd>{strategy.label}</dd></div><div><dt>Source</dt><dd>{runtime ? "LIVE" : "—"}</dd></div></dl>}
      </aside>
    </div>

    {(commitmentId || terminalHash) && <section className="transaction-strip"><div><small>Commitment</small><strong>{commitmentId ? shortHex(commitmentId, 12, 8) : "Soft execution"}</strong></div><div><small>Transaction</small><strong>{terminalHash ? shortHex(terminalHash, 12, 8) : acceptanceHash ? shortHex(acceptanceHash, 12, 8) : "Awaiting execution"}</strong></div><div><small>Decoded path</small><strong>{receipt?.path ?? (commitmentId ? "ACCEPTED" : "—")}</strong></div><a href="/evidence">Open Evidence Lab <ArrowRight size={15} /></a></section>}
  </div>;
}
