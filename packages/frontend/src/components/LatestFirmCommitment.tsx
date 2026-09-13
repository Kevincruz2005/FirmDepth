import type { CommitmentHistoryItem } from "@firmdepth/sdk/history";
import type { FirmExecutionReceipt } from "@firmdepth/sdk/receipt";
import { ArrowRight, CircleAlert, Play, TimerReset } from "lucide-react";
import { formatToken } from "../lib/format";
import { ExplorerHashLink, HashLink, StatusDot } from "./Primitives";

interface Props {
  commitment: CommitmentHistoryItem | null;
  receipt: FirmExecutionReceipt | null;
  currentLock: bigint | null;
  secondsRemaining: bigint | null;
  explorerUrl?: string;
  busy: boolean;
  connected: boolean;
  onExecute: () => void;
  onExpire: () => void;
}

export function LatestFirmCommitment({ commitment, receipt, currentLock, secondsRemaining, explorerUrl, busy, connected, onExecute, onExpire }: Props) {
  const status = commitment?.commitment.status;
  const quote = commitment?.commitment.quote;
  const expiredAccepted = status === "ACCEPTED" && secondsRemaining === 0n;
  return <section className="latest-commitment" aria-labelledby="latest-commitment-title">
    <div className="latest-commitment-head"><div><span>Wallet and runtime scoped</span><h2 id="latest-commitment-title">Latest Firm commitment</h2></div>{status && <StatusDot tone={status === "ACCEPTED" ? "neutral" : "good"}>{status}</StatusDot>}</div>
    {!connected ? <p className="commitment-empty">Connect a Sepolia wallet to read its latest Firm commitment.</p> : commitment === null || quote === undefined ? <p className="commitment-empty">No Firm commitment yet</p> : <>
      <dl className="commitment-facts">
        <Fact label="Commitment ID"><HashLink value={commitment.commitmentId} /></Fact>
        {status === "ACCEPTED" && <>
          <Fact label="Minimum output">{formatToken(quote.minAmountOut, 6, 2)} USDC</Fact>
          <Fact label="Premium">{formatToken(quote.premiumAmount, 18, 8)} WETH</Fact>
          <Fact label="Bond locked">{currentLock === null ? "…" : `${formatToken(currentLock, 6, 2)} USDC`}</Fact>
          <Fact label="Accepted block">{commitment.commitment.acceptedBlock.toString()}</Fact>
          <Fact label="Expiry / countdown">{new Date(Number(quote.expiry) * 1000).toISOString()} · {secondsRemaining === null ? "…" : expiredAccepted ? "expiry reached" : `${secondsRemaining}s`}</Fact>
          <Fact label="Acceptance transaction"><Transaction value={commitment.acceptanceTransactionHash} explorerUrl={explorerUrl} /></Fact>
        </>}
        {receipt?.finalState === "FILLED_AQUA" && <>
          <Fact label="Path">AQUA</Fact><Fact label="Amount received">{formatToken(receipt.totalTokenDeltas.traderTokenOut, 6, 2)} USDC</Fact>
          <Fact label="Minimum output">{formatToken(receipt.minAmountOut, 6, 2)} USDC</Fact><Fact label="Premium">{formatToken(receipt.premium, 18, 8)} WETH · finalized</Fact>
          <Fact label="Bond released">{formatToken(receipt.bondReleased, 6, 2)} USDC</Fact><Fact label="Bond consumed">{formatToken(receipt.bondConsumed, 6, 2)} USDC</Fact>
          <Fact label="Accepted block">{receipt.acceptanceBlock.toString()}</Fact><Fact label="Terminal block">{receipt.executionBlock.toString()}</Fact>
          <Fact label="Execution transaction"><Transaction value={receipt.transactionHash} explorerUrl={explorerUrl} /></Fact>
        </>}
        {receipt?.finalState === "FILLED_BOND" && <>
          <Fact label="Path">BOND</Fact><Fact label="Amount received">{formatToken(receipt.totalTokenDeltas.traderTokenOut, 6, 2)} USDC</Fact>
          <Fact label="Minimum output">{formatToken(receipt.minAmountOut, 6, 2)} USDC</Fact><Fact label="Bond consumed">{formatToken(receipt.bondConsumed, 6, 2)} USDC</Fact>
          <Fact label="Premium result">{formatToken(receipt.premium, 18, 8)} WETH · finalized</Fact><Fact label="Terminal block">{receipt.executionBlock.toString()}</Fact>
          <Fact label="Transaction"><Transaction value={receipt.transactionHash} explorerUrl={explorerUrl} /></Fact>
        </>}
        {receipt?.finalState === "EXPIRED" && <>
          <Fact label="Principal execution">None</Fact><Fact label="Bond released">{formatToken(receipt.bondReleased, 6, 2)} USDC</Fact>
          <Fact label="Premium result">{formatToken(receipt.premium, 18, 8)} WETH · finalized</Fact><Fact label="Terminal block">{receipt.executionBlock.toString()}</Fact>
          <Fact label="Terminal transaction"><Transaction value={receipt.transactionHash} explorerUrl={explorerUrl} /></Fact>
        </>}
      </dl>
      {status === "ACCEPTED" && <div className="commitment-actions">{expiredAccepted ? <button className="button button-outline" type="button" onClick={onExpire} disabled={busy}><TimerReset size={16} />Settle expiry</button> : <button className="button button-primary" type="button" onClick={onExecute} disabled={busy}><Play size={16} />Execute</button>}<span>{expiredAccepted ? <><CircleAlert size={14} /> Commitment expired — settle expiry.</> : "The accepted quote and Bond lock were recovered from Registry state."}</span></div>}
      <a className="text-link" href="/evidence">View in Evidence <ArrowRight size={15} /></a>
    </>}
  </section>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }

function Transaction({ value, explorerUrl }: { value: string; explorerUrl?: string }) {
  return explorerUrl ? <ExplorerHashLink value={value} href={`${explorerUrl}/tx/${value}`} /> : <code>{value}</code>;
}
