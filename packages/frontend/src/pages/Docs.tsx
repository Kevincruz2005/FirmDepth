import { ArrowRight } from "lucide-react";
import { Eyebrow, ExplorerHashLink, TruthTag } from "../components/Primitives";
import { sepoliaManifest } from "../data/project";

const sections = [
  ["overview", "Overview"], ["why", "Why FirmDepth exists"], ["depths", "Three Depths"],
  ["soft", "Soft execution"], ["firm", "Firm execution"], ["lifecycle", "Commitment lifecycle"],
  ["swapvm", "SwapVM extension"], ["paths", "Execution paths"], ["bond", "Bond model"],
  ["sepolia", "Sepolia deployment"], ["evidence", "Evidence"], ["use", "How to use FirmDepth"],
  ["security", "Security properties"], ["limitations", "Current scope / limitations"], ["links", "Developer / evidence links"],
] as const;

export function Docs() {
  const explorer = sepoliaManifest.chain.explorerUrl;
  return <div className="app-page docs-page">
    <header className="page-title"><div><Eyebrow>FirmDepth documentation</Eyebrow><h1>Execution certainty, explained.</h1><p>A judge-readable and developer-useful guide to the implementation running on Sepolia and the canonical pinned Base fork.</p></div><TruthTag value="SEPOLIA TESTNET · DEPLOYMENT" /></header>
    <div className="docs-layout">
      <nav className="docs-toc" aria-label="Documentation sections"><strong>On this page</strong>{sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
      <article className="docs-content">
        <DocSection id="overview" number="01" title="Overview"><p>Aqua makes liquidity reusable. FirmDepth makes execution certainty tradable.</p><div className="docs-compare"><div><strong>Soft</strong><span>Best-effort execution against current Aqua liquidity.</span></div><div><strong>Firm</strong><span>A maker-signed promise protected by premium and dedicated Bond collateral after acceptance.</span></div></div></DocSection>
        <DocSection id="why" number="02" title="Why FirmDepth exists"><p>Aqua intentionally lets strategies share maker inventory. That reuse is valuable, but inventory can change between a quote and execution. FirmDepth prices and collateralizes that interval without describing Aqua as broken or reserving its underlying inventory.</p></DocSection>
        <DocSection id="depths" number="03" title="Three Depths"><Definition term="Virtual Depth">The Aqua-authorized strategy balance: reusable accounting, not isolated custody.</Definition><Definition term="Pullable Depth">What the strategy can source from real maker inventory and Aqua allowance at the observed block.</Definition><Definition term="Firm Depth">New Firm exposure currently admissible using executable capacity and available collateral.</Definition><pre><code>{"Firm Depth for a quote = min(\n  Pullable Depth,\n  floor(available Bond × minAmountOut / requiredBond)\n)"}</code></pre><p>This is quote-scoped because the signed minimum and collateral requirement determine how much available Bond supports.</p></DocSection>
        <DocSection id="soft" number="04" title="Soft execution"><p>Soft uses the existing Aqua/SwapVM exact-input route. It carries no Firm premium and creates no commitment-specific Bond lock. Its output remains best effort against state observed at execution.</p></DocSection>
        <DocSection id="firm" number="05" title="Firm execution"><ol><li>The maker signs a quote binding taker, pair, order, exact input, minimum output, TTL, premium, nonce, and required Bond.</li><li>The taker accepts before expiry; Registry escrows the premium and BondVault locks collateral.</li><li>The accepted commitment executes through Aqua when capacity remains eligible, or through the dedicated Bond path for an eligible capacity loss.</li><li>Registry records one terminal result and finalizes the premium.</li></ol><p>Public horizons are 5, 30, and 120 seconds. The 120-second horizon is recommended for manual Sepolia use; shorter horizons are more sensitive to wallet and block-inclusion latency.</p></DocSection>
        <DocSection id="lifecycle" number="06" title="Commitment lifecycle"><div className="lifecycle-diagram"><code>NONE</code><span>→</span><code>ACCEPTED</code><span>→</span><div><code>FILLED_AQUA</code><code>FILLED_BOND</code><code>EXPIRED</code></div></div><Definition term="ACCEPTED">The quote was accepted and its performance Bond is locked.</Definition><Definition term="FILLED_AQUA">Aqua settled the protected trade and delivered at least the signed minimum.</Definition><Definition term="FILLED_BOND">Protected Aqua output capacity disappeared after acceptance, so the dedicated Bond path fulfilled the minimum.</Definition><Definition term="EXPIRED">The commitment was not executed before its deadline and was terminalized under the expiry policy.</Definition></DocSection>
        <DocSection id="swapvm" number="07" title="SwapVM extension"><Definition term="FIRM_PRICE · opcode 0x52">Validates the Firm pricing and accepted pricing snapshot used by successful SwapVM execution.</Definition><Definition term="FIRM_GUARD · opcode 0x21">Binds execution to the accepted commitment’s maker, taker, order, pair, amount, expiry, executor, router, and collateral constraints.</Definition><pre><code>{`${sepoliaManifest.opcodeConfiguration.program}\n0x52 00  = FIRM_PRICE\n0x21 00  = FIRM_GUARD`}</code></pre></DocSection>
        <DocSection id="paths" number="08" title="Execution paths"><Definition term="AQUA">Current capacity is eligible, so the exact accepted order settles through Aqua/SwapVM.</Definition><Definition term="BOND">An eligible capacity loss selects the dedicated collateral path; Aqua is not also called.</Definition><Definition term="CAPACITY">The deterministic current output-capacity preflight performed before state-changing Aqua settlement.</Definition><p>Unknown or unrelated failures fail closed: they revert and leave the commitment accepted instead of consuming Bond.</p></DocSection>
        <DocSection id="bond" number="09" title="Bond model"><p>The policy requires at least full signed minimum-output collateral; the current Sepolia configuration uses {sepoliaManifest.policies.requiredBondBps / 100}% for admission headroom. Maker total Bond equals available plus locked Bond. Locks belong to accepted commitments; no underlying Aqua inventory is reserved.</p></DocSection>
        <DocSection id="sepolia" number="10" title="Sepolia deployment"><p>Sepolia testnet deployment recorded at block {sepoliaManifest.deployment.blockNumber.toLocaleString()} with manifest revision <code>{sepoliaManifest.manifestRevision}</code>.</p><dl className="address-list">{Object.entries(sepoliaManifest.addresses).map(([name, address]) => <div key={name}><dt>{addressLabel(name)}</dt><dd><ExplorerHashLink value={address} href={`${explorer}/address/${address}`} /></dd></div>)}</dl></DocSection>
        <DocSection id="evidence" number="11" title="Evidence"><Definition term="Real Sepolia manual proof">A dynamic injected wallet accepted and executed a real public-testnet FILLED_AQUA commitment.</Definition><Definition term="Canonical Base fork">A deterministic sponsor-compliance run against official pinned Base state at block 51,123,118.</Definition><Definition term="Current live runtime">Fresh reads from the authenticated Sepolia manifest, RPC, and deployed contracts.</Definition><a className="text-link" href="/evidence">Inspect all evidence <ArrowRight size={15} /></a></DocSection>
        <DocSection id="use" number="12" title="How to use FirmDepth"><h3>Trader</h3><p>Connect wallet → switch to Sepolia → choose Soft or Firm → enter WETH → inspect/request quote → complete required approvals → accept → execute.</p><h3>Maker</h3><p>Maintain real USDC inventory for Aqua virtual strategies and separate available USDC collateral in BondVault. Connect the configured maker account to deposit or withdraw available collateral.</p></DocSection>
        <DocSection id="security" number="13" title="Security properties"><ul><li>One terminal Registry result per commitment.</li><li>No double trader input and no Aqua-plus-Bond double payout.</li><li>Expired execution is rejected.</li><li>Only eligible capacity failures select Bond.</li><li>Unknown failures fail closed.</li><li>Receipt reconstruction rejects missing, duplicate, or inconsistent evidence.</li></ul></DocSection>
        <DocSection id="limitations" number="14" title="Current scope / limitations"><ul><li>Public-testnet Sepolia environment.</li><li>Canonical exact-input WETH → USDC path.</li><li>Full output-token collateral.</li><li>Short 5, 30, and 120-second Firm TTLs.</li><li>Hackathon prototype; not independently audited or production-ready.</li><li>No cross-chain routing, undercollateralized credit, or exotic-token support.</li></ul></DocSection>
        <DocSection id="links" number="15" title="Developer / evidence links"><div className="docs-links"><a className="button button-primary" href="/trade">Trade</a><a className="button button-outline" href="/evidence">Evidence</a><a className="button button-outline" href="/maker">Maker</a></div><p>Implementation sources: <code>packages/frontend</code>, <code>packages/sdk</code>, <code>packages/contracts</code>, and <code>deployments/sepolia.json</code>. No private key or private RPC value is exposed by this page.</p></DocSection>
      </article>
    </div>
  </div>;
}

function DocSection({ id, number, title, children }: { id: string; number: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="doc-section"><span>{number}</span><h2>{title}</h2>{children}</section>;
}

function Definition({ term, children }: { term: string; children: React.ReactNode }) {
  return <div className="term-definition"><strong>{term}</strong><p>{children}</p></div>;
}

function addressLabel(value: string) {
  return value === "bondVault" ? "BondVault" : value === "firmRouter" ? "Firm Router" : value === "weth" ? "WETH" : value === "usdc" ? "USDC" : value[0]!.toUpperCase() + value.slice(1);
}
