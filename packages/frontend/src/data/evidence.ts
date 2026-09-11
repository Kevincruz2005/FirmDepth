export type Provenance = "LIVE" | "VERIFIED BASE-FORK RUN" | "SYNTHETIC BENCHMARK" | "ILLUSTRATIVE";

export const baseForkEvidence = {
  provenance: "VERIFIED BASE-FORK RUN" as Provenance,
  chainId: 8453,
  forkBlock: 51_123_118,
  official: {
    aqua: "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a",
    swapVm: "0x111111338c5091e8440b67b168bae16a668ac0de",
    weth: "0x4200000000000000000000000000000000000006",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  aqua: {
    commitmentId: "0x8d894f6660a415112879dafbd2755e1aefe65cc30f5aaf4e43ff49a5dd7274c5",
    acceptanceHash: "0xe4d7dc82dd6563319bd6a8cf7d186535edb2652638a4b793dd69803f41868b08",
    executionHash: "0xab5011efa55bdfba43857286ec3be0b7f99eefcc8629f844b9b2078d6bd0ee06",
    acceptanceGas: 711_459,
    executionGas: 338_703,
    outputUsdc: 200,
  },
  bond: {
    commitmentId: "0xab48b1b4974664e0be9398d73572947ede70178f1ff324e2e0c43c441c1e1598",
    acceptanceHash: "0xa99d13e0d847d5188e948b16ab1b4188e74156d20779a403ddd06ad8eda6d5f4",
    executionHash: "0x5a3958fdaa25865148d944181e472c93615f1208a947f00e53beb535f5ba2c19",
    acceptanceGas: 711_483,
    executionGas: 202_210,
    outputUsdc: 200,
  },
  sharedDrain: {
    failedSiblingStatus: 0,
    failedSiblingAtomic: true,
    effectiveCapacityAfterUsdc: 100,
  },
  vault: { liabilitiesUsdc: 800, tokenBalanceUsdc: 800, totalLockedUsdc: 0 },
} as const;

export const benchmarkEvidence = {
  provenance: "SYNTHETIC BENCHMARK" as Provenance,
  seed: 20_260_910,
  episodes: 810_000,
  configurations: 81,
  adversarial: {
    quoteFraction: 0.4,
    ttl: 120,
    sharedLiquidityRatio: 4,
    bondUtilization: 0.25,
    softAvailabilityLoss: 5_853,
    firmFilledAqua: 4_147,
    firmFilledBond: 5_853,
    firmProtectedSettlements: 10_000,
    softCapitalReuse: 0.8864750708547323,
    hardCapitalReuse: 0.668587576958235,
    firmCapitalReuse: 0.8864750708547323,
  },
} as const;

export const frontierPoints = [
  { label: "Soft Aqua", certainty: 0, lockCost: 0, reuse: 0.8865, color: "var(--muted)" },
  { label: "Hard reservation", certainty: 1, lockCost: 0.4, reuse: 0.6686, color: "var(--coral)" },
  { label: "FirmDepth", certainty: 1, lockCost: 0.4, reuse: 0.8865, color: "var(--blue)" },
] as const;
