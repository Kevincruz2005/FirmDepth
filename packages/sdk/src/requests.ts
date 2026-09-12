import { parseAbi, type Address, type Hex } from "viem";

import type { FirmQuote, SwapVMOrder } from "./types.js";

export const bondVaultAbi = parseAbi([
  "event RegistrySet(address indexed registry)",
  "event Deposited(address indexed maker,uint256 amount)",
  "event Withdrawn(address indexed maker,address indexed to,uint256 amount)",
  "event BondLocked(bytes32 indexed commitmentId,address indexed maker,uint256 amount)",
  "event BondUnlocked(bytes32 indexed commitmentId,address indexed maker,uint256 amount)",
  "event BondReleased(bytes32 indexed commitmentId,address indexed maker,address indexed to,uint256 amount)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount,address to)",
  "function availableOf(address maker) view returns (uint256)",
  "function lockedOf(address maker) view returns (uint256)",
  "function lockedFor(bytes32 commitmentId) view returns (address maker,uint256 amount)",
  "function release(bytes32 commitmentId,address to,uint256 amount)",
  "function liabilities() view returns (uint256)",
  "function bondToken() view returns (address)",
  "function registry() view returns (address)",
]);

export const registryAbi = parseAbi([
  "event CommitmentAccepted(bytes32 indexed commitmentId,address indexed maker,address indexed taker,bytes32 orderHash,uint256 amountIn,uint256 minAmountOut,uint256 premiumAmount,uint64 expiry,uint256 nonce,uint64 acceptedBlock,uint256 virtualBalance,uint256 realBalance,uint256 aquaAllowance,uint256 effectiveCapacity,uint256 quotedAmountOut,uint256 utilizationAfterWad)",
  "event CommitmentSettled(bytes32 indexed commitmentId,uint8 indexed status,address indexed beneficiary)",
  "event NonceCancelled(address indexed maker,uint256 indexed nonce)",
  "event NonceFloorRaised(address indexed maker,uint256 previousMinimum,uint256 newMinimum)",
  "function accept((address maker,address taker,address executor,address swapRouter,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 referenceAmountOut,uint256 minAmountOut,uint256 requiredBond,address premiumToken,uint256 premiumAmount,uint32 pricingVersion,uint256 sigmaWad,uint256 annualCapitalRateWad,uint16 capacityKBps,uint256 utilizationAfterWad,uint256 minPremiumOut,uint32 pricingTtl,uint64 expiry,uint256 nonce) quote,(address maker,uint256 traits,bytes data) order,bytes makerSignature) returns (bytes32)",
  "function expire(bytes32 commitmentId)",
  "function cancelNonce(uint256 nonce)",
  "function raiseMinimumValidNonce(uint256 newMinimum)",
  "function quoteDigest((address maker,address taker,address executor,address swapRouter,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 referenceAmountOut,uint256 minAmountOut,uint256 requiredBond,address premiumToken,uint256 premiumAmount,uint32 pricingVersion,uint256 sigmaWad,uint256 annualCapitalRateWad,uint16 capacityKBps,uint256 utilizationAfterWad,uint256 minPremiumOut,uint32 pricingTtl,uint64 expiry,uint256 nonce) quote) view returns (bytes32)",
  "function getCommitment(bytes32 commitmentId) view returns (((address maker,address taker,address executor,address swapRouter,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 referenceAmountOut,uint256 minAmountOut,uint256 requiredBond,address premiumToken,uint256 premiumAmount,uint32 pricingVersion,uint256 sigmaWad,uint256 annualCapitalRateWad,uint16 capacityKBps,uint256 utilizationAfterWad,uint256 minPremiumOut,uint32 pricingTtl,uint64 expiry,uint256 nonce) quote,uint8 status,uint64 acceptedAt,uint64 settledAt,uint64 acceptedBlock))",
  "function nonceUsed(address maker,uint256 nonce) view returns (bool)",
  "function minimumValidNonce(address maker) view returns (uint256)",
  "function utilizationAfter(address maker,uint256 requiredBond) view returns (uint256)",
  "function quotePremium((address maker,address taker,address executor,address swapRouter,bytes32 orderHash,address tokenIn,address tokenOut,uint256 amountIn,uint256 referenceAmountOut,uint256 minAmountOut,uint256 requiredBond,address premiumToken,uint256 premiumAmount,uint32 pricingVersion,uint256 sigmaWad,uint256 annualCapitalRateWad,uint16 capacityKBps,uint256 utilizationAfterWad,uint256 minPremiumOut,uint32 pricingTtl,uint64 expiry,uint256 nonce) quote) view returns ((uint256 sqrtTimeWad,uint256 optionalityOut,uint256 bondCarryOut,uint256 capacitySurchargeOut,uint256 premiumOut,uint256 premiumIn))",
  "function maxQuoteTtl() view returns (uint64)",
  "function vault() view returns (address)",
  "function premiumToken() view returns (address)",
  "function tokenIn() view returns (address)",
  "function tokenOut() view returns (address)",
  "function executor() view returns (address)",
]);

