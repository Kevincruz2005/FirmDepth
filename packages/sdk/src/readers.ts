import type { Address, Hex, PublicClient } from "viem";

import { aquaAbi, bondVaultAbi, erc20Abi, registryAbi, swapVmAbi } from "./requests.js";
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

export interface LiquidityReality {
  blockNumber: bigint;
  virtualDepth: bigint;
  realBalance: bigint;
  aquaAllowance: bigint;
  pullableBacking: bigint;
  firmDepth: bigint;
  strategyActive: boolean;
}

export interface FirmEligibilityQuery extends CapacityQuery {
  vault: Address;
  requiredBond: bigint;
  requiredOutput: bigint;
  amountIn: bigint;
  order: { maker: Address; traits: bigint; data: Hex };
  takerTraits: Hex;
}

export interface FirmEligibility {
  eligible: boolean;
  blockNumber: bigint;
  liquidity: LiquidityReality;
  availableBond: bigint;
  quotedAmountIn: bigint | null;
  quotedAmountOut: bigint | null;
  quotedOrderHash: Hex | null;
  reasons: string[];
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

export async function getLiquidityReality(
  client: PublicClient,
  query: CapacityQuery,
): Promise<LiquidityReality> {
  const [capacity, blockNumber] = await Promise.all([
    readAquaCapacity(client, query),
    client.getBlockNumber(),
  ]);
  return {
    blockNumber,
    virtualDepth: capacity.virtualBalance,
    realBalance: capacity.realBalance,
    aquaAllowance: capacity.aquaAllowance,
    pullableBacking: min(capacity.realBalance, capacity.aquaAllowance),
    firmDepth: capacity.effectiveCapacity,
    strategyActive: capacity.strategyActive,
  };
}

export async function getVirtualDepth(client: PublicClient, query: CapacityQuery): Promise<{ blockNumber: bigint; value: bigint }> {
  const liquidity = await getLiquidityReality(client, query);
  return { blockNumber: liquidity.blockNumber, value: liquidity.virtualDepth };
}

export async function getPullableBackingAtBlock(
  client: PublicClient,
  query: CapacityQuery,
): Promise<{ blockNumber: bigint; value: bigint; realBalance: bigint; aquaAllowance: bigint }> {
  const liquidity = await getLiquidityReality(client, query);
  return {
    blockNumber: liquidity.blockNumber,
    value: liquidity.pullableBacking,
    realBalance: liquidity.realBalance,
    aquaAllowance: liquidity.aquaAllowance,
  };
}

export async function getFirmDepth(client: PublicClient, query: CapacityQuery): Promise<{ blockNumber: bigint; value: bigint }> {
  const liquidity = await getLiquidityReality(client, query);
  return { blockNumber: liquidity.blockNumber, value: liquidity.firmDepth };
}

export async function checkFirmEligibility(
  client: PublicClient,
  query: FirmEligibilityQuery,
): Promise<FirmEligibility> {
  const [liquidity, availableBond, quoteResult] = await Promise.all([
    getLiquidityReality(client, query),
    client.readContract({
      address: query.vault,
      abi: bondVaultAbi,
      functionName: "availableOf",
      args: [query.maker],
    }),
    client.readContract({
      address: query.router,
      abi: swapVmAbi,
      functionName: "quote",
      args: [query.order, query.amountIn, query.takerTraits],
    }).then((value) => ({ value, error: null })).catch((error: unknown) => ({ value: null, error })),
  ]);
  const reasons: string[] = [];
  if (!liquidity.strategyActive) reasons.push("STRATEGY_INACTIVE");
  if (liquidity.firmDepth < query.requiredOutput) reasons.push("INSUFFICIENT_AQUA_CAPACITY");
  if (availableBond < query.requiredBond) reasons.push("INSUFFICIENT_BOND");

  let quotedAmountIn: bigint | null = null;
  let quotedAmountOut: bigint | null = null;
  let quotedOrderHash: Hex | null = null;
  if (quoteResult.value === null) {
    reasons.push("STATIC_QUOTE_FAILED");
  } else {
    [quotedAmountIn, quotedAmountOut, quotedOrderHash] = quoteResult.value;
    if (quotedAmountIn !== query.amountIn) reasons.push("QUOTED_INPUT_MISMATCH");
    if (quotedAmountOut < query.requiredOutput) reasons.push("QUOTED_OUTPUT_TOO_LOW");
    if (quotedOrderHash.toLowerCase() !== query.orderHash.toLowerCase()) reasons.push("ORDER_HASH_MISMATCH");
  }
  return {
    eligible: reasons.length === 0,
    blockNumber: liquidity.blockNumber,
    liquidity,
    availableBond,
    quotedAmountIn,
    quotedAmountOut,
    quotedOrderHash,
    reasons,
  };
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
    acceptedBlock: raw.acceptedBlock,
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
