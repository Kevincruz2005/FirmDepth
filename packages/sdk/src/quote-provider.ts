import { getAddress, type Address, type Hex, type PublicClient } from "viem";

import { verifyFirmQuote } from "./eip712.js";
import { buildFirmQuoteTakerTraits } from "./swapvm.js";
import { registryAbi, swapVmAbi } from "./requests.js";
import type { FirmQuote, SwapVMOrder } from "./types.js";

export const firmHorizons = [5, 30, 120] as const;
export type FirmHorizon = (typeof firmHorizons)[number];

export interface FirmQuoteEnvelope {
  quote: FirmQuote;
  makerSignature: Hex;
  quotedAtBlock: bigint;
}

export interface ExpectedFirmQuote {
  chainId: number;
  registry: Address;
  executor: Address;
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  orderHash: Hex;
  order: SwapVMOrder;
  maker: Address;
  taker: Address;
  amountIn: bigint;
  pricingTtl: FirmHorizon | 300;
}

/** Revalidates a maker API response against the signed fields and current frozen contracts. */
export async function validateFirmQuoteEnvelope(
  client: PublicClient,
  envelope: FirmQuoteEnvelope,
  expected: ExpectedFirmQuote,
): Promise<FirmQuoteEnvelope> {
  const quote = envelope.quote;
  const addressChecks: [string, Address, Address][] = [
    ["maker", quote.maker, expected.maker], ["taker", quote.taker, expected.taker],
    ["executor", quote.executor, expected.executor], ["swapRouter", quote.swapRouter, expected.router],
    ["tokenIn", quote.tokenIn, expected.tokenIn], ["tokenOut", quote.tokenOut, expected.tokenOut],
    ["premiumToken", quote.premiumToken, expected.tokenIn],
  ];
  for (const [name, actual, wanted] of addressChecks) {
    if (getAddress(actual) !== getAddress(wanted)) throw new Error(`Firm quote ${name} mismatch`);
  }
  if (quote.orderHash.toLowerCase() !== expected.orderHash.toLowerCase()) throw new Error("Firm quote order hash mismatch");
  if (quote.amountIn !== expected.amountIn) throw new Error("Firm quote amount mismatch");
  if (quote.pricingTtl !== expected.pricingTtl) throw new Error("Firm quote horizon mismatch");
  if (quote.pricingVersion !== 2) throw new Error("Firm quote pricing version mismatch");
  if (quote.requiredBond < quote.minAmountOut) throw new Error("Firm quote is undercollateralized");

  const block = await client.getBlock({ blockNumber: envelope.quotedAtBlock });
  const latest = await client.getBlock();
  if (quote.expiry <= latest.timestamp) throw new Error("Firm quote expired");
  if (quote.expiry < block.timestamp || quote.expiry - block.timestamp > BigInt(quote.pricingTtl)) {
    throw new Error("Firm quote expiry exceeds its signed pricing horizon");
  }
  const signatureValid = await verifyFirmQuote(client, expected.registry, expected.chainId, quote, envelope.makerSignature);
  if (!signatureValid) throw new Error("Firm quote maker signature is invalid");

  const [nonceUsed, utilizationAfter, premium, staticQuote] = await Promise.all([
    client.readContract({ address: expected.registry, abi: registryAbi, functionName: "nonceUsed", args: [quote.maker, quote.nonce] }),
    client.readContract({ address: expected.registry, abi: registryAbi, functionName: "utilizationAfter", args: [quote.maker, quote.requiredBond] }),
    client.readContract({ address: expected.registry, abi: registryAbi, functionName: "quotePremium", args: [quote] }),
    client.readContract({
      address: expected.router, abi: swapVmAbi, functionName: "quote",
      args: [expected.order, quote.amountIn, buildFirmQuoteTakerTraits({
        amountOut: quote.minAmountOut, tokenIn: quote.tokenIn, tokenOut: quote.tokenOut, deadline: quote.expiry,
      })],
    }),
  ]);
  if (nonceUsed) throw new Error("Firm quote nonce is already used");
  if (utilizationAfter !== quote.utilizationAfterWad) throw new Error("Firm quote utilization is stale");
  if (premium.premiumIn !== quote.premiumAmount) throw new Error("Firm quote premium does not match pricing v2");
  if (staticQuote[0] !== quote.amountIn || staticQuote[1] < quote.minAmountOut || staticQuote[2].toLowerCase() !== quote.orderHash.toLowerCase()) {
    throw new Error("Firm quote no longer matches SwapVM");
  }
  return envelope;
}
