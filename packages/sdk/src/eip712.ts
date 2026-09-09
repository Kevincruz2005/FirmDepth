import { hashTypedData, type Address, type Hex } from "viem";

import type { FirmQuote } from "./types.js";

export const FIRM_DEPTH_DOMAIN_NAME = "FirmDepth" as const;
export const FIRM_DEPTH_DOMAIN_VERSION = "1" as const;

export const firmQuoteTypes = {
  FirmQuote: [
    { name: "maker", type: "address" },
    { name: "trader", type: "address" },
    { name: "executor", type: "address" },
    { name: "orderHash", type: "bytes32" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minOut", type: "uint256" },
    { name: "premium", type: "uint256" },
    { name: "requiredBond", type: "uint256" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

export function firmQuoteTypedData(registry: Address, quote: FirmQuote) {
  return {
    domain: {
      name: FIRM_DEPTH_DOMAIN_NAME,
      version: FIRM_DEPTH_DOMAIN_VERSION,
      chainId: Number(quote.chainId),
      verifyingContract: registry,
    },
    types: firmQuoteTypes,
    primaryType: "FirmQuote" as const,
    message: quote,
  };
}

export function hashFirmQuote(registry: Address, quote: FirmQuote): Hex {
  return hashTypedData(firmQuoteTypedData(registry, quote));
}
