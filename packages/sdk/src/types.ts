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
  trader: Address;
  executor: Address;
  orderHash: Hex;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minOut: bigint;
  premium: bigint;
  requiredBond: bigint;
  expiry: bigint;
  nonce: bigint;
  chainId: bigint;
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

export interface DeploymentArtifact {
  schemaVersion: "1";
  chainId: number;
  networkName: string;
  forkBlock?: bigint;
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
}
