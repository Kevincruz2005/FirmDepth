import { getFirmExecutionReceipt, type FirmExecutionReceipt } from "@firmdepth/sdk/receipt";
import { findDeploymentCommitments, type CommitmentHistoryItem } from "@firmdepth/sdk/history";
import { readCommitmentBondLock } from "@firmdepth/sdk/readers";
import { ArrowRight, Braces, Check, CircleAlert, Copy, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { isHash, type Hex } from "viem";
import { Eyebrow, HashLink, StatusDot, TruthTag } from "../components/Primitives";
import { ReceiptView } from "../components/ReceiptView";
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
  const [liveRecords, setLiveRecords] = useState<{ record: CommitmentHistoryItem; receipt: FirmExecutionReceipt | null; lock: bigint }[]>([]);

  useEffect(() => {
    if (runtime === null) return setLiveRecords([]);
    let current = true;
    void findDeploymentCommitments(runtime.publicClient, runtime.artifact.addresses.registry, BigInt(runtime.artifact.deploymentBlock)).then(async (records) => Promise.all(records.map(async (record) => ({
      record,
      lock: (await readCommitmentBondLock(runtime.publicClient, runtime.artifact.addresses.bondVault, record.commitmentId)).amount,
      receipt: record.terminalTransactionHash ? await getFirmExecutionReceipt(runtime.publicClient, { registry: runtime.artifact.addresses.registry, executor: runtime.artifact.addresses.executor, router: runtime.artifact.addresses.firmRouter, vault: runtime.artifact.addresses.bondVault, commitmentId: record.commitmentId, acceptanceTransactionHash: record.acceptanceTransactionHash, terminalTransactionHash: record.terminalTransactionHash }) : null,
    })))).then((records) => { if (current) setLiveRecords(records); }).catch((cause) => { if (current) setDecodeError(cause instanceof Error ? cause.message : "Live evidence read failed"); });
    return () => { current = false; };
  }, [runtime]);

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
    <header className="page-title"><div><Eyebrow>Evidence Lab</Eyebrow><h1>Don’t trust the status badge.</h1><p>Reconcile terminal state, exact event cardinality, SwapVM traits, bond movement, and token deltas into one strict receipt.</p></div><TruthTag value="VERIFIED BASE-FORK RUN" /></header>

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

    {decoded && <ReceiptView receipt={decoded} />}

    {runtime && <section className="evidence-section live-evidence"><div className="evidence-section-head"><div><Eyebrow>Controlled chain inspection</Eyebrow><h2>Current fork state, read back from the EVM.</h2></div><TruthTag value="LIVE" /></div>{liveRecords.length === 0 ? <p>No Firm commitments exist in this runtime yet. Execute a scenario in Trade, then return here.</p> : liveRecords.map(({ record, receipt, lock }) => <article key={record.commitmentId} className="live-evidence-record"><div><StatusDot tone={record.commitment.status === "ACCEPTED" ? "neutral" : "good"}>{record.commitment.status}</StatusDot><HashLink value={record.commitmentId} /><small>Bond currently locked: {lock.toString()} raw USDC units</small></div>{receipt ? <ReceiptView receipt={receipt} /> : <dl className="technical-list"><div><dt>Acceptance transaction</dt><dd><HashLink value={record.acceptanceTransactionHash} /></dd></div><div><dt>Chain state</dt><dd>ACCEPTED</dd></div><div><dt>Terminal receipt</dt><dd>— unavailable until settlement</dd></div></dl>}</article>)}</section>}

    <section className="evidence-section">
      <div className="evidence-section-head"><div><Eyebrow>Fork execution</Eyebrow><h2>Two terminal paths. Same promised output.</h2></div><TruthTag value={baseForkEvidence.provenance} /></div>
      <div className="path-evidence-grid five-scenarios">
        <Scenario index="01" title="Shared liquidity / Soft race" before="Two strategies advertise the same maker inventory." event="A Soft swap drains the shared USDC backing." after={`Firm pullable capacity falls to ${baseForkEvidence.sharedDrain.effectiveCapacityAfterUsdc} USDC; a depleted Soft sibling reverts atomically.`} hash={baseForkEvidence.sharedDrain.swapHash} />
        <Scenario index="02" title="FILLED_AQUA" before="Commitment accepted with Aqua capacity and dedicated Bond." event="Capacity remains sufficient at execution." after={`${baseForkEvidence.aqua.outputUsdc} USDC arrives through SwapVM; Bond unlocks.`} hash={baseForkEvidence.aqua.executionHash} />
        <Scenario index="03" title="FILLED_BOND" before="Commitment accepted while Aqua-executable." event="A sibling drains protected capacity before execution." after={`${baseForkEvidence.bond.outputUsdc} USDC arrives from dedicated Bond; SwapVM is skipped.`} hash={baseForkEvidence.bond.executionHash} />
        <Scenario index="04" title="EXPIRED" before="Commitment accepted; premium and Bond lock are onchain." event="Deadline passes without principal execution." after={`State EXPIRED; principal ${baseForkEvidence.expired.principalOutputUsdc} USDC, Bond ${baseForkEvidence.expired.bondBeforeUsdc} → ${baseForkEvidence.expired.bondAfterUsdc} USDC, premium finalizes to maker.`} hash={baseForkEvidence.expired.terminalHash} />
        <Scenario index="05" title="Fail-closed unrelated error" before="ACCEPTED with sufficient capacity and a 200 USDC lock." event="The executor encounters an unexpected non-capacity revert." after={`Transaction status 0; commitment remains ${baseForkEvidence.unrelatedFailure.statusAfter}; Bond ${baseForkEvidence.unrelatedFailure.bondBeforeUsdc} → ${baseForkEvidence.unrelatedFailure.bondAfterUsdc} USDC.`} hash={baseForkEvidence.unrelatedFailure.revertedHash} />
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

function Scenario({ index, title, before, event, after, hash }: { index: string; title: string; before: string; event: string; after: string; hash: string }) {
  return <article><span className="path-index">{index}</span><h3>{title}</h3><dl className="scenario-flow"><div><dt>Before</dt><dd>{before}</dd></div><div><dt>Event</dt><dd>{event}</dd></div><div><dt>After</dt><dd>{after}</dd></div></dl><HashLink value={hash} /></article>;
}
