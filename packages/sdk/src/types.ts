import type { Address, Hex } from "viem";

export const commitmentStatuses = [
  "NONE",
  "ACCEPTED",
  "FILLED_AQUA",
  "FILLED_BOND",
  "EXPIRED",
] as const;

export type CommitmentStatus = (typeof commitmentStatuses)[number];

export interface FirmQuote {
  maker: Address;
  taker: Address;
  executor: Address;
  swapRouter: Address;
  orderHash: Hex;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  referenceAmountOut: bigint;
  minAmountOut: bigint;
  requiredBond: bigint;
  premiumToken: Address;
  premiumAmount: bigint;
  pricingVersion: number;
  sigmaWad: bigint;
  annualCapitalRateWad: bigint;
  capacityKBps: number;
  utilizationAfterWad: bigint;
  minPremiumOut: bigint;
  pricingTtl: number;
  expiry: bigint;
  nonce: bigint;
}

export interface SwapVMOrder {
  maker: Address;
  traits: bigint;
  data: Hex;
}

export interface Capacity {
  virtualBalance: bigint;
  realBalance: bigint;
  aquaAllowance: bigint;
  effectiveCapacity: bigint;
  strategyActive: boolean;
}

export interface Commitment {
  quote: FirmQuote;
  status: CommitmentStatus;
  acceptedAt: bigint;
  settledAt: bigint;
  acceptedBlock: bigint;
}

export interface MakerBondState {
  available: bigint;
  locked: bigint;
  total: bigint;
}

export interface FirmDepthSnapshot {
  capacity: Capacity;
  makerBond: MakerBondState;
  commitment: Commitment;
  blockNumber: bigint;
}

export interface DeploymentArtifact {
  schemaVersion: "1";
  chainId: number;
  networkName: string;
  forkBlock?: number;
  createdAt: string;
  sourceRevisions: {
    aqua: string;
    swapVM: string;
    aquaSDK: string;
  };
  addresses: {
    aqua: Address;
    weth: Address;
    usdc: Address;
    bondVault: Address;
    registry: Address;
    firmRouter: Address;
    executor: Address;
  };
  opcodeConfiguration: {
    firmPrice: number;
    firmGuard: number;
    program: Hex;
  };
  pricingPolicy: {
    version: 2;
    maxQuoteTtl: number;
  };
}
