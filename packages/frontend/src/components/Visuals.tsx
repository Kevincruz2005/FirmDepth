import { frontierPoints } from "../data/evidence";

export function DepthDiagram({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={`depth-diagram ${compact ? "compact" : ""}`} aria-labelledby="depth-title depth-desc">
      <figcaption id="depth-title">WETH / USDC depth reality</figcaption>
      <p id="depth-desc" className="sr-only">Virtual depth is advertised Aqua output. Pullable depth is capped by active virtual balance, real inventory, and Aqua allowance. Firm depth for a quote is capped again by free Bond under that quote's collateral ratio.</p>
      <svg viewBox="0 0 680 330" role="img" aria-hidden="true">
        <defs>
          <pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="currentColor" opacity=".18" /></pattern>
        </defs>
        <path className="depth-virtual" d="M30 286 C115 210 178 237 245 154 C320 63 401 110 466 51 C526 -2 611 20 650 30 L650 300 L30 300Z" />
        <path className="depth-pullable" d="M30 286 C114 247 186 250 245 210 C322 160 398 194 471 128 C531 74 602 94 650 75 L650 300 L30 300Z" />
        <path className="depth-firm" d="M30 286 C111 263 178 275 248 246 C330 211 403 232 474 193 C548 152 608 165 650 145 L650 300 L30 300Z" />
        <line x1="30" y1="300" x2="650" y2="300" className="axis" />
        <line x1="30" y1="302" x2="30" y2="308" className="axis" /><line x1="650" y1="302" x2="650" y2="308" className="axis" />
        <text x="30" y="325">0</text><text x="605" y="325">quote size</text>
        <g transform="translate(58 52)"><circle r="5" className="key virtual" /><text x="13" y="5">Virtual</text></g>
        <g transform="translate(58 78)"><circle r="5" className="key pullable" /><text x="13" y="5">Pullable</text></g>
        <g transform="translate(58 104)"><circle r="5" className="key firm" /><text x="13" y="5">Firm</text></g>
      </svg>
    </figure>
  );
}

export function FrontierChart() {
  return (
    <figure className="frontier-chart" aria-labelledby="frontier-title frontier-desc">
      <figcaption id="frontier-title">Capital-Certainty Frontier</figcaption>
      <p id="frontier-desc" className="sr-only">FirmDepth reaches full protected settlement in the selected synthetic stress scenario while retaining the same 88.65 percent capital reuse as Soft Aqua.</p>
      <svg viewBox="0 0 620 410" role="img" aria-hidden="true">
        <line x1="80" y1="330" x2="575" y2="330" className="axis" />
        <line x1="80" y1="330" x2="80" y2="45" className="axis" />
        {[0, .25, .5, .75, 1].map((v) => <g key={v}><line x1="76" y1={330 - v * 250} x2="575" y2={330 - v * 250} className="grid" /><text x="50" y={335 - v * 250}>{Math.round(v * 100)}</text></g>)}
        <text x="260" y="385">capital reuse →</text><text transform="translate(20 260) rotate(-90)">protected settlement →</text>
        {frontierPoints.map((point) => {
          const x = 80 + point.reuse * 495;
          const y = 330 - point.certainty * 250;
          return <g key={point.label} transform={`translate(${x} ${y})`}><circle r={point.label === "FirmDepth" ? 13 : 9} fill={point.color} /><text x={point.label === "Soft Aqua" ? -82 : -40} y={point.label === "Hard reservation" ? 28 : -18}>{point.label}</text></g>;
        })}
        <path d="M411 80 L519 80" className="frontier-line" />
      </svg>
    </figure>
  );
}

export function SettlementBranch() {
  return (
    <div className="settlement-map" role="img" aria-label="Accepted commitment branches to Aqua when capacity remains sufficient, or Bond when deterministic capacity is unavailable. Unrelated failures revert atomically.">
      <div className="branch-node accepted"><span>01</span><strong>Accepted</strong><small>premium escrowed · bond locked</small></div>
      <div className="branch-rail" aria-hidden="true"><span /><span /></div>
      <div className="branch-options">
        <div className="branch-node aqua"><span>02.A</span><strong>Aqua path</strong><small>capacity ≥ signed minimum</small><b>FILLED_AQUA</b></div>
        <div className="branch-node bond"><span>02.B</span><strong>Bond path</strong><small>capacity &lt; signed minimum</small><b>FILLED_BOND</b></div>
      </div>
      <p className="revert-note"><span>Fail closed</span> Token, router, instruction, or malformed-program errors revert the entire attempt. The commitment and bond remain untouched.</p>
    </div>
  );
}
