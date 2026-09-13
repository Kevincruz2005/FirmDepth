import { describe, expect, it } from "vitest";
import { validateMakerAmount } from "./maker-validation";

describe("maker collateral validation", () => {
  it("rejects zero and malformed USDC values", () => {
    expect(validateMakerAmount("0", 10_000_000n, "deposit").error).toBe("Amount must be greater than zero.");
    expect(validateMakerAmount("1.0000001", 10_000_000n, "deposit").value).toBeNull();
  });

  it("disables a deposit above the live wallet balance", () => {
    expect(validateMakerAmount("100", 34_500_000n, "deposit")).toMatchObject({ value: null, error: "Insufficient USDC balance" });
    expect(validateMakerAmount("34.5", 34_500_000n, "deposit")).toMatchObject({ value: 34_500_000n, error: null });
  });

  it("never treats locked Bond as withdrawable", () => {
    expect(validateMakerAmount("19", 18_000_000n, "withdraw")).toMatchObject({ value: null, error: "Withdrawal exceeds available Bond" });
    expect(validateMakerAmount("18", 18_000_000n, "withdraw")).toMatchObject({ value: 18_000_000n, error: null });
  });
});
