import type { CommitmentHistoryItem } from "@firmdepth/sdk/history";
import type { Address, Hex } from "viem";

export interface LatestCommitmentScope {
  account: Address | null;
  walletChainId: number | null;
  runtimeChainId: number;
  orderHash: Hex;
}
export function selectLatestFirmCommitment(records: CommitmentHistoryItem[], scope: LatestCommitmentScope): CommitmentHistoryItem | null {
  if (scope.account === null || scope.walletChainId !== scope.runtimeChainId) return null;
  return records
    .filter(({ commitment }) => commitment.quote.taker.toLowerCase() === scope.account!.toLowerCase() && commitment.quote.orderHash.toLowerCase() === scope.orderHash.toLowerCase())
    .sort((a, b) => a.commitment.acceptedBlock === b.commitment.acceptedBlock
      ? Number(b.commitment.acceptedAt - a.commitment.acceptedAt)
      : a.commitment.acceptedBlock > b.commitment.acceptedBlock ? -1 : 1)[0] ?? null;
}
