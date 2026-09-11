import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

import { getFirmExecutionReceipt } from "../src/receipt.js";
import { bondVaultAbi, erc20Abi, executorAbi, registryAbi, swapVmAbi } from "../src/requests.js";
import { buildFirmTakerTraits } from "../src/swapvm.js";

const registry = "0x0000000000000000000000000000000000000010";
const executor = "0x0000000000000000000000000000000000000020";
const router = "0x0000000000000000000000000000000000000030";
const vault = "0x0000000000000000000000000000000000000040";
const maker = "0x00000000000000000000000000000000000000A1";
const taker = "0x00000000000000000000000000000000000000B1";
const tokenIn = "0x00000000000000000000000000000000000000C1";
const tokenOut = "0x00000000000000000000000000000000000000D1";
const commitmentId = `0x${"aa".repeat(32)}` as const;
const orderHash = `0x${"bb".repeat(32)}` as const;
const acceptanceHash = `0x${"11".repeat(32)}` as const;
const terminalHash = `0x${"22".repeat(32)}` as const;

const quote = {
  maker,
  taker,
  executor,
  swapRouter: router,
  orderHash,
  tokenIn,
  tokenOut,
  amountIn: 250n,
  referenceAmountOut: 710n,
  minAmountOut: 700n,
  requiredBond: 750n,
  premiumToken: tokenIn,
  premiumAmount: 5n,
  pricingVersion: 2,
  sigmaWad: 0n,
  annualCapitalRateWad: 0n,
  capacityKBps: 0,
  utilizationAfterWad: 1n,
  minPremiumOut: 0n,
  pricingTtl: 30,
  expiry: 1_030n,
  nonce: 1n,
} as const;

test("decodes actual event/state evidence for every terminal Firm path", async () => {
  for (const path of ["AQUA", "BOND", "EXPIRED"] as const) {
    const status = path === "AQUA" ? 2 : path === "BOND" ? 3 : 4;
    const acceptanceLogs = [
      eventLog(registry, registryAbi, "CommitmentAccepted", {
        commitmentId, maker, taker, orderHash,
        amountIn: quote.amountIn, minAmountOut: quote.minAmountOut, premiumAmount: quote.premiumAmount,
        expiry: quote.expiry, nonce: quote.nonce, acceptedBlock: 10n,
        virtualBalance: 1_000n, realBalance: 1_000n, aquaAllowance: 1_000n,
        effectiveCapacity: 1_000n, quotedAmountOut: quote.minAmountOut,
        utilizationAfterWad: quote.utilizationAfterWad,
      }),
      eventLog(vault, bondVaultAbi, "BondLocked", { commitmentId, maker, amount: quote.requiredBond }),
      eventLog(tokenIn, erc20Abi, "Transfer", { from: taker, to: registry, value: quote.premiumAmount }),
    ];
    const terminalLogs = [
      eventLog(registry, registryAbi, "CommitmentSettled", {
        commitmentId, status, beneficiary: path === "BOND" ? taker : maker,
      }),
      ...(path === "EXPIRED" ? [] : [
        eventLog(executor, executorAbi, "PathSelected", {
          commitmentId, aquaPath: path === "AQUA", virtualBalance: 1_000n, realBalance: 1_000n,
          aquaAllowance: path === "AQUA" ? 1_000n : 0n,
          effectiveCapacity: path === "AQUA" ? 1_000n : 0n,
          requiredOutput: quote.minAmountOut,
        }),
        eventLog(executor, executorAbi, "FirmTradeExecuted", {
          commitmentId, status, trader: taker, maker, amountIn: quote.amountIn, amountOut: quote.minAmountOut,
        }),
        eventLog(tokenIn, erc20Abi, "Transfer", { from: taker, to: executor, value: quote.amountIn }),
        eventLog(tokenIn, erc20Abi, "Transfer", { from: executor, to: maker, value: quote.amountIn }),
      ]),
      ...(path === "AQUA" ? [
        eventLog(router, swapVmAbi, "Swapped", {
          orderHash, maker, taker: executor, tokenIn, tokenOut,
          amountIn: quote.amountIn, amountOut: quote.minAmountOut,
        }),
        eventLog(vault, bondVaultAbi, "BondUnlocked", { commitmentId, maker, amount: quote.requiredBond }),
        eventLog(tokenOut, erc20Abi, "Transfer", { from: maker, to: taker, value: quote.minAmountOut }),
      ] : path === "BOND" ? [
        eventLog(vault, bondVaultAbi, "BondUnlocked", { commitmentId, maker, amount: 50n }),
        eventLog(vault, bondVaultAbi, "BondReleased", { commitmentId, maker, to: taker, amount: quote.minAmountOut }),
        eventLog(tokenOut, erc20Abi, "Transfer", { from: vault, to: taker, value: quote.minAmountOut }),
      ] : [
        eventLog(vault, bondVaultAbi, "BondUnlocked", { commitmentId, maker, amount: quote.requiredBond }),
      ]),
      eventLog(tokenIn, erc20Abi, "Transfer", { from: registry, to: maker, value: quote.premiumAmount }),
    ];
    const client = fixtureClient(status, acceptanceLogs, terminalLogs);
    const decoded = await getFirmExecutionReceipt(client, {
      registry, executor, router, vault, commitmentId,
      acceptanceTransactionHash: acceptanceHash,
      terminalTransactionHash: terminalHash,
    });

    assert.equal(decoded.path, path);
    assert.equal(decoded.finalState, path === "AQUA" ? "FILLED_AQUA" : path === "BOND" ? "FILLED_BOND" : "EXPIRED");
    assert.equal(decoded.threshold, quote.minAmountOut);
    assert.equal(decoded.deadline, quote.expiry);
    assert.equal(decoded.bondConsumed, path === "BOND" ? 700n : 0n);
    assert.equal(decoded.bondReleased, path === "BOND" ? 50n : 750n);
    assert.equal(decoded.firmGuard.executed, path === "AQUA");
    assert.equal(decoded.totalTokenDeltas.traderTokenIn, path === "EXPIRED" ? -5n : -255n);
    assert.equal(decoded.totalTokenDeltas.makerTokenIn, path === "EXPIRED" ? 5n : 255n);
  }
});

