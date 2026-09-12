import type { DeploymentArtifact, FirmQuote, SwapVMOrder } from "@firmdepth/sdk/types";
import { authenticateFirmDepthDeployment } from "@firmdepth/sdk/deployment";
import type { FirmQuoteEnvelope } from "@firmdepth/sdk/quote-provider";
import { createPublicClient, defineChain, getAddress, http, isAddress, isHex, type Address, type Hex, type PublicClient } from "viem";
import { baseForkEvidence } from "../data/evidence";

export interface SerializedFirmQuote extends Omit<FirmQuote, "amountIn" | "referenceAmountOut" | "minAmountOut" | "requiredBond" | "premiumAmount" | "sigmaWad" | "annualCapitalRateWad" | "utilizationAfterWad" | "minPremiumOut" | "expiry" | "nonce"> {
  amountIn: string;
  referenceAmountOut: string;
  minAmountOut: string;
  requiredBond: string;
  premiumAmount: string;
  sigmaWad: string;
  annualCapitalRateWad: string;
  utilizationAfterWad: string;
  minPremiumOut: string;
  expiry: string;
  nonce: string;
}

export interface RuntimeStrategy {
  id: string;
  label: string;
  kind: "SOFT" | "FIRM";
  order: { maker: Address; traits: string; data: Hex };
  orderHash: Hex;
  takerTraits: Hex;
  suggestedAmountIn: string;
}

export interface FrontendRuntimeArtifact extends Omit<DeploymentArtifact, "schemaVersion"> {
  schemaVersion: "2";
  rpcUrl: string;
  deploymentBlock: number;
  environment: { kind: "base-fork" | "deployment"; label: string; controlledEvidence: boolean };
  quoteProvider: { url: string; horizons: readonly [5, 30, 120] };
  strategies: RuntimeStrategy[];
}

export interface LoadedRuntime {
  artifact: FrontendRuntimeArtifact;
  publicClient: PublicClient;
}

export function deserializeOrder(order: RuntimeStrategy["order"]): SwapVMOrder {
  return { maker: order.maker, traits: BigInt(order.traits), data: order.data };
}

export function deserializeQuote(quote: SerializedFirmQuote): FirmQuote {
  return {
    ...quote,
    amountIn: BigInt(quote.amountIn),
    referenceAmountOut: BigInt(quote.referenceAmountOut),
    minAmountOut: BigInt(quote.minAmountOut),
    requiredBond: BigInt(quote.requiredBond),
    premiumAmount: BigInt(quote.premiumAmount),
    sigmaWad: BigInt(quote.sigmaWad),
    annualCapitalRateWad: BigInt(quote.annualCapitalRateWad),
    utilizationAfterWad: BigInt(quote.utilizationAfterWad),
    minPremiumOut: BigInt(quote.minPremiumOut),
    expiry: BigInt(quote.expiry),
    nonce: BigInt(quote.nonce),
  };
}

