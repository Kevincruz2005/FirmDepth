import { randomBytes } from "node:crypto";
import { authenticateFirmDepthDeployment } from "@firmdepth/sdk/deployment";
import { signFirmQuote, type FirmQuoteSigner } from "@firmdepth/sdk/eip712";
import { buildFirmQuote } from "@firmdepth/sdk/quote";
import { checkFirmEligibility, quoteSwapExactIn } from "@firmdepth/sdk/readers";
import { registryAbi } from "@firmdepth/sdk/requests";
import { buildFirmQuoteTakerTraits } from "@firmdepth/sdk/swapvm";
import type { FirmQuoteEnvelope } from "@firmdepth/sdk/quote-provider";
import { encodePacked, getAddress, isAddress, isHash, keccak256, type Account, type Hex, type PublicClient } from "viem";
import type { FirmQuoteRequestBody, ManifestStrategy, SepoliaManifest } from "./types.js";

const requestKeys = ["amountIn", "chainId", "orderHash", "pricingTtl", "registry", "strategyId", "taker"];

export function parseQuoteRequest(value: unknown, manifest: SepoliaManifest): FirmQuoteRequestBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new QuoteError(400, "Request body must be a JSON object");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== requestKeys.join(",")) throw new QuoteError(400, "Request fields do not match the Firm quote schema");
  if (input.chainId !== manifest.chain.id) throw new QuoteError(400, "Unsupported chain");
  if (typeof input.registry !== "string" || !isAddress(input.registry) || getAddress(input.registry) !== manifest.addresses.registry) throw new QuoteError(400, "Unknown Firm registry");
  if (typeof input.strategyId !== "string") throw new QuoteError(400, "Invalid strategyId");
  if (typeof input.orderHash !== "string" || !isHash(input.orderHash)) throw new QuoteError(400, "Invalid orderHash");
  const strategy = firmStrategy(manifest, input.strategyId);
  if (strategy.orderHash.toLowerCase() !== input.orderHash.toLowerCase()) throw new QuoteError(400, "Unknown Firm strategy");
  if (typeof input.taker !== "string" || !isAddress(input.taker)) throw new QuoteError(400, "Invalid taker");
  if (typeof input.amountIn !== "string" || !/^\d+$/.test(input.amountIn)) throw new QuoteError(400, "Invalid amountIn");
  const amountIn = BigInt(input.amountIn);
  if (amountIn < BigInt(manifest.policies.minimumAmountIn) || amountIn > BigInt(manifest.policies.maximumAmountIn)) throw new QuoteError(400, "amountIn is outside the configured WETH limits");
  if (![5, 30, 120].includes(Number(input.pricingTtl))) throw new QuoteError(400, "Unsupported Firm horizon");
  return {
    chainId: manifest.chain.id,
    registry: manifest.addresses.registry,
    strategyId: input.strategyId,
    orderHash: input.orderHash,
    taker: getAddress(input.taker as string),
    amountIn: input.amountIn,
    pricingTtl: input.pricingTtl as 5 | 30 | 120,
  };
}

