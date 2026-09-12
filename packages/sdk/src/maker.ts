import type { Address, Hex, PublicClient } from "viem";

import { readAquaCapacity, readCommitment, type CapacityQuery } from "./readers.js";
import { registryAbi } from "./requests.js";
import type { CommitmentStatus } from "./types.js";

export interface ConfiguredLiquidityAggregate {
  blockNumber: bigint;
  strategyCount: number;
  activeStrategyCount: number;
  virtualDepth: bigint;
  pullableDepth: bigint;
  realInventory: bigint;
  aquaAllowance: bigint;
}

export async function readConfiguredLiquidityAggregate(
  client: PublicClient,
  queries: readonly CapacityQuery[],
): Promise<ConfiguredLiquidityAggregate> {
  if (queries.length === 0) throw new RangeError("at least one configured strategy is required");
  const first = queries[0]!;
  for (const query of queries) {
    for (const key of ["aqua", "router", "maker", "tokenIn", "tokenOut"] as const) {
      if (query[key].toLowerCase() !== first[key].toLowerCase()) throw new Error(`configured aggregate ${key} mismatch`);
    }
  }
  const [capacities, blockNumber] = await Promise.all([Promise.all(queries.map((query) => readAquaCapacity(client, query))), client.getBlockNumber()]);
  const virtualDepth = capacities.reduce((sum, capacity) => sum + capacity.virtualBalance, 0n);
  const activeVirtual = capacities.reduce((sum, capacity) => sum + (capacity.strategyActive ? capacity.virtualBalance : 0n), 0n);
  const realInventory = capacities[0]!.realBalance;
  const aquaAllowance = capacities[0]!.aquaAllowance;
  return {
    blockNumber, strategyCount: capacities.length,
    activeStrategyCount: capacities.filter((capacity) => capacity.strategyActive).length,
    virtualDepth, realInventory, aquaAllowance,
    pullableDepth: min(activeVirtual, min(realInventory, aquaAllowance)),
  };
}

export interface MakerCommitmentHistory {
  blockNumber: bigint;
  activeCommitments: number;
  activeRequiredBond: bigint;
  nextExpiry: bigint | null;
  outcomeCounts: Record<Exclude<CommitmentStatus, "NONE" | "ACCEPTED">, number>;
  premiumHistory: { commitmentId: Hex; status: Exclude<CommitmentStatus, "NONE" | "ACCEPTED">; premium: bigint; settledAt: bigint }[];
}

export async function readMakerCommitmentHistory(
  client: PublicClient,
  registry: Address,
  maker: Address,
  fromBlock: bigint,
): Promise<MakerCommitmentHistory> {
  const [events, blockNumber] = await Promise.all([
    client.getContractEvents({ address: registry, abi: registryAbi, eventName: "CommitmentAccepted", args: { maker }, fromBlock }),
    client.getBlockNumber(),
  ]);
  const records = await Promise.all(events.map(async (event) => ({ commitmentId: event.args.commitmentId!, commitment: await readCommitment(client, registry, event.args.commitmentId!) })));
  const active = records.filter(({ commitment }) => commitment.status === "ACCEPTED");
  const terminal = records.filter(({ commitment }) => !["NONE", "ACCEPTED"].includes(commitment.status));
  const outcomeCounts = { FILLED_AQUA: 0, FILLED_BOND: 0, EXPIRED: 0 };
  for (const { commitment } of terminal) outcomeCounts[commitment.status as keyof typeof outcomeCounts] += 1;
  const expiries = active.map(({ commitment }) => commitment.quote.expiry);
  return {
    blockNumber,
    activeCommitments: active.length,
    activeRequiredBond: active.reduce((sum, { commitment }) => sum + commitment.quote.requiredBond, 0n),
    nextExpiry: expiries.length === 0 ? null : expiries.reduce((earliest, value) => value < earliest ? value : earliest),
    outcomeCounts,
    premiumHistory: terminal.map(({ commitmentId, commitment }) => ({ commitmentId, status: commitment.status as Exclude<CommitmentStatus, "NONE" | "ACCEPTED">, premium: commitment.quote.premiumAmount, settledAt: commitment.settledAt })).sort((a, b) => a.settledAt > b.settledAt ? -1 : 1),
  };
}

function min(a: bigint, b: bigint): bigint { return a < b ? a : b; }