test("fails closed when terminal receipt evidence is incomplete", async () => {
  const acceptanceLogs = [
    eventLog(registry, registryAbi, "CommitmentAccepted", {
      commitmentId, maker, taker, orderHash, amountIn: 250n, minAmountOut: 700n, premiumAmount: 5n,
      expiry: 1_030n, nonce: 1n, acceptedBlock: 10n, virtualBalance: 1_000n, realBalance: 1_000n,
      aquaAllowance: 1_000n, effectiveCapacity: 1_000n, quotedAmountOut: 700n, utilizationAfterWad: 1n,
    }),
    eventLog(vault, bondVaultAbi, "BondLocked", { commitmentId, maker, amount: 750n }),
  ];
  const incomplete = [
    eventLog(registry, registryAbi, "CommitmentSettled", { commitmentId, status: 2, beneficiary: maker }),
    eventLog(vault, bondVaultAbi, "BondUnlocked", { commitmentId, maker, amount: 750n }),
  ];
  await assert.rejects(
    getFirmExecutionReceipt(fixtureClient(2, acceptanceLogs, incomplete), {
      registry, executor, router, vault, commitmentId,
      acceptanceTransactionHash: acceptanceHash,
      terminalTransactionHash: terminalHash,
    }),
    /PathSelected/,
  );
});

function fixtureClient(status: number, acceptanceLogs: Log[], terminalLogs: Log[]): PublicClient {
  const runtime = buildFirmTakerTraits({
    amountOut: quote.minAmountOut, tokenIn, tokenOut, taker: executor, recipient: taker,
    deadline: quote.expiry, commitmentId,
  });
  return {
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => receipt(
      hash,
      hash === acceptanceHash ? 10n : 11n,
      hash === acceptanceHash ? acceptanceLogs : terminalLogs,
    ),
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber === 10n ? 1_000n : 1_010n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "getCommitment") {
        return { quote, status, acceptedAt: 1_000n, settledAt: 1_010n, acceptedBlock: 10n };
      }
      if (functionName === "lockedFor") return ["0x0000000000000000000000000000000000000000", 0n];
      if (functionName === "buildTakerTraits") return runtime;
      throw new Error(`unexpected read ${functionName}`);
    },
  } as unknown as PublicClient;
}

function receipt(transactionHash: Hex, blockNumber: bigint, logs: Log[]): TransactionReceipt {
  return { status: "success", transactionHash, blockNumber, logs } as unknown as TransactionReceipt;
}

function eventLog(address: Address, abi: Abi, eventName: string, args: Record<string, unknown>): Log {
  const item = getAbiItem({ abi, name: eventName });
  if (item.type !== "event") throw new Error(`${eventName} is not an event`);
  const dataInputs = item.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(
    dataInputs,
    dataInputs.map((input) => args[input.name]),
  );
  return {
    address,
    data,
    topics: encodeEventTopics({ abi, eventName, args }),
  } as unknown as Log;
}
