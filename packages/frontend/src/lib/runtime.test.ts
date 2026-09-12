import { describe, expect, it } from "vitest";
import { quoteSecondsRemaining, runtimeEndpoint, validatePublicRuntimeMatch, validateRuntimeArtifact } from "./runtime";

const valid = {
  schemaVersion: "2",
  chainId: 8453,
  networkName: "Base fork",
  forkBlock: 51_123_118,
  createdAt: "2026-09-12T00:00:00.000Z",
  rpcUrl: "http://127.0.0.1:8545",
  deploymentBlock: 51_123_120,
  environment: { kind: "base-fork", label: "Base Fork · Block 51,123,118", controlledEvidence: true },
  quoteProvider: { url: "/runtime/firm-quote", horizons: [5, 30, 120] },
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
  strategies: [{ id: "soft", label: "Soft fixture", kind: "SOFT", order: { maker: "0x0000000000000000000000000000000000000005", traits: "1", data: "0x1234" }, orderHash: `0x${"11".repeat(32)}`, takerTraits: "0xabcd", suggestedAmountIn: "1" }],
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

  it("uses the public API runtime only when explicitly configured", () => {
    expect(runtimeEndpoint("")).toBe("/runtime/firmdepth.json");
    expect(runtimeEndpoint("https://quotes.example/api/")).toBe("https://quotes.example/api/runtime");
    expect(() => runtimeEndpoint("http://quotes.example")).toThrow(/HTTPS/);
  });

  it("marks quotes stale from a chain-anchored countdown", () => {
    expect(quoteSecondsRemaining(130n, 100n, 1_000, 6_000)).toBe(25n);
    expect(quoteSecondsRemaining(130n, 100n, 1_000, 31_000)).toBe(0n);
  });

  it("fails closed when API runtime and bundled Sepolia manifest differ", () => {
    const input = structuredClone(valid) as any;
    input.chainId = 11155111;
    input.environment = { kind: "deployment", label: "SEPOLIA TESTNET · LIVE", controlledEvidence: false };
    input.manifestRevision = `0x${"99".repeat(32)}`;
    input.maker = "0x0000000000000000000000000000000000000005";
    const artifact = validateRuntimeArtifact(input);
    const manifest = {
      status: "ready", manifestRevision: artifact.manifestRevision,
      chain: { id: 11155111 }, deployment: { blockNumber: artifact.deploymentBlock },
      addresses: structuredClone(artifact.addresses), maker: artifact.maker,
      strategies: structuredClone(artifact.strategies),
    };
    artifact.deploymentManifest = manifest;
    expect(() => validatePublicRuntimeMatch(artifact, manifest)).not.toThrow();
    manifest.addresses.registry = "0x0000000000000000000000000000000000000099";
    expect(() => validatePublicRuntimeMatch(artifact, manifest)).toThrow(/registry mismatch/);
  });
});
