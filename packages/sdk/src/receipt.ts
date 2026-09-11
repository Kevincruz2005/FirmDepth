import {
  decodeEventLog,
  getAddress,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

import { readCommitment } from "./readers.js";
import { bondVaultAbi, erc20Abi, executorAbi, registryAbi, swapVmAbi } from "./requests.js";
import { buildFirmProgram, buildFirmTakerTraits, decodeFirmTakerTraits, FIRM_GUARD_OPCODE, FIRM_PRICE_OPCODE } from "./swapvm.js";
import type { CommitmentStatus } from "./types.js";

export interface FirmReceiptAddresses {
  registry: Address;
  executor: Address;
  router: Address;
  vault: Address;
}

export interface FirmReceiptQuery extends FirmReceiptAddresses {
  commitmentId: Hex;
  acceptanceTransactionHash: Hash;
  terminalTransactionHash: Hash;
}

export interface ParticipantTokenDeltas {
  makerTokenIn: bigint;
  makerTokenOut: bigint;
  traderTokenIn: bigint;
  traderTokenOut: bigint;
}

export interface OpcodeEvidence {
  opcode: number;
  executed: boolean;
  proof: "SUCCESSFUL_BOUND_SWAP" | "PATH_SKIPPED_SWAPVM";
}

export interface FirmExecutionReceipt {
  commitmentId: Hex;
  orderHash: Hex;
  maker: Address;
  taker: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  referenceOut: bigint;
  premium: bigint;
  pricingVersion: number;
  pricingTtl: number;
  acceptanceBlock: bigint;
  acceptanceTimestamp: bigint;
  executionBlock: bigint;
  executionTimestamp: bigint;
  firmPrice: OpcodeEvidence;
  firmGuard: OpcodeEvidence;
  program: Hex;
  threshold: bigint;
  deadline: bigint;
  bondInitiallyLocked: bigint;
  bondReleased: bigint;
  bondConsumed: bigint;
  bondRemaining: bigint;
  finalState: Exclude<CommitmentStatus, "NONE" | "ACCEPTED">;
  path: "AQUA" | "BOND" | "EXPIRED";
  acceptanceTokenDeltas: ParticipantTokenDeltas;
  terminalTokenDeltas: ParticipantTokenDeltas;
  totalTokenDeltas: ParticipantTokenDeltas;
  acceptanceTransactionHash: Hash;
  transactionHash: Hash;
}

export async function getFirmExecutionReceipt(
  client: PublicClient,
  query: FirmReceiptQuery,
): Promise<FirmExecutionReceipt> {
  const addresses = normalizeAddresses(query);
  const [commitment, acceptanceReceipt, terminalReceipt, remainingLock, runtimeTraits] = await Promise.all([
    readCommitment(client, addresses.registry, query.commitmentId),
    client.getTransactionReceipt({ hash: query.acceptanceTransactionHash }),
    client.getTransactionReceipt({ hash: query.terminalTransactionHash }),
    client.readContract({
      address: addresses.vault,
      abi: bondVaultAbi,
      functionName: "lockedFor",
      args: [query.commitmentId],
    }),
    client.readContract({
      address: addresses.executor,
      abi: executorAbi,
      functionName: "buildTakerTraits",
      args: [query.commitmentId],
    }),
  ]);
  requireSuccessful(acceptanceReceipt, "acceptance");
  requireSuccessful(terminalReceipt, "terminal");

  if (commitment.status === "NONE" || commitment.status === "ACCEPTED") {
    throw new Error(`commitment is not terminal: ${commitment.status}`);
  }
  const path = commitment.status === "FILLED_AQUA"
    ? "AQUA"
    : commitment.status === "FILLED_BOND" ? "BOND" : "EXPIRED";
  const accepted = oneEvent(acceptanceReceipt.logs, addresses.registry, registryAbi, "CommitmentAccepted");
  const settled = oneEvent(terminalReceipt.logs, addresses.registry, registryAbi, "CommitmentSettled");
  const locked = oneEvent(acceptanceReceipt.logs, addresses.vault, bondVaultAbi, "BondLocked");
  assertHex(accepted.commitmentId, query.commitmentId, "accepted commitment id");
  assertHex(settled.commitmentId, query.commitmentId, "settled commitment id");
  assertHex(locked.commitmentId, query.commitmentId, "bond commitment id");
  assertHex(accepted.orderHash, commitment.quote.orderHash, "accepted order hash");
  assertAddress(accepted.maker, commitment.quote.maker, "accepted maker");
  assertAddress(accepted.taker, commitment.quote.taker, "accepted taker");
  if (BigInt(accepted.acceptedBlock as bigint) !== commitment.acceptedBlock) {
    throw new Error("acceptance event and commitment block differ");
  }

  const expectedStatus = path === "AQUA" ? 2n : path === "BOND" ? 3n : 4n;
  if (BigInt(settled.status as bigint) !== expectedStatus) throw new Error("settlement event status differs from state");
  const bondInitiallyLocked = BigInt(locked.amount as bigint);
  if (bondInitiallyLocked !== commitment.quote.requiredBond) throw new Error("initial bond lock differs from quote");

  const decodedTraits = decodeFirmTakerTraits(runtimeTraits);
  const expectedTraits = buildFirmTakerTraits({
    amountOut: commitment.quote.minAmountOut,
    tokenIn: commitment.quote.tokenIn,
    tokenOut: commitment.quote.tokenOut,
    taker: addresses.executor,
    recipient: commitment.quote.taker,
    deadline: commitment.quote.expiry,
    commitmentId: query.commitmentId,
  });
  if (runtimeTraits.toLowerCase() !== expectedTraits.toLowerCase()) {
    throw new Error("SDK encoding differs from executor runtime taker traits");
  }
  if (decodedTraits.threshold !== commitment.quote.minAmountOut || decodedTraits.instructionAmountOut !== commitment.quote.minAmountOut) {
    throw new Error("native threshold or FIRM_PRICE argument differs from accepted minimum output");
  }
  if (decodedTraits.deadline !== commitment.quote.expiry) throw new Error("native deadline differs from accepted expiry");
  assertHex(decodedTraits.commitmentId, query.commitmentId, "runtime commitment id");

  const pathEvents = events(terminalReceipt.logs, addresses.executor, executorAbi, "PathSelected");
  const tradeEvents = events(terminalReceipt.logs, addresses.executor, executorAbi, "FirmTradeExecuted");
  const swaps = events(terminalReceipt.logs, addresses.router, swapVmAbi, "Swapped");
  if (path === "EXPIRED") {
    if (pathEvents.length !== 0 || tradeEvents.length !== 0 || swaps.length !== 0) {
      throw new Error("expired settlement unexpectedly contains execution events");
    }
  } else {
    const selected = exactlyOne(pathEvents, "PathSelected");
    const trade = exactlyOne(tradeEvents, "FirmTradeExecuted");
    assertHex(selected.commitmentId, query.commitmentId, "selected commitment id");
    assertHex(trade.commitmentId, query.commitmentId, "trade commitment id");
    if (Boolean(selected.aquaPath) !== (path === "AQUA")) throw new Error("selected path differs from terminal state");
    if (BigInt(trade.status as bigint) !== expectedStatus) throw new Error("trade status differs from terminal state");
  }
  if (path === "AQUA") {
    const swap = exactlyOne(swaps, "Swapped");
    assertHex(swap.orderHash, commitment.quote.orderHash, "swap order hash");
    assertAddress(swap.maker, commitment.quote.maker, "swap maker");
    assertAddress(swap.taker, addresses.executor, "swap taker");
    assertAddress(swap.tokenIn, commitment.quote.tokenIn, "swap tokenIn");
    assertAddress(swap.tokenOut, commitment.quote.tokenOut, "swap tokenOut");
    if (BigInt(swap.amountIn as bigint) !== commitment.quote.amountIn) throw new Error("swap input differs from quote");
    if (BigInt(swap.amountOut as bigint) < commitment.quote.minAmountOut) throw new Error("swap output is below quote");
  } else if (swaps.length !== 0) {
    throw new Error(`${path} settlement unexpectedly contains a SwapVM swap`);
  }

  const unlocked = sumEventAmounts(events(terminalReceipt.logs, addresses.vault, bondVaultAbi, "BondUnlocked"));
  const consumed = sumEventAmounts(events(terminalReceipt.logs, addresses.vault, bondVaultAbi, "BondReleased"));
  const bondRemaining = BigInt(remainingLock[1]);
  if (bondRemaining !== 0n || unlocked + consumed !== bondInitiallyLocked) {
    throw new Error("terminal bond events do not reconcile to the initial lock");
  }
  if ((path === "BOND" && consumed !== commitment.quote.minAmountOut) || (path !== "BOND" && consumed !== 0n)) {
    throw new Error("bond consumption differs from terminal path");
  }

  const [acceptanceBlock, executionBlock] = await Promise.all([
    client.getBlock({ blockNumber: acceptanceReceipt.blockNumber }),
    client.getBlock({ blockNumber: terminalReceipt.blockNumber }),
  ]);
  if (acceptanceBlock.timestamp !== commitment.acceptedAt || executionBlock.timestamp !== commitment.settledAt) {
    throw new Error("commitment timestamps differ from canonical block timestamps");
  }
  const acceptanceTokenDeltas = tokenDeltas(acceptanceReceipt, commitment.quote);
  const terminalTokenDeltas = tokenDeltas(terminalReceipt, commitment.quote);
  return {
    commitmentId: query.commitmentId,
    orderHash: commitment.quote.orderHash,
    maker: commitment.quote.maker,
    taker: commitment.quote.taker,
    tokenIn: commitment.quote.tokenIn,
    tokenOut: commitment.quote.tokenOut,
    amountIn: commitment.quote.amountIn,
    minAmountOut: commitment.quote.minAmountOut,
    referenceOut: commitment.quote.referenceAmountOut,
    premium: commitment.quote.premiumAmount,
    pricingVersion: commitment.quote.pricingVersion,
    pricingTtl: commitment.quote.pricingTtl,
    acceptanceBlock: acceptanceReceipt.blockNumber,
    acceptanceTimestamp: acceptanceBlock.timestamp,
    executionBlock: terminalReceipt.blockNumber,
    executionTimestamp: executionBlock.timestamp,
    firmPrice: opcodeEvidence(FIRM_PRICE_OPCODE, path),
    firmGuard: opcodeEvidence(FIRM_GUARD_OPCODE, path),
    program: buildFirmProgram(),
    threshold: decodedTraits.threshold,
    deadline: decodedTraits.deadline,
    bondInitiallyLocked,
    bondReleased: unlocked,
    bondConsumed: consumed,
    bondRemaining,
    finalState: commitment.status,
    path,
    acceptanceTokenDeltas,
    terminalTokenDeltas,
    totalTokenDeltas: addDeltas(acceptanceTokenDeltas, terminalTokenDeltas),
    acceptanceTransactionHash: acceptanceReceipt.transactionHash,
    transactionHash: terminalReceipt.transactionHash,
  };
}

function normalizeAddresses(query: FirmReceiptAddresses): FirmReceiptAddresses {
  return {
    registry: getAddress(query.registry),
    executor: getAddress(query.executor),
    router: getAddress(query.router),
    vault: getAddress(query.vault),
  };
}

function requireSuccessful(receipt: TransactionReceipt, label: string): void {
  if (receipt.status !== "success") throw new Error(`${label} transaction reverted`);
}

function events(logs: readonly Log[], address: Address, abi: Abi, eventName: string): Record<string, unknown>[] {
  const decoded: Record<string, unknown>[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
      if (event.eventName === eventName && event.args !== undefined) {
        decoded.push(event.args as unknown as Record<string, unknown>);
      }
    } catch {
      // A receipt can contain other events from the same contract; only exact ABI matches are evidence.
    }
  }
  return decoded;
}

