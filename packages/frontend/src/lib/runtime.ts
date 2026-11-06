import type { DeploymentArtifact, FirmQuote, SwapVMOrder } from "@firmdepth/sdk/types";
import { authenticateSettlement } from "@firmdepth/sdk/settlement";
import { authenticateFirmDepthDeployment } from "@firmdepth/sdk/deployment";
import { readAquaCapacity } from "@firmdepth/sdk/readers";
import { erc20Abi, swapVmAbi } from "@firmdepth/sdk/requests";
import type { FirmQuoteEnvelope } from "@firmdepth/sdk/quote-provider";
import { createPublicClient, defineChain, getAddress, http, isAddress, isHash, isHex, type Address, type Hex, type PublicClient } from "viem";
import { baseForkEvidence } from "../data/evidence";
import sepoliaManifest from "../../../../deployments/sepolia.json";
import protectedSepoliaManifest from "../../../../deployments/protected-sepolia.json";
import {authenticateDebtRepayment,aaveBaseMarket} from "@firmdepth/sdk/debt-repayment";

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
  settlement?: { address: Address; quoteUrl: string; deploymentBlock?: number };
  debtRepayment?: {address:Address;pool:Address;asset:Address;variableDebtToken:Address;aToken:Address;debtMode:2;deploymentBlock:number;borrower?:Address};
  rpcUrl: string;
  deploymentBlock: number;
  manifestRevision?: Hex;
  deploymentManifest?: unknown;
  explorerUrl?: string;
  maker?: Address;
  tokenMetadata?: { weth: { symbol: string; decimals: number }; usdc: { symbol: string; decimals: number } };
  environment: { kind: "base-fork" | "deployment"; label: string; controlledEvidence: boolean; hosting?: "azure" };
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

export function quoteSecondsRemaining(expiry: bigint, chainTimestamp: bigint, observedAtMs: number, nowMs = Date.now()): bigint {
  const elapsed = BigInt(Math.max(0, Math.floor((nowMs - observedAtMs) / 1000)));
  const estimatedChainTime = chainTimestamp + elapsed;
  return expiry > estimatedChainTime ? expiry - estimatedChainTime : 0n;
}

export function runtimeEndpoint(apiUrl = import.meta.env.VITE_FIRMDEPTH_API_URL): string {
  if (!apiUrl) return "/runtime/firmdepth.json";
  const parsed = new URL(apiUrl);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))) throw new Error("Public FirmDepth API must use HTTPS");
  return `${parsed.toString().replace(/\/$/, "")}/runtime`;
}

