import type { Address, Hex, PublicClient } from "viem";

import { aquaAbi, bondVaultAbi, erc20Abi, registryAbi } from "./requests.js";
import type {
  Capacity,
  Commitment,
  CommitmentStatus,
  FirmDepthSnapshot,
  FirmQuote,
  MakerBondState,
} from "./types.js";

export interface CapacityQuery {
  aqua: Address;
  router: Address;
  maker: Address;
  orderHash: Hex;
  tokenIn: Address;
  tokenOut: Address;
}

export async function readAquaCapacity(client: PublicClient, query: CapacityQuery): Promise<Capacity> {
  const [outputRaw, inputRaw, realBalance, aquaAllowance] = await Promise.all([
    client.readContract({
      address: query.aqua,
      abi: aquaAbi,
      functionName: "rawBalances",
      args: [query.maker, query.router, query.orderHash, query.tokenOut],
    }),
    client.readContract({
      address: query.aqua,
      abi: aquaAbi,
      functionName: "rawBalances",
      args: [query.maker, query.router, query.orderHash, query.tokenIn],
    }),
    client.readContract({
      address: query.tokenOut,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [query.maker],
    }),
    client.readContract({
      address: query.tokenOut,
      abi: erc20Abi,
      functionName: "allowance",
      args: [query.maker, query.aqua],
    }),
  ]);

  const [virtualBalance, outputTokenCount] = outputRaw;
  const [, inputTokenCount] = inputRaw;
  const strategyActive = activeTokenCount(inputTokenCount) && activeTokenCount(outputTokenCount);
  const effectiveCapacity = strategyActive
    ? min(virtualBalance, min(realBalance, aquaAllowance))
    : 0n;

  return { virtualBalance, realBalance, aquaAllowance, effectiveCapacity, strategyActive };
}

export async function readMakerBond(
  client: PublicClient,
  vault: Address,
  maker: Address,
): Promise<MakerBondState> {
  const [available, locked] = await Promise.all([
    client.readContract({ address: vault, abi: bondVaultAbi, functionName: "availableOf", args: [maker] }),
    client.readContract({ address: vault, abi: bondVaultAbi, functionName: "lockedOf", args: [maker] }),
  ]);
  return { available, locked, total: available + locked };
}

export async function readCommitment(
  client: PublicClient,
  registry: Address,
  commitmentId: Hex,
): Promise<Commitment> {
  const raw = await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "getCommitment",
    args: [commitmentId],
  });
  const quote = raw.quote as FirmQuote;
  return {
    quote,
    status: commitmentStatus(Number(raw.status)),
    acceptedAt: raw.acceptedAt,
    settledAt: raw.settledAt,
  };
}

export async function readFirmDepthSnapshot(
  client: PublicClient,
  addresses: { aqua: Address; router: Address; vault: Address; registry: Address },
  commitmentId: Hex,
): Promise<FirmDepthSnapshot> {
  const commitment = await readCommitment(client, addresses.registry, commitmentId);
  const [capacity, makerBond, blockNumber] = await Promise.all([
    readAquaCapacity(client, {
      aqua: addresses.aqua,
      router: addresses.router,
      maker: commitment.quote.maker,
      orderHash: commitment.quote.orderHash,
      tokenIn: commitment.quote.tokenIn,
      tokenOut: commitment.quote.tokenOut,
    }),
    readMakerBond(client, addresses.vault, commitment.quote.maker),
    client.getBlockNumber(),
  ]);
  return { capacity, makerBond, commitment, blockNumber };
}

export function commitmentStatus(value: number): CommitmentStatus {
  const status = ["NONE", "ACCEPTED", "FILLED_AQUA", "FILLED_BOND", "EXPIRED"] as const;
  const decoded = status[value];
  if (decoded === undefined) throw new RangeError(`unknown commitment status ${value}`);
  return decoded;
}

function activeTokenCount(value: number): boolean {
  return value !== 0 && value !== 0xff;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