export const executorAbi = parseAbi([
  "event PathSelected(bytes32 indexed commitmentId,bool indexed aquaPath,uint256 virtualBalance,uint256 realBalance,uint256 aquaAllowance,uint256 effectiveCapacity,uint256 requiredOutput)",
  "event FirmTradeExecuted(bytes32 indexed commitmentId,uint8 indexed status,address indexed trader,address maker,uint256 amountIn,uint256 amountOut)",
  "function execute(bytes32 commitmentId,(address maker,uint256 traits,bytes data) order) returns (uint8 terminalStatus,uint256 amountOut)",
  "function capacity(bytes32 commitmentId) view returns ((uint256 virtualBalance,uint256 realBalance,uint256 aquaAllowance,uint256 effectiveCapacity,bool strategyActive))",
  "function buildTakerTraits(bytes32 commitmentId) view returns (bytes)",
  "function registry() view returns (address)",
  "function aqua() view returns (address)",
  "function router() view returns (address)",
]);

export const erc20Abi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

// Keep browser readers independent of the Node-oriented Aqua SDK dependency.
// The state shape is pinned by the official Aqua interface used by the contracts.
export const aquaAbi = parseAbi([
  "function rawBalances(address maker,address app,bytes32 strategyHash,address token) view returns (uint248 balance,uint8 tokenCount)",
]);

export const swapVmAbi = parseAbi([
  "event Swapped(bytes32 orderHash,address maker,address taker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut)",
  "function hash((address maker,uint256 traits,bytes data) order) view returns (bytes32)",
  "function quote((address maker,uint256 traits,bytes data) order,uint256 amount,bytes takerTraitsAndData) view returns (uint256 amountIn,uint256 amountOut,bytes32 orderHash)",
  "function swap((address maker,uint256 traits,bytes data) order,uint256 amount,bytes takerTraitsAndData) payable returns (uint256 amountIn,uint256 amountOut,bytes32 orderHash)",
  "function AQUA() view returns (address)",
  "function WETH() view returns (address)",
  "function FIRM_REGISTRY() view returns (address)",
  "function BOND_VAULT() view returns (address)",
]);

export function acceptRequest(registry: Address, quote: FirmQuote, order: SwapVMOrder, makerSignature: Hex) {
  return { address: registry, abi: registryAbi, functionName: "accept", args: [quote, order, makerSignature] } as const;
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

export function cancelNonceRequest(registry: Address, nonce: bigint) {
  return { address: registry, abi: registryAbi, functionName: "cancelNonce", args: [nonce] } as const;
}

export function raiseNonceFloorRequest(registry: Address, newMinimum: bigint) {
  return { address: registry, abi: registryAbi, functionName: "raiseMinimumValidNonce", args: [newMinimum] } as const;
}

export function withdrawBondRequest(vault: Address, amount: bigint, to: Address) {
  return { address: vault, abi: bondVaultAbi, functionName: "withdraw", args: [amount, to] } as const;
}

export function firmQuoteRequest(router: Address, order: SwapVMOrder, amountIn: bigint, takerTraits: Hex) {
  return { address: router, abi: swapVmAbi, functionName: "quote", args: [order, amountIn, takerTraits] } as const;
}

export function softSwapRequest(router: Address, order: SwapVMOrder, amount: bigint, takerTraits: Hex) {
  return { address: router, abi: swapVmAbi, functionName: "swap", args: [order, amount, takerTraits] } as const;
}

export function approveTokenRequest(token: Address, spender: Address, amount: bigint) {
  return { address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] } as const;
}
