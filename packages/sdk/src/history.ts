import type { Address, Hash, Hex, PublicClient } from "viem";

import { readCommitment } from "./readers.js";
import { registryAbi } from "./requests.js";
import type { Commitment } from "./types.js";

export interface CommitmentHistoryItem {
  commitmentId: Hex;
  acceptanceTransactionHash: Hash;
  terminalTransactionHash: Hash | null;
  commitment: Commitment;
}

export async function findCommitmentsForTaker(
  client: PublicClient,
  registry: Address,
  taker: Address,
  orderHash: Hex,
  fromBlock: bigint,
): Promise<CommitmentHistoryItem[]> {
  const accepted = await client.getContractEvents({
    address: registry, abi: registryAbi, eventName: "CommitmentAccepted", args: { taker }, fromBlock, toBlock: "latest",
  });
  const matching = accepted.filter((event) => event.args.orderHash?.toLowerCase() === orderHash.toLowerCase());
  const items = await Promise.all(matching.map(async (event) => {
    const commitmentId = event.args.commitmentId as Hex;
    const commitment = await readCommitment(client, registry, commitmentId);
    let terminalTransactionHash: Hash | null = null;
    if (commitment.status !== "ACCEPTED" && commitment.status !== "NONE") {
      const settled = await client.getContractEvents({
        address: registry, abi: registryAbi, eventName: "CommitmentSettled", args: { commitmentId },
        fromBlock: commitment.acceptedBlock, toBlock: "latest",
      });
      terminalTransactionHash = settled.at(-1)?.transactionHash ?? null;
    }
    return {
      commitmentId,
      acceptanceTransactionHash: event.transactionHash,
      terminalTransactionHash,
      commitment,
    };
  }));
  return items.sort((a, b) => a.commitment.acceptedBlock > b.commitment.acceptedBlock ? -1 : 1);
}

export async function findDeploymentCommitments(
  client: PublicClient,
  registry: Address,
  fromBlock: bigint,
): Promise<CommitmentHistoryItem[]> {
  const events = await client.getContractEvents({ address: registry, abi: registryAbi, eventName: "CommitmentAccepted", fromBlock });
  const records = await Promise.all(events.map(async (event) => {
    const commitmentId = event.args.commitmentId!;
    const commitment = await readCommitment(client, registry, commitmentId);
    const settled = commitment.status === "ACCEPTED" ? [] : await client.getContractEvents({ address: registry, abi: registryAbi, eventName: "CommitmentSettled", args: { commitmentId }, fromBlock: commitment.acceptedBlock });
    return { commitmentId, commitment, acceptanceTransactionHash: event.transactionHash, terminalTransactionHash: settled.at(-1)?.transactionHash ?? null };
  }));
  return records.sort((a, b) => a.commitment.acceptedBlock > b.commitment.acceptedBlock ? -1 : 1);
}
