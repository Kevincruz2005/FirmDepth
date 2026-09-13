import manualEvidenceJson from "../../../../packages/contracts/evidence/sepolia-manual-firm.json";
import sepoliaManifestJson from "../../../../deployments/sepolia.json";

export interface SepoliaManualEvidence {
  provenance: string;
  chainId: number;
  verifiedAtBlock: number;
  commitmentId: `0x${string}`;
  acceptance: {
    transactionHash: `0x${string}`;
    blockNumber: number;
    amountIn: string;
    minAmountOut: string;
    premiumAmount: string;
    requiredBond: string;
  };
  execution: {
    transactionHash: `0x${string}`;
    blockNumber: number;
    terminalRegistryStatus: "FILLED_AQUA";
    path: "AQUA";
    sdkReceipt: {
      program: `0x${string}`;
      firmPrice: { opcode: number; executed: boolean };
      firmGuard: { opcode: number; executed: boolean };
      bondInitiallyLocked: string;
      bondReleased: string;
      bondConsumed: string;
      bondRemaining: string;
      traderTokenOut: string;
    };
  };
}

export interface SepoliaManifest {
  status: "ready";
  manifestRevision: `0x${string}`;
  chain: { id: number; name: string; explorerUrl: string };
  deployment: { blockNumber: number };
  maker: `0x${string}`;
  addresses: Record<"aqua" | "weth" | "usdc" | "bondVault" | "registry" | "firmRouter" | "executor", `0x${string}`>;
  policies: { maxQuoteTtl: number; horizons: number[]; requiredBondBps: number };
  opcodeConfiguration: { firmPrice: number; firmGuard: number; program: `0x${string}` };
}

export const sepoliaManualEvidence = manualEvidenceJson as SepoliaManualEvidence;
export const sepoliaManifest = sepoliaManifestJson as SepoliaManifest;
