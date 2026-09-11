import { getFirmExecutionReceipt, type FirmExecutionReceipt } from "@firmdepth/sdk/receipt";
import { ArrowRight, Braces, Check, CircleAlert, Copy, Search } from "lucide-react";
import { useState } from "react";
import { isHash, type Hex } from "viem";
import { Eyebrow, HashLink, Metric, StatusDot, TruthTag } from "../components/Primitives";
import { benchmarkEvidence, baseForkEvidence } from "../data/evidence";
import { useRuntime } from "../hooks/useRuntime";
import { formatPercent } from "../lib/format";

export function Evidence() {
  const { runtime } = useRuntime();
  const [commitmentId, setCommitmentId] = useState("");
  const [acceptanceHash, setAcceptanceHash] = useState("");
  const [terminalHash, setTerminalHash] = useState("");
  const [decoded, setDecoded] = useState<FirmExecutionReceipt | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);

  async function decode() {
    if (runtime === null) return;
    if (![commitmentId, acceptanceHash, terminalHash].every(isHash)) return setDecodeError("Enter three complete 32-byte hashes.");
    setDecoding(true); setDecodeError(null); setDecoded(null);
    try {
      setDecoded(await getFirmExecutionReceipt(runtime.publicClient, {
        registry: runtime.artifact.addresses.registry,
        executor: runtime.artifact.addresses.executor,
        router: runtime.artifact.addresses.firmRouter,
        vault: runtime.artifact.addresses.bondVault,
        commitmentId: commitmentId as Hex,
        acceptanceTransactionHash: acceptanceHash as Hex,
        terminalTransactionHash: terminalHash as Hex,
      }));
    } catch (cause) {
      setDecodeError(cause instanceof Error ? cause.message : "Receipt reconciliation failed");
    } finally { setDecoding(false); }
  }

  return <div className="app-page evidence-page">
    <header className="page-title"><div><Eyebrow>Evidence Lab</Eyebrow><h1>Don’t trust the status badge.</h1><p>Reconcile terminal state, exact event cardinality, SwapVM traits, bond movement, and token deltas into one strict receipt.</p></div><TruthTag value={runtime ? "LIVE" : "VERIFIED BASE-FORK RUN"} /></header>

    <section className="receipt-hero">
      <div className="receipt-proof">
        <div className="receipt-proof-head"><StatusDot tone="good">Canonical run reconciled</StatusDot><span>Base · block {baseForkEvidence.forkBlock.toLocaleString()}</span></div>
        <div className="receipt-path"><div><small>01</small><span>Commitment</span><strong>ACCEPTED</strong></div><i /><div><small>02</small><span>Preflight</span><strong>CAPACITY</strong></div><i /><div className="active"><small>03</small><span>Settlement</span><strong>FILLED_AQUA</strong></div></div>
        <div className="receipt-amount"><span>Terminal trader output</span><strong>{baseForkEvidence.aqua.outputUsdc}.00 <small>USDC</small></strong></div>
        <dl className="receipt-details"><div><dt>Commitment</dt><dd><HashLink value={baseForkEvidence.aqua.commitmentId} /></dd></div><div><dt>Execution</dt><dd><HashLink value={baseForkEvidence.aqua.executionHash} /></dd></div><div><dt>FIRM_PRICE</dt><dd><Check size={14} /> executed · 0x52</dd></div><div><dt>FIRM_GUARD</dt><dd><Check size={14} /> executed · 0x21</dd></div><div><dt>Program</dt><dd><code>0x52002100</code></dd></div><div><dt>Bond remaining</dt><dd>0 USDC</dd></div></dl>
      </div>
      <aside className="decode-panel">
        <Eyebrow>Live decoder</Eyebrow><h2>Rebuild a receipt</h2><p>The SDK rejects missing, duplicate, reverted, or inconsistent chain evidence.</p>
        {["Commitment ID", "Acceptance transaction", "Terminal transaction"].map((label, index) => <label key={label}>{label}<input value={[commitmentId, acceptanceHash, terminalHash][index]} onChange={(event) => [setCommitmentId, setAcceptanceHash, setTerminalHash][index]!(event.target.value)} placeholder="0x…" spellCheck={false} /></label>)}
        <button className="button button-primary button-wide" onClick={() => void decode()} disabled={runtime === null || decoding}><Search size={16} />{decoding ? "Reconciling…" : "Decode from chain"}</button>
        {runtime === null && <small>Load the local Base-fork runtime to enable chain decoding.</small>}
        {decodeError && <p className="inline-error"><CircleAlert size={15} />{decodeError}</p>}
      </aside>
    </section>

    {decoded && <section className="decoded-receipt" aria-live="polite"><div><StatusDot tone="good">Strict receipt valid</StatusDot><h2>{decoded.finalState}</h2><p>{decoded.path} path at block {decoded.executionBlock.toString()}</p></div><Metric label="Output floor" value={decoded.minAmountOut.toString()} /><Metric label="Bond consumed" value={decoded.bondConsumed.toString()} /><Metric label="Deadline" value={decoded.deadline.toString()} /></section>}

    <section className="evidence-section">
      <div className="evidence-section-head"><div><Eyebrow>Fork execution</Eyebrow><h2>Two terminal paths. Same promised output.</h2></div><TruthTag value={baseForkEvidence.provenance} /></div>
      <div className="path-evidence-grid">
        <article><span className="path-index">A</span><h3>Aqua settlement</h3><p>Sufficient effective capacity. The bound SwapVM program executes against official Aqua.</p><dl><div><dt>Status</dt><dd>FILLED_AQUA</dd></div><div><dt>Execution gas</dt><dd>{baseForkEvidence.aqua.executionGas.toLocaleString()}</dd></div><div><dt>Trader output</dt><dd>{baseForkEvidence.aqua.outputUsdc}.00 USDC</dd></div><div><dt>SwapVM proof</dt><dd>Executed</dd></div></dl><HashLink value={baseForkEvidence.aqua.executionHash} /></article>
        <article><span className="path-index">B</span><h3>Bond settlement</h3><p>A sibling drains shared backing after acceptance. The exact commitment lock settles directly.</p><dl><div><dt>Status</dt><dd>FILLED_BOND</dd></div><div><dt>Execution gas</dt><dd>{baseForkEvidence.bond.executionGas.toLocaleString()}</dd></div><div><dt>Trader output</dt><dd>{baseForkEvidence.bond.outputUsdc}.00 USDC</dd></div><div><dt>SwapVM proof</dt><dd>Path skipped</dd></div></dl><HashLink value={baseForkEvidence.bond.executionHash} /></article>
        <article className="atomic-card"><span className="path-index">×</span><h3>Unrelated failure</h3><p>The depleted Soft sibling reverts atomically. Unknown Firm execution failures cannot spend the bond.</p><dl><div><dt>Receipt status</dt><dd>0 · reverted</dd></div><div><dt>Balance deltas</dt><dd>All zero</dd></div><div><dt>Bond state</dt><dd>Untouched</dd></div></dl><StatusDot tone="good">Atomicity verified</StatusDot></article>
      </div>
    </section>

    <section className="evidence-section benchmark-section">
      <div className="evidence-section-head"><div><Eyebrow>Synthetic benchmark</Eyebrow><h2>The stress case, with its assumptions attached.</h2></div><TruthTag value={benchmarkEvidence.provenance} /></div>
      <div className="benchmark-banner"><div><span>episodes</span><strong>810,000</strong></div><div><span>configurations</span><strong>81</strong></div><div><span>seed</span><strong>{benchmarkEvidence.seed}</strong></div><p>Compound-Poisson sibling arrivals · WETH/USDC-scaled inventory · deterministic replay</p></div>
      <div className="benchmark-table" role="table" aria-label="Selected adversarial benchmark result">
        <div role="row" className="table-head"><span role="columnheader">System</span><span role="columnheader">Protected settlement</span><span role="columnheader">Capital reuse</span><span role="columnheader">Observed path</span></div>
        <div role="row"><strong role="cell">Soft Aqua</strong><span role="cell">41.47%</span><span role="cell">{formatPercent(benchmarkEvidence.adversarial.softCapitalReuse, 2)}</span><span role="cell">5,853 capacity losses</span></div>
        <div role="row"><strong role="cell">Hard reservation</strong><span role="cell">100%</span><span role="cell">{formatPercent(benchmarkEvidence.adversarial.hardCapitalReuse, 2)}</span><span role="cell">inventory locked</span></div>
        <div role="row" className="highlight"><strong role="cell">FirmDepth</strong><span role="cell">100%</span><span role="cell">{formatPercent(benchmarkEvidence.adversarial.firmCapitalReuse, 2)}</span><span role="cell">4,147 Aqua · 5,853 Bond</span></div>
      </div>
      <p className="method-note"><Braces size={16} /> Highest modeled Soft availability-loss rate among configurations that admitted Firm. This is mechanism stress evidence, not a claimed real-network frequency or dollar-loss estimate.</p>
    </section>

    <section className="reproduce-strip"><div><Eyebrow>Reproduce it</Eyebrow><h2>One backend command.<br />No fabricated state.</h2></div><code>./scripts/demo_backend.sh <button aria-label="Copy command" onClick={() => void navigator.clipboard?.writeText("./scripts/demo_backend.sh")}><Copy size={15} /></button></code><a className="button button-outline" href="/maker">Inspect maker accounting <ArrowRight size={16} /></a></section>
  </div>;
}
