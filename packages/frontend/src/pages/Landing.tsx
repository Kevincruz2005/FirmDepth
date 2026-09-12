import { ArrowDown, ArrowRight, Braces, Check, ShieldCheck, Sparkles } from "lucide-react";
import { benchmarkEvidence, baseForkEvidence } from "../data/evidence";
import { formatCompact, formatPercent, shortHex } from "../lib/format";
import { DepthDiagram, FrontierChart, SettlementBranch } from "../components/Visuals";
import { Eyebrow, Metric, SectionIntro, TruthTag } from "../components/Primitives";

export function Landing() {
  return <>
    <section className="hero">
      <div className="hero-copy">
        <Eyebrow>Execution certainty for shared liquidity</Eyebrow>
        <h1>The quote is soft.<br /><em>Your outcome</em> doesn’t have to be.</h1>
        <p className="hero-lede">FirmDepth lets a trader accept a maker-signed WETH → USDC quote and lock the minimum output in separate performance collateral—without taking reusable Aqua inventory out of circulation.</p>
        <div className="hero-buttons"><a className="button button-primary" href="/trade">Inspect live depth <ArrowRight /></a><a className="text-link" href="/evidence">Verify the Base-fork run <ArrowDown size={16} /></a></div>
      </div>
      <div className="hero-console" aria-label="Illustrative Firm quote panel">
        <div className="console-head"><span>WETH / USDC</span><TruthTag value="ILLUSTRATIVE" /></div>
        <div className="console-amount"><span>You commit</span><strong>0.2000 <small>WETH</small></strong></div>
        <div className="quote-rule"><i /><span>signed minimum</span><i /></div>
        <div className="console-output"><span>You receive</span><strong>≥ 690.00 <small>USDC</small></strong></div>
        <div className="certainty-toggle"><span><ShieldCheck size={18} /> Firm execution</span><b>30 sec</b></div>
        <dl className="console-facts"><div><dt>Premium</dt><dd>0.000173 WETH</dd></div><div><dt>Bond locked</dt><dd>690.00 USDC</dd></div><div><dt>Settlement</dt><dd>Aqua or Bond</dd></div></dl>
        <div className="console-status"><span><Check size={14} /> Pricing v2 bound</span><span>Program 0x52002100</span></div>
      </div>
    </section>

    <section className="section depths-section">
      <SectionIntro number="01" eyebrow="Liquidity reality" title="One market. Three depths." copy="A quote can advertise virtual inventory without proving it can be pulled now. FirmDepth separates what is declared, what is currently executable, and what can be contractually guaranteed." />
      <div className="depths-layout">
        <DepthDiagram />
        <ol className="depth-definitions">
          <li><span>01</span><div><h3>Virtual depth</h3><p>The strategy’s Aqua accounting. Capital efficient and reusable across overlapping strategies.</p></div><b>declared</b></li>
          <li><span>02</span><div><h3>Pullable depth</h3><p>Active Aqua output capped by virtual balance, real inventory, and Aqua allowance.</p></div><b>executable now</b></li>
          <li><span>03</span><div><h3>Firm depth for a quote</h3><p>New output exposure capped by both Pullable Depth and the quote policy’s available Bond capacity.</p></div><b>admissible</b></li>
        </ol>
      </div>
    </section>

    <section className="section soft-firm-section">
      <SectionIntro number="02" eyebrow="Choose the execution class" title="Soft when speed matters. Firm when the outcome does." copy="The route remains Aqua-native. Firm adds a short-lived, fully collateralized obligation around the exact accepted order." />
      <div className="compare-grid">
        <article className="compare-card soft"><header><span>SOFT</span><h3>Best available execution</h3><p>No premium. No reservation.</p></header><ul><li><Check /> Reads current Aqua quote</li><li><Check /> Preserves full inventory reuse</li><li><span>×</span> Capacity may be consumed by a sibling</li></ul><footer><span>Outcome</span><strong>Execution attempt</strong></footer></article>
        <article className="compare-card firm"><header><span>FIRM</span><h3>Minimum output locked</h3><p>Paid certainty for 5–300 seconds.</p></header><ul><li><Check /> Maker-signed pricing snapshot</li><li><Check /> Dedicated USDC bond lock</li><li><Check /> Aqua or exact Bond settlement</li></ul><footer><span>Outcome</span><strong>Protected settlement</strong></footer></article>
      </div>
    </section>

    <section className="section eligibility-section">
      <SectionIntro number="03" eyebrow="Aqua eligibility" title="Certainty begins before acceptance." copy="Firm acceptance runs the same capacity boundary the executor will later use, plus static SwapVM pricing and free bond collateral. A failed read never becomes a Bond path." />
      <div className="eligibility-panel">
        <div className="eligibility-flow">
          {["Strategy active", "Static quote ≥ minimum", "Virtual depth", "Real balance", "Aqua allowance", "Free bond"].map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p><Check size={15} /></div>)}
        </div>
        <div className="eligibility-result"><Sparkles size={20} /><span>All six conditions hold</span><strong>Eligible for Firm</strong><small>evaluated at one observed block</small></div>
      </div>
    </section>

    <section className="section settlement-section">
      <SectionIntro number="04" eyebrow="Deterministic branching" title="One obligation. Two valid settlements." copy="Immediately before the trader input is pulled, the executor rechecks the exact strategy’s capacity. The result selects Aqua or the already locked bond." />
      <SettlementBranch />
    </section>

    <section className="section swapvm-section">
      <SectionIntro number="05" eyebrow="SwapVM proof" title="The commitment is in the program." copy="Two custom instructions bind output and identity, while native SwapVM fields independently bind the same minimum and uint40 deadline." />
      <div className="program-panel">
        <div className="program-code"><div className="code-head"><Braces size={17} /><span>firm.program</span><code>4 bytes</code></div><div className="byte-row"><span className="byte price">52</span><span>00</span><span className="byte guard">21</span><span>00</span></div><div className="byte-labels"><span>FIRM_PRICE</span><span>zero args</span><span>FIRM_GUARD</span><span>zero args</span></div></div>
        <div className="binding-list"><div><span>0x52</span><p><strong>FIRM_PRICE</strong> consumes the signed minimum output and proves the execution snapshot.</p></div><div><span>0x21</span><p><strong>FIRM_GUARD</strong> consumes the commitment ID and binds maker, taker, router, order, pair, amounts, status, and bond.</p></div><div><span>NATIVE</span><p><strong>Threshold + deadline</strong> repeat the output floor and expiry in standard SwapVM traits.</p></div></div>
      </div>
    </section>

    <section className="section evidence-strip-section">
      <SectionIntro number="06" eyebrow="Canonical evidence" title="Verified on Base. Stressed in simulation." copy="The two datasets answer different questions and are never blended: a canonical execution proof against official contracts, and deterministic synthetic capacity stress." />
      <div className="evidence-columns">
        <article><TruthTag value={baseForkEvidence.provenance} /><h3>Official Aqua, real Base state</h3><p>Local fork pinned to block <strong>{baseForkEvidence.forkBlock.toLocaleString()}</strong>. No public-mainnet transaction.</p><div className="metrics-row"><Metric label="Aqua execution" value={`${baseForkEvidence.aqua.executionGas.toLocaleString()} gas`} /><Metric label="Bond execution" value={`${baseForkEvidence.bond.executionGas.toLocaleString()} gas`} /></div><code>{shortHex(baseForkEvidence.official.aqua, 12, 8)}</code></article>
        <article><TruthTag value={benchmarkEvidence.provenance} /><h3>{formatCompact(benchmarkEvidence.episodes)} seeded episodes</h3><p>{benchmarkEvidence.configurations} configurations across quote size, TTL, shared-liquidity ratio, and bond utilization.</p><div className="metrics-row"><Metric label="Soft capacity losses" value={benchmarkEvidence.adversarial.softAvailabilityLoss.toLocaleString()} /><Metric label="Protected settlements" value={benchmarkEvidence.adversarial.firmProtectedSettlements.toLocaleString()} /></div><small>Selected highest-loss admitted scenario; not a real-network failure rate.</small></article>
      </div>
    </section>

    <section className="section frontier-section">
      <SectionIntro number="07" eyebrow="Capital-Certainty Frontier" title="Protect the trade, not the inventory." copy="Hard reservation buys certainty by locking trading capital. In the selected synthetic scenario, FirmDepth protects accepted execution while retaining Soft Aqua’s modeled capital reuse." />
      <div className="frontier-layout"><FrontierChart /><div className="frontier-copy"><TruthTag value="SYNTHETIC BENCHMARK" /><Metric label="Firm protected settlement" value="100%" detail="10,000 / 10,000 admitted" /><Metric label="Firm capital reuse" value={formatPercent(benchmarkEvidence.adversarial.firmCapitalReuse, 2)} detail="same modeled reuse as Soft" /><Metric label="Hard reservation reuse" value={formatPercent(benchmarkEvidence.adversarial.hardCapitalReuse, 2)} detail="selected stress configuration" /><p>Capital reuse is modeled from deterministic compound-Poisson arrivals. It is evidence about the mechanism, not a forecast.</p></div></div>
    </section>

    <section className="closing-cta"><p>Depth is a claim.<br /><strong>Settlement is proof.</strong></p><div><a className="button button-primary" href="/trade">Open live trade <ArrowRight /></a><a className="button button-outline" href="/evidence">Audit the evidence</a></div></section>
  </>;
}
