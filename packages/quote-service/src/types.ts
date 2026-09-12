import type { Address, Hex } from "viem";

export interface ManifestStrategy {
  id: string;
  label: string;
  kind: "SOFT" | "FIRM";
  order: { maker: Address; traits: string; data: Hex };
  orderHash: Hex;
  takerTraits: Hex;
  suggestedAmountIn: string;
  virtualBalances: { weth: string; usdc: string };
}

export interface SepoliaManifest {
  schemaVersion: "1";
  status: "ready";
  manifestRevision: Hex;
  chain: { id: 11155111; name: string; explorerUrl: string };
  deployment: { blockNumber: number; deployedAt: string };
  addresses: {
    aqua: Address; weth: Address; usdc: Address; bondVault: Address;
    registry: Address; firmRouter: Address; executor: Address;
  };
  tokens: {
    weth: { symbol: "WETH"; decimals: 18; provenance: string };
    usdc: { symbol: "USDC"; decimals: 6; provenance: string };
  };
  maker: Address;
  policies: {
    pricingVersion: 2;
    maxQuoteTtl: 120;
    horizons: [5, 30, 120];
    minimumAmountIn: string;
    maximumAmountIn: string;
    requiredBondBps: 12000;
    sigmaWad: string;
    annualCapitalRateWad: string;
    capacityKBps: number;
    minPremiumOut: string;
  };
  opcodeConfiguration: { firmPrice: 82; firmGuard: 33; program: "0x52002100" };
  strategies: ManifestStrategy[];
  sourceRevisions: { firmDepth: string; aqua: string; swapVM: string; aquaSDK: string };
  transactions: { deployment: Hex[]; setup: Hex[] };
}

export interface FirmQuoteRequestBody {
  chainId: number;
  registry: Address;
  strategyId: string;
  orderHash: Hex;
  taker: Address;
  amountIn: string;
  pricingTtl: 5 | 30 | 120;
}