function exactlyOne(values: Record<string, unknown>[], name: string): Record<string, unknown> {
  if (values.length !== 1) throw new Error(`expected exactly one ${name} event, received ${values.length}`);
  return values[0]!;
}

function oneEvent(logs: readonly Log[], address: Address, abi: Abi, name: string): Record<string, unknown> {
  return exactlyOne(events(logs, address, abi, name), name);
}

function sumEventAmounts(values: Record<string, unknown>[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value.amount as bigint), 0n);
}

function opcodeEvidence(opcode: number, path: "AQUA" | "BOND" | "EXPIRED"): OpcodeEvidence {
  return path === "AQUA"
    ? { opcode, executed: true, proof: "SUCCESSFUL_BOUND_SWAP" }
    : { opcode, executed: false, proof: "PATH_SKIPPED_SWAPVM" };
}

function tokenDeltas(receipt: TransactionReceipt, quote: { maker: Address; taker: Address; tokenIn: Address; tokenOut: Address }): ParticipantTokenDeltas {
  return {
    makerTokenIn: deltaFor(receipt.logs, quote.tokenIn, quote.maker),
    makerTokenOut: deltaFor(receipt.logs, quote.tokenOut, quote.maker),
    traderTokenIn: deltaFor(receipt.logs, quote.tokenIn, quote.taker),
    traderTokenOut: deltaFor(receipt.logs, quote.tokenOut, quote.taker),
  };
}

function deltaFor(logs: readonly Log[], token: Address, account: Address): bigint {
  let delta = 0n;
  for (const transfer of events(logs, token, erc20Abi, "Transfer")) {
    if (String(transfer.from).toLowerCase() === account.toLowerCase()) delta -= BigInt(transfer.value as bigint);
    if (String(transfer.to).toLowerCase() === account.toLowerCase()) delta += BigInt(transfer.value as bigint);
  }
  return delta;
}

function addDeltas(a: ParticipantTokenDeltas, b: ParticipantTokenDeltas): ParticipantTokenDeltas {
  return {
    makerTokenIn: a.makerTokenIn + b.makerTokenIn,
    makerTokenOut: a.makerTokenOut + b.makerTokenOut,
    traderTokenIn: a.traderTokenIn + b.traderTokenIn,
    traderTokenOut: a.traderTokenOut + b.traderTokenOut,
  };
}

function assertHex(actual: unknown, expected: Hex, label: string): void {
  if (String(actual).toLowerCase() !== expected.toLowerCase()) throw new Error(`${label} mismatch`);
}

function assertAddress(actual: unknown, expected: Address, label: string): void {
  if (getAddress(String(actual)) !== getAddress(expected)) throw new Error(`${label} mismatch`);
}
