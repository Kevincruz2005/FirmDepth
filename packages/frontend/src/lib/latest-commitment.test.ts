import type { CommitmentHistoryItem } from "@firmdepth/sdk/history";
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { selectLatestFirmCommitment } from "./latest-commitment";

const taker = "0x0000000000000000000000000000000000000001" as const;
const other = "0x0000000000000000000000000000000000000002" as const;
const orderHash = `0x${"11".repeat(32)}` as const;

function record(block: bigint, status: "ACCEPTED" | "FILLED_AQUA", owner: Address = taker): CommitmentHistoryItem {
  return { commitmentId: `0x${block.toString(16).padStart(64, "0")}`, acceptanceTransactionHash: `0x${"22".repeat(32)}`, terminalTransactionHash: status === "ACCEPTED" ? null : `0x${"33".repeat(32)}`, commitment: { status, acceptedAt: block, settledAt: status === "ACCEPTED" ? 0n : block + 1n, acceptedBlock: block, quote: { taker: owner, orderHash } } } as unknown as CommitmentHistoryItem;
}

describe("latest Firm commitment selection", () => {
  const scope = { account: taker, walletChainId: 11155111, runtimeChainId: 11155111, orderHash };

  it("lets a newer ACCEPTED commitment supersede an older terminal commitment", () => {
    expect(selectLatestFirmCommitment([record(10n, "FILLED_AQUA"), record(11n, "ACCEPTED")], scope)?.commitment.acceptedBlock).toBe(11n);
  });

  it("keeps the newer commitment latest after it becomes terminal", () => {
    expect(selectLatestFirmCommitment([record(10n, "FILLED_AQUA"), record(11n, "FILLED_AQUA")], scope)?.commitment.acceptedBlock).toBe(11n);
  });

  it("excludes another wallet and any mismatched wallet chain", () => {
    expect(selectLatestFirmCommitment([record(12n, "ACCEPTED", other), record(10n, "FILLED_AQUA")], scope)?.commitment.acceptedBlock).toBe(10n);
    expect(selectLatestFirmCommitment([record(10n, "FILLED_AQUA")], { ...scope, walletChainId: 1 })).toBeNull();
    expect(selectLatestFirmCommitment([], scope)).toBeNull();
  });
});
