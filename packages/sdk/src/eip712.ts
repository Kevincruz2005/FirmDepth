import { hashTypedData, type Address, type Hex, type PublicClient } from "viem";

import type { FirmQuote } from "./types.js";

export const FIRM_DEPTH_DOMAIN_NAME = "FirmDepth" as const;
export const FIRM_DEPTH_DOMAIN_VERSION = "1" as const;

export const firmQuoteTypes = {
  FirmQuote: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "executor", type: "address" },
    { name: "swapRouter", type: "address" },
    { name: "orderHash", type: "bytes32" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "referenceAmountOut", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "requiredBond", type: "uint256" },
    { name: "premiumToken", type: "address" },
    { name: "premiumAmount", type: "uint256" },
    { name: "pricingVersion", type: "uint32" },
    { name: "sigmaWad", type: "uint256" },
    { name: "annualCapitalRateWad", type: "uint256" },
    { name: "capacityKBps", type: "uint16" },
    { name: "utilizationAfterWad", type: "uint256" },
    { name: "minPremiumOut", type: "uint256" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export function firmQuoteTypedData(registry: Address, chainId: number, quote: FirmQuote) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError("chainId must be a positive safe integer");
  return {
    domain: {
      name: FIRM_DEPTH_DOMAIN_NAME,
      version: FIRM_DEPTH_DOMAIN_VERSION,
      chainId,
      verifyingContract: registry,
    },
    types: firmQuoteTypes,
    primaryType: "FirmQuote" as const,
    message: quote,
  };
}

export function hashFirmQuote(registry: Address, chainId: number, quote: FirmQuote): Hex {
  return hashTypedData(firmQuoteTypedData(registry, chainId, quote));
}

export const buildFirmTypedData = firmQuoteTypedData;

export interface FirmQuoteSigner {
  signTypedData(data: ReturnType<typeof firmQuoteTypedData>): Promise<Hex>;
}

export function signFirmQuote(
  signer: FirmQuoteSigner,
  registry: Address,
  chainId: number,
  quote: FirmQuote,
): Promise<Hex> {
  return signer.signTypedData(firmQuoteTypedData(registry, chainId, quote));
}

export function verifyFirmQuote(
  client: PublicClient,
  registry: Address,
  chainId: number,
  quote: FirmQuote,
  signature: Hex,
): Promise<boolean> {
  return client.verifyTypedData({
    address: quote.maker,
    ...firmQuoteTypedData(registry, chainId, quote),
    message: { ...quote },
    signature,
    blockTag: "latest",
  });
}
