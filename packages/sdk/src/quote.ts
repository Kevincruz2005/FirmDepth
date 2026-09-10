import { getAddress } from "viem";

import { calculateFirmPremium, FIRM_PRICING_VERSION } from "./pricing.js";
import type { FirmQuote } from "./types.js";

export type FirmQuoteTerms = Omit<FirmQuote, "maker" | "taker" | "executor" | "swapRouter" | "tokenIn" | "tokenOut" | "premiumToken" | "premiumAmount" | "pricingVersion"> & {
  maker: string;
  taker: string;
  executor: string;
  swapRouter: string;
  tokenIn: string;
  tokenOut: string;
  premiumToken: string;
};

export function buildFirmQuote(terms: FirmQuoteTerms, currentTimestamp: bigint): FirmQuote {
  if (terms.expiry <= currentTimestamp) throw new RangeError("Firm quote expiry must be in the future");
  const ttl = terms.expiry - currentTimestamp;
  const pricing = calculateFirmPremium({
    amountIn: terms.amountIn,
    referenceAmountOut: terms.referenceAmountOut,
    minAmountOut: terms.minAmountOut,
    requiredBond: terms.requiredBond,
    sigmaWad: terms.sigmaWad,
    annualCapitalRateWad: terms.annualCapitalRateWad,
    capacityKBps: BigInt(terms.capacityKBps),
    utilizationAfterWad: terms.utilizationAfterWad,
    minPremiumOut: terms.minPremiumOut,
    ttl,
  });

  return {
    ...terms,
    maker: getAddress(terms.maker),
    taker: getAddress(terms.taker),
    executor: getAddress(terms.executor),
    swapRouter: getAddress(terms.swapRouter),
    tokenIn: getAddress(terms.tokenIn),
    tokenOut: getAddress(terms.tokenOut),
    premiumToken: getAddress(terms.premiumToken),
    premiumAmount: pricing.premiumIn,
    pricingVersion: FIRM_PRICING_VERSION,
  };
}