export async function loadRuntimeArtifact(url = "/runtime/firmdepth.json"): Promise<LoadedRuntime | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Runtime artifact request failed (${response.status})`);
  if (!response.headers.get("content-type")?.includes("application/json")) return null;
  const artifact = validateRuntimeArtifact(await response.json());
  const chain = defineChain({
    id: artifact.chainId,
    name: artifact.networkName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [artifact.rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(artifact.rpcUrl) });
  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== artifact.chainId) throw new Error(`Runtime chain mismatch: artifact ${artifact.chainId}, RPC ${rpcChainId}`);
  const authenticated = await authenticateFirmDepthDeployment(publicClient, artifact.addresses);
  if (authenticated.blockNumber < BigInt(artifact.deploymentBlock)) throw new Error("RPC is behind the declared deployment block");
  if (authenticated.maxQuoteTtl !== BigInt(artifact.pricingPolicy.maxQuoteTtl)) throw new Error("Registry max quote TTL mismatch");
  return { artifact, publicClient };
}

export function validateRuntimeArtifact(input: unknown): FrontendRuntimeArtifact {
  if (!isRecord(input) || input.schemaVersion !== "2") throw new Error("Unsupported runtime artifact schema");
  if (!Number.isSafeInteger(input.chainId) || typeof input.networkName !== "string") throw new Error("Invalid runtime chain metadata");
  if (typeof input.rpcUrl !== "string" || !/^https?:\/\//.test(input.rpcUrl)) throw new Error("Invalid runtime RPC URL");
  if (!Number.isSafeInteger(input.deploymentBlock) || Number(input.deploymentBlock) < 0) throw new Error("Invalid deployment block");
  if (!isRecord(input.addresses)) throw new Error("Missing runtime addresses");
  for (const key of ["aqua", "weth", "usdc", "bondVault", "registry", "firmRouter", "executor"] as const) {
    if (!isAddress(input.addresses[key])) throw new Error(`Invalid runtime address: ${key}`);
    input.addresses[key] = getAddress(input.addresses[key] as string);
  }
  if (input.chainId === baseForkEvidence.chainId && input.forkBlock === baseForkEvidence.forkBlock) {
    for (const key of ["aqua", "weth", "usdc"] as const) {
      if (String(input.addresses[key]).toLowerCase() !== baseForkEvidence.official[key].toLowerCase()) {
        throw new Error(`Pinned Base-fork ${key} address mismatch`);
      }
    }
  }
  if (!Array.isArray(input.strategies)) throw new Error("Runtime strategies are missing");
  for (const strategy of input.strategies) validateStrategy(strategy);
  if (!isRecord(input.environment) || !["base-fork", "deployment"].includes(String(input.environment.kind)) || typeof input.environment.label !== "string" || typeof input.environment.controlledEvidence !== "boolean") throw new Error("Invalid runtime environment metadata");
  if (input.environment.kind === "base-fork" && (input.chainId !== baseForkEvidence.chainId || input.forkBlock !== baseForkEvidence.forkBlock)) throw new Error("Controlled Base fork must use the canonical pin");
  if (!isRecord(input.quoteProvider) || typeof input.quoteProvider.url !== "string" || !validEndpoint(input.quoteProvider.url)) throw new Error("Invalid Firm quote provider URL");
  if (!Array.isArray(input.quoteProvider.horizons) || input.quoteProvider.horizons.join(",") !== "5,30,120") throw new Error("Firm quote horizons must be 5, 30, and 120 seconds");
  if (!isRecord(input.opcodeConfiguration) || input.opcodeConfiguration.program !== "0x52002100") throw new Error("Firm SwapVM program mismatch");
  if (!isRecord(input.pricingPolicy) || input.pricingPolicy.version !== 2) throw new Error("Firm pricing policy mismatch");
  return input as unknown as FrontendRuntimeArtifact;
}

function validateStrategy(value: unknown): void {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string") throw new Error("Invalid runtime strategy metadata");
  if (value.kind !== "SOFT" && value.kind !== "FIRM") throw new Error("Invalid runtime strategy kind");
  if (!isHex(value.orderHash) || !isHex(value.takerTraits) || typeof value.suggestedAmountIn !== "string") throw new Error("Invalid runtime strategy encoding");
  if (!isRecord(value.order) || !isAddress(value.order.maker) || typeof value.order.traits !== "string" || !isHex(value.order.data)) throw new Error("Invalid runtime order");
}

export function deserializeQuoteEnvelope(value: unknown): FirmQuoteEnvelope {
  if (!isRecord(value) || !isRecord(value.quote) || !isHex(value.makerSignature) || typeof value.quotedAtBlock !== "string") throw new Error("Invalid Firm quote response");
  return { quote: deserializeQuote(value.quote as unknown as SerializedFirmQuote), makerSignature: value.makerSignature, quotedAtBlock: BigInt(value.quotedAtBlock) };
}

function validEndpoint(value: string): boolean {
  return value.startsWith("/") || value.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
