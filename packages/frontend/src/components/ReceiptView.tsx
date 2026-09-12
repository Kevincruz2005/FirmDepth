import type { FirmExecutionReceipt } from "@firmdepth/sdk/receipt";
import { Check, Minus } from "lucide-react";
import { formatToken } from "../lib/format";
import { HashLink, Metric, StatusDot } from "./Primitives";

export function ReceiptView({ receipt, provenance = "LIVE" }: { receipt: FirmExecutionReceipt; provenance?: "LIVE" | "VERIFIED BASE-FORK RUN" }) {
  return <section className="authoritative-receipt" aria-label="Authoritative Firm execution receipt">
    <div className="receipt-summary"><div><StatusDot tone="good">{provenance}</StatusDot><h2>{receipt.finalState}</h2><p>{receipt.path} terminal path</p></div><Metric label="Amount received" value={`${formatToken(receipt.totalTokenDeltas.traderTokenOut, 6, 2)} USDC`} /><Metric label="Minimum output" value={`${formatToken(receipt.minAmountOut, 6, 2)} USDC`} /><Metric label="Premium" value={`${formatToken(receipt.premium, 18, 8)} WETH`} /><Metric label="Bond consumed" value={`${formatToken(receipt.bondConsumed, 6, 2)} USDC`} /><Metric label="Bond released" value={`${formatToken(receipt.bondReleased, 6, 2)} USDC`} /><Metric label="Accepted / terminal" value={`${receipt.acceptanceBlock} / ${receipt.executionBlock}`} /></div>
    <details className="receipt-technical"><summary>Technical proof</summary><dl className="receipt-details">
      <Row label="Commitment"><HashLink value={receipt.commitmentId} /></Row><Row label="Order hash"><HashLink value={receipt.orderHash} /></Row>
      <Row label="Maker"><HashLink value={receipt.maker} /></Row><Row label="Taker"><HashLink value={receipt.taker} /></Row>
      <Row label="Pricing version">v{receipt.pricingVersion} · TTL {receipt.pricingTtl}s</Row>
      <Row label="FIRM_PRICE">{receipt.firmPrice.executed ? <><Check size={14} /> executed · 0x{receipt.firmPrice.opcode.toString(16)}</> : <><Minus size={14} /> skipped · {receipt.firmPrice.proof}</>}</Row>
      <Row label="FIRM_GUARD">{receipt.firmGuard.executed ? <><Check size={14} /> executed · 0x{receipt.firmGuard.opcode.toString(16)}</> : <><Minus size={14} /> skipped · {receipt.firmGuard.proof}</>}</Row>
      <Row label="Native threshold">{receipt.threshold.toString()}</Row><Row label="Native deadline">{receipt.deadline.toString()}</Row>
      <Row label="Trader deltas">WETH {signed(receipt.totalTokenDeltas.traderTokenIn, 18)} · USDC {signed(receipt.totalTokenDeltas.traderTokenOut, 6)}</Row>
      <Row label="Maker deltas">WETH {signed(receipt.totalTokenDeltas.makerTokenIn, 18)} · USDC {signed(receipt.totalTokenDeltas.makerTokenOut, 6)}</Row>
      <Row label="Acceptance tx"><HashLink value={receipt.acceptanceTransactionHash} /></Row><Row label="Terminal tx"><HashLink value={receipt.transactionHash} /></Row>
    </dl></details>
  </section>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) { return <div><dt>{label}</dt><dd>{children ?? "—"}</dd></div>; }
function signed(value: bigint, decimals: number) { return `${value >= 0n ? "+" : "−"}${formatToken(value >= 0n ? value : -value, decimals, decimals === 18 ? 6 : 2)}`; }