export async function createFirmQuote(
  client: PublicClient,
  makerAccount: Account & FirmQuoteSigner,
  manifest: SepoliaManifest,
  request: FirmQuoteRequestBody,
): Promise<FirmQuoteEnvelope> {
  if (getAddress(makerAccount.address) !== manifest.maker) throw new Error("Configured signer does not match manifest maker");
  const [chainId, authenticated] = await Promise.all([
    client.getChainId(),
    authenticateFirmDepthDeployment(client, manifest.addresses),
  ]);
  if (chainId !== manifest.chain.id) throw new Error(`RPC chain mismatch: expected ${manifest.chain.id}`);
  if (authenticated.maxQuoteTtl !== 120n || authenticated.blockNumber < BigInt(manifest.deployment.blockNumber)) throw new Error("Sepolia deployment authentication failed");
  const firm = firmStrategy(manifest, request.strategyId);
  const soft = manifest.strategies.find((value) => value.kind === "SOFT")!;
  const block = await client.getBlock();
  const amountIn = BigInt(request.amountIn);
  const reference = await quoteSwapExactIn(client, manifest.addresses.firmRouter, order(soft), amountIn, soft.takerTraits);
  if (reference.amountIn !== amountIn || reference.orderHash.toLowerCase() !== soft.orderHash.toLowerCase() || reference.amountOut <= 0n) throw new QuoteError(409, "Live Soft pricing strategy returned an inconsistent quote");
  const requiredBond = ceilDiv(reference.amountOut * BigInt(manifest.policies.requiredBondBps), 10_000n);
  const nonce = await availableNonce(client, manifest, request, block.hash ?? "0x");
  const utilizationAfterWad = await client.readContract({ address: manifest.addresses.registry, abi: registryAbi, functionName: "utilizationAfter", args: [manifest.maker, requiredBond] });
  const quote = buildFirmQuote({
    maker: manifest.maker,
    taker: request.taker,
    executor: manifest.addresses.executor,
    swapRouter: manifest.addresses.firmRouter,
    orderHash: firm.orderHash,
    tokenIn: manifest.addresses.weth,
    tokenOut: manifest.addresses.usdc,
    amountIn,
    referenceAmountOut: reference.amountOut,
    minAmountOut: reference.amountOut,
    requiredBond,
    premiumToken: manifest.addresses.weth,
    sigmaWad: BigInt(manifest.policies.sigmaWad),
    annualCapitalRateWad: BigInt(manifest.policies.annualCapitalRateWad),
    capacityKBps: manifest.policies.capacityKBps,
    utilizationAfterWad,
    minPremiumOut: BigInt(manifest.policies.minPremiumOut),
    expiry: block.timestamp + BigInt(request.pricingTtl),
    nonce,
  }, block.timestamp);
  const traits = buildFirmQuoteTakerTraits({ amountOut: quote.minAmountOut, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut, deadline: quote.expiry });
  const [eligibility, currentUtilization] = await Promise.all([
    checkFirmEligibility(client, {
      aqua: manifest.addresses.aqua, router: manifest.addresses.firmRouter, vault: manifest.addresses.bondVault,
      maker: manifest.maker, orderHash: firm.orderHash, tokenIn: manifest.addresses.weth, tokenOut: manifest.addresses.usdc,
      requiredBond: quote.requiredBond, requiredOutput: quote.minAmountOut, amountIn, order: order(firm), takerTraits: traits,
    }),
    client.readContract({ address: manifest.addresses.registry, abi: registryAbi, functionName: "utilizationAfter", args: [manifest.maker, requiredBond] }),
  ]);
  if (!eligibility.eligible) throw new QuoteError(409, `Firm quote unavailable: ${eligibility.reasons.join(", ")}`);
  if (currentUtilization !== quote.utilizationAfterWad) throw new QuoteError(409, "Maker Bond utilization changed while pricing; retry");
  const nonceUsed = await client.readContract({ address: manifest.addresses.registry, abi: registryAbi, functionName: "nonceUsed", args: [manifest.maker, quote.nonce] });
  if (nonceUsed) throw new QuoteError(409, "Quote nonce became unavailable; retry");
  const makerSignature = await signFirmQuote(makerAccount, manifest.addresses.registry, manifest.chain.id, quote);
  return { quote, makerSignature, quotedAtBlock: block.number };
}

async function availableNonce(client: PublicClient, manifest: SepoliaManifest, request: FirmQuoteRequestBody, blockHash: Hex): Promise<bigint> {
  const floor = await client.readContract({ address: manifest.addresses.registry, abi: registryAbi, functionName: "minimumValidNonce", args: [manifest.maker] });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = BigInt(keccak256(encodePacked(
      ["bytes32", "address", "uint256", "uint32", "bytes32"],
      [blockHash.length === 66 ? blockHash : `0x${"00".repeat(32)}`, request.taker, BigInt(request.amountIn), request.pricingTtl, `0x${randomBytes(32).toString("hex")}`],
    )));
    const span = 2n ** 256n - floor;
    const nonce = span === 0n ? floor : floor + candidate % (span + 1n);
    if (!(await client.readContract({ address: manifest.addresses.registry, abi: registryAbi, functionName: "nonceUsed", args: [manifest.maker, nonce] }))) return nonce;
  }
  throw new QuoteError(409, "Unable to allocate an unused quote nonce");
}

function firmStrategy(manifest: SepoliaManifest, id: string): ManifestStrategy {
  const strategy = manifest.strategies.find((value) => value.id === id && value.kind === "FIRM");
  if (!strategy) throw new QuoteError(400, "Unknown Firm strategy");
  return strategy;
}

function order(strategy: ManifestStrategy) {
  return { maker: strategy.order.maker, traits: BigInt(strategy.order.traits), data: strategy.order.data };
}

function ceilDiv(value: bigint, denominator: bigint): bigint {
  return value === 0n ? 0n : (value - 1n) / denominator + 1n;
}

export class QuoteError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}
