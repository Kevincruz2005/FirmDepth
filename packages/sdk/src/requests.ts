import { parseAbi, type Address, type Hex } from "viem";

import type { FirmQuote, SwapVMOrder } from "./types.js";

export const bondVaultAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount,address to)",
  "function availableOf(address maker) view returns (uint256)",
  "function lockedOf(address maker) view returns (uint256)",
]);

export const registryAbi = parseAbi([
  "event CommitmentAccepted(bytes32 indexed commitmentId,address indexed maker,address indexed trader,bytes32 orderHash,uint256 amountIn,uint256 minOut,uint256 premium,uint64 expiry,uint256 nonce)",
  "event CommitmentSettled(bytes32 indexed commitmentId,uint8 indexed status,address indexed beneficiary)",
  "function accept((address maker,address trader,address executor,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,uint256 premium,uint256 requiredBond,uint64 expiry,uint256 nonce,uint256 chainId) quote,bytes makerSignature) returns (bytes32)",
  "function expire(bytes32 commitmentId)",
  "function cancelNonce(uint256 nonce)",
  "function raiseMinimumValidNonce(uint256 newMinimum)",
  "function quoteDigest((address maker,address trader,address executor,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,uint256 premium,uint256 requiredBond,uint64 expiry,uint256 nonce,uint256 chainId) quote) view returns (bytes32)",
]);

export const executorAbi = parseAbi([
  "event PathSelected(bytes32 indexed commitmentId,bool indexed aquaPath,uint256 virtualBalance,uint256 realBalance,uint256 aquaAllowance,uint256 effectiveCapacity,uint256 requiredOutput)",
  "event FirmTradeExecuted(bytes32 indexed commitmentId,uint8 indexed status,address indexed trader,address maker,uint256 amountIn,uint256 amountOut)",
  "function execute(bytes32 commitmentId,(address maker,uint256 traits,bytes data) order) returns (uint8 terminalStatus,uint256 amountOut)",
  "function capacity(bytes32 commitmentId) view returns ((uint256 virtualBalance,uint256 realBalance,uint256 aquaAllowance,uint256 effectiveCapacity,bool strategyActive))",
]);

export function acceptRequest(registry: Address, quote: FirmQuote, makerSignature: Hex) {
  return { address: registry, abi: registryAbi, functionName: "accept", args: [quote, makerSignature] } as const;
}

export function executeRequest(executor: Address, commitmentId: Hex, order: SwapVMOrder) {
  return { address: executor, abi: executorAbi, functionName: "execute", args: [commitmentId, order] } as const;
}

export function depositBondRequest(vault: Address, amount: bigint) {
  return { address: vault, abi: bondVaultAbi, functionName: "deposit", args: [amount] } as const;
}

export function expireRequest(registry: Address, commitmentId: Hex) {
  return { address: registry, abi: registryAbi, functionName: "expire", args: [commitmentId] } as const;
}
