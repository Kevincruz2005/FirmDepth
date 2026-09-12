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
    commitmentId: "0x58de793a47e8172f4d0405598643e89d64ee0fe79210d5a183768a2d70362052",
    acceptanceHash: "0x1a5b19924fa3b2d08a85f6286738708bf0efd80cd44b6880a20ca40cec07152a",
    executionHash: "0x1d41daf479f5bebee505c96ef82c5c7bf5f86ead8bf5665441cc2be771ce8d8b",
    acceptanceGas: 711_483,
    executionGas: 338_703,
    outputUsdc: 200,
  },
  bond: {
    commitmentId: "0x65cd3c01b02754e9e845bc18740a23e9b7b121c58e66264d75e5e0c39840dc8e",
    acceptanceHash: "0x4a6c5204d452d233c4f3fb98dd78a76ae80f5667fa82e2e3102e0b27cae991f5",
    executionHash: "0x944b8590fd0efa1b4d68ee726ba2f42f06ffd3963a38f811d3beddd648f12797",
    acceptanceGas: 711_483,
    executionGas: 214_862,
    outputUsdc: 200,
  },
  sharedDrain: {
    failedSiblingStatus: 0,
    failedSiblingAtomic: true,
    effectiveCapacityAfterUsdc: 100,
    swapHash: "0x8192b4dd20e3e0aa232c4af38ba8fc9cfdc15d7bfd054a559b931746eaf53ac5",
    failedSoftHash: "0x0cf25b36f4ac2c175538c7b09b666fff7f96004fc1c53e9c1fe749a467a3eb57",
  },
  expired: {
    commitmentId: "0xbc091028a657f779460485a4872c60ee3a660836a37eb928ab9b31df120e8b3f",
    acceptanceHash: "0x6030d2a12c4db8936410e0f795e9f60e0362626e091ca77086c7c3beab3a76d3",
    terminalHash: "0xac0af7e7ee4628df6562b631fe9273a030d359ba4d31d2df3a048871524ea6a9",
    bondBeforeUsdc: 200, bondAfterUsdc: 0, principalOutputUsdc: 0, premiumWeth: "0.00005",
  },
  unrelatedFailure: {
    commitmentId: "0x3e4cf9f6dc4b9f054c157ffa396b47615c18d59f55ec79f4042ce88ff1dcfe11",
    acceptanceHash: "0xcb5395737ba77819fa04019e880cf493a93a8b6ac1bc718ea36fab264fe94c0f",
    revertedHash: "0x7653fc252673d96777f3bbf6a4a0b12386373e396263bf753d8e60b915983379",
    statusAfter: "ACCEPTED", bondBeforeUsdc: 200, bondAfterUsdc: 200,
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
