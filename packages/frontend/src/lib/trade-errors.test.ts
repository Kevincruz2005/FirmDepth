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

  it("distinguishes an expired accepted commitment from an expired quote", () => {
    expect(tradeErrorMessage(new Error("CommitmentExpired(1789282824)"))).toBe("Commitment expired — settle expiry.");
    expect(tradeErrorMessage(new Error("execution reverted: 0x4a50a71e"))).toBe("Commitment expired — settle expiry.");
  });

  it("distinguishes transient RPC/API reads from protocol failures", () => {
    expect(tradeErrorMessage(new Error("HTTP request failed: request timed out"))).toMatch(/transient connectivity failure, not a protocol failure/);
    expect(tradeErrorMessage(new Error("fetch failed: ECONNRESET"))).toMatch(/No protocol outcome was inferred/);
    expect(tradeErrorMessage(new Error("execution reverted: UnknownProtocolError"))).toBe("execution reverted: UnknownProtocolError");
  });
});
