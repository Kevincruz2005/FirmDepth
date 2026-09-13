import { describe, expect, it } from "vitest";
import { tradeErrorMessage } from "./trade-errors";

describe("trade error messages", () => {
  it("identifies Soft depletion from the service, decoded error, or raw selector", () => {
    expect(tradeErrorMessage(new Error("Soft reference liquidity is depleted; reseed the Soft strategy"))).toMatch(/Soft reference strategy is depleted/);
    expect(tradeErrorMessage(new Error("TakerTraitsAmountOutMustBeGreaterThanZero(0)"))).toMatch(/Soft reference strategy is depleted/);
    expect(tradeErrorMessage(new Error("execution reverted: 0xf6ab88ca"))).toMatch(/Soft reference strategy is depleted/);
  });

  it("identifies an expired Firm quote by name or selector", () => {
    expect(tradeErrorMessage(new Error("QuoteExpired(1789264350)"))).toMatch(/Firm quote expired/);
    expect(tradeErrorMessage(new Error("execution reverted: 0x1f99570c"))).toMatch(/Firm quote expired/);
  });
});