export async function loadRuntimeArtifact(url = runtimeEndpoint()): Promise<LoadedRuntime | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Runtime artifact request failed (${response.status})`);
  if (!response.headers.get("content-type")?.includes("application/json")) return null;
  const artifact = validateRuntimeArtifact(await response.json());
  const isPublic = url !== "/runtime/firmdepth.json";
  if (isPublic) {
    validatePublicRuntimeMatch(artifact, sepoliaManifest);
    if (artifact.settlement) {
      if (getAddress(artifact.settlement.address) !== getAddress(protectedSepoliaManifest.address)) throw new Error("Public settlement differs from the bundled deployment");
      artifact.settlement.deploymentBlock = protectedSepoliaManifest.blockNumber;
    }
  }
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
  if (isPublic) await authenticatePublicRuntime(publicClient, artifact);
  if (artifact.settlement) await authenticateSettlement(publicClient, artifact.settlement.address, artifact.addresses);
  if (artifact.debtRepayment) await authenticateDebtRepayment(publicClient,artifact.debtRepayment.address,{settlement:artifact.settlement!.address,...artifact.addresses});
  return { artifact, publicClient };
}

export function validateRuntimeArtifact(input: unknown): FrontendRuntimeArtifact {
  if (!isRecord(input) || input.schemaVersion !== "2") throw new Error("Unsupported runtime artifact schema");
  if (!Number.isSafeInteger(input.chainId) || typeof input.networkName !== "string") throw new Error("Invalid runtime chain metadata");
  if (typeof input.rpcUrl !== "string" || !/^https?:\/\//.test(input.rpcUrl)) throw new Error("Invalid runtime RPC URL");
  if (!Number.isSafeInteger(input.deploymentBlock) || Number(input.deploymentBlock) < 0) throw new Error("Invalid deployment block");
  if (input.manifestRevision !== undefined && (typeof input.manifestRevision !== "string" || !isHash(input.manifestRevision))) throw new Error("Invalid runtime manifest revision");
  if (input.explorerUrl !== undefined && (typeof input.explorerUrl !== "string" || !input.explorerUrl.startsWith("https://"))) throw new Error("Invalid explorer URL");
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
  if (input.settlement !== undefined && (!isRecord(input.settlement) || !isAddress(input.settlement.address) || typeof input.settlement.quoteUrl !== "string" || !(input.settlement.quoteUrl.startsWith("/runtime/") || validEndpoint(input.settlement.quoteUrl)))) throw new Error("Invalid settlement capability");
  if (!Array.isArray(input.strategies)) throw new Error("Runtime strategies are missing");
  for (const strategy of input.strategies) validateStrategy(strategy);
  if (!isRecord(input.environment) || !["base-fork", "deployment"].includes(String(input.environment.kind)) || typeof input.environment.label !== "string" || typeof input.environment.controlledEvidence !== "boolean") throw new Error("Invalid runtime environment metadata");
  if(input.environment.hosting!==undefined&&(input.environment.hosting!=="azure"||input.environment.kind!=="base-fork"||input.environment.controlledEvidence!==true))throw new Error("Invalid hosted fork metadata");
  if(input.debtRepayment!==undefined){
    const d=input.debtRepayment;
    if(isRecord(d)&&d.borrower!==undefined&&!isAddress(d.borrower as string))throw new Error("Invalid demonstration borrower");
    if(!isRecord(d)||!["address","pool","asset","variableDebtToken","aToken"].every(key=>isAddress(d[key] as string))||!input.settlement||input.chainId!==8453||input.environment.kind!=="base-fork"||d.debtMode!==2||!Number.isSafeInteger(d.deploymentBlock)||Number(d.deploymentBlock)<Number(input.deploymentBlock))throw new Error("Invalid debt repayment deployment");
    if(getAddress(d.pool as Address)!==getAddress(aaveBaseMarket.pool)||getAddress(d.asset as Address)!==getAddress(aaveBaseMarket.asset)||getAddress(d.variableDebtToken as Address)!==getAddress(aaveBaseMarket.variableDebtToken)||getAddress(d.aToken as Address)!==getAddress(aaveBaseMarket.aToken)||getAddress(input.addresses.usdc as Address)!==getAddress(aaveBaseMarket.asset))throw new Error("Debt repayment reserve is not allowlisted");
  }
  if (input.environment.kind === "base-fork" && (input.chainId !== baseForkEvidence.chainId || input.forkBlock !== baseForkEvidence.forkBlock)) throw new Error("Controlled Base fork must use the canonical pin");
  if (!isRecord(input.quoteProvider) || typeof input.quoteProvider.url !== "string" || !validEndpoint(input.quoteProvider.url)) throw new Error("Invalid Firm quote provider URL");
  if (!Array.isArray(input.quoteProvider.horizons) || input.quoteProvider.horizons.join(",") !== "5,30,120") throw new Error("Firm quote horizons must be 5, 30, and 120 seconds");
  if (!isRecord(input.opcodeConfiguration) || input.opcodeConfiguration.program !== "0x52002100") throw new Error("Firm SwapVM program mismatch");
  if (!isRecord(input.pricingPolicy) || input.pricingPolicy.version !== 2) throw new Error("Firm pricing policy mismatch");
  return input as unknown as FrontendRuntimeArtifact;
}

export function validatePublicRuntimeMatch(artifact: FrontendRuntimeArtifact, manifestValue: unknown): void {
  if (!isRecord(manifestValue) || manifestValue.status !== "ready") throw new Error("Bundled Sepolia manifest is not deployment-ready");
  if (JSON.stringify(artifact.deploymentManifest) !== JSON.stringify(manifestValue)) throw new Error("Public API runtime does not exactly match the bundled Sepolia manifest");
  if (artifact.chainId !== 11155111 || !isRecord(manifestValue.chain) || manifestValue.chain.id !== artifact.chainId) throw new Error("Public runtime must use Sepolia chain 11155111");
  if (!isHex(manifestValue.manifestRevision) || artifact.manifestRevision !== manifestValue.manifestRevision) throw new Error("Public runtime manifest revision mismatch");
  if (!isRecord(manifestValue.deployment) || artifact.deploymentBlock !== manifestValue.deployment.blockNumber) throw new Error("Public runtime deployment block mismatch");
  if (!isRecord(manifestValue.addresses)) throw new Error("Bundled Sepolia addresses are missing");
  for (const key of ["aqua", "weth", "usdc", "bondVault", "registry", "firmRouter", "executor"] as const) {
    if (!isAddress(manifestValue.addresses[key]) || getAddress(String(manifestValue.addresses[key])) !== artifact.addresses[key]) throw new Error(`Public runtime ${key} mismatch`);
  }
  if (!isAddress(manifestValue.maker) || artifact.maker !== getAddress(String(manifestValue.maker))) throw new Error("Public runtime maker mismatch");
  if (!Array.isArray(manifestValue.strategies) || manifestValue.strategies.length !== artifact.strategies.length) throw new Error("Public runtime strategy count mismatch");
  for (const strategy of artifact.strategies) {
    const bundled = manifestValue.strategies.find((value) => isRecord(value) && value.id === strategy.id);
    if (!isRecord(bundled) || bundled.orderHash !== strategy.orderHash) throw new Error(`Public runtime strategy mismatch: ${strategy.id}`);
  }
}

async function authenticatePublicRuntime(client: PublicClient, artifact: FrontendRuntimeArtifact): Promise<void> {
  if (artifact.chainId !== 11155111 || artifact.environment.kind !== "deployment") throw new Error("Public runtime is not a Sepolia deployment");
  const [wethSymbol, wethDecimals, usdcSymbol, usdcDecimals] = await Promise.all([
    client.readContract({ address: artifact.addresses.weth, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: artifact.addresses.weth, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: artifact.addresses.usdc, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: artifact.addresses.usdc, abi: erc20Abi, functionName: "decimals" }),
  ]);
  if (wethSymbol !== "WETH" || wethDecimals !== 18 || usdcSymbol !== "USDC" || usdcDecimals !== 6) throw new Error("Public runtime token metadata mismatch");
  for (const strategy of artifact.strategies) {
    const order = deserializeOrder(strategy.order);
    const orderHash = await client.readContract({ address: artifact.addresses.firmRouter, abi: swapVmAbi, functionName: "hash", args: [order] });
    if (orderHash.toLowerCase() !== strategy.orderHash.toLowerCase()) throw new Error(`Public runtime ${strategy.id} order hash mismatch`);
    const capacity = await readAquaCapacity(client, { aqua: artifact.addresses.aqua, router: artifact.addresses.firmRouter, maker: order.maker, orderHash: strategy.orderHash, tokenIn: artifact.addresses.weth, tokenOut: artifact.addresses.usdc });
    if (!capacity.strategyActive) throw new Error(`Public runtime ${strategy.id} Aqua strategy is inactive`);
  }
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
