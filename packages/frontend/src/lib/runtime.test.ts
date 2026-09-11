import { describe, expect, it } from "vitest";
import { validateRuntimeArtifact } from "./runtime";

const valid = {
  schemaVersion: "1",
  chainId: 8453,
  networkName: "Base fork",
  forkBlock: 51_123_118,
  createdAt: "2026-09-12T00:00:00.000Z",
  rpcUrl: "http://127.0.0.1:8545",
  deploymentBlock: 51_123_120,
  sourceRevisions: { aqua: "a", swapVM: "b", aquaSDK: "c" },
  addresses: {
    aqua: "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    bondVault: "0x0000000000000000000000000000000000000001",
    registry: "0x0000000000000000000000000000000000000002",
    firmRouter: "0x0000000000000000000000000000000000000003",
    executor: "0x0000000000000000000000000000000000000004",
  },
  opcodeConfiguration: { firmPrice: 82, firmGuard: 33, program: "0x52002100" },
  pricingPolicy: { version: 2, maxQuoteTtl: 120 },
  strategies: [{ id: "soft", label: "Soft fixture", kind: "SOFT", order: { maker: "0x0000000000000000000000000000000000000005", traits: "1", data: "0x1234" }, orderHash: `0x${"11".repeat(32)}`, takerTraits: "0xabcd", amountIn: "1", expectedAmountOut: "1" }],
};

describe("runtime artifact validation", () => {
  it("accepts a matching pinned Base-fork artifact", () => {
    expect(validateRuntimeArtifact(structuredClone(valid)).chainId).toBe(8453);
  });

  it("rejects a mismatched official contract address", () => {
    const value = structuredClone(valid);
    value.addresses.aqua = "0x0000000000000000000000000000000000000009";
    expect(() => validateRuntimeArtifact(value)).toThrow(/aqua address mismatch/i);
  });

  it("rejects a non-v2 SwapVM runtime", () => {
    const value = structuredClone(valid);
    value.opcodeConfiguration.program = "0x00";
    expect(() => validateRuntimeArtifact(value)).toThrow(/program mismatch/i);
  });
});
