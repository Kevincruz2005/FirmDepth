import { authenticateFirmDepthDeployment } from "@firmdepth/sdk/deployment";
import { validateFirmQuoteEnvelope } from "@firmdepth/sdk/quote-provider";
import { readAquaCapacity, readCommitment, readMakerBond } from "@firmdepth/sdk/readers";
import { registryAbi } from "@firmdepth/sdk/requests";
import { createPublicClient, getAddress, http, isAddress, type Hex } from "viem";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./manifest.js";

const failures: string[] = [];
const manifestPath = process.env.FIRMDEPTH_MANIFEST_PATH ?? fileURLToPath(new URL("../../../deployments/sepolia.json", import.meta.url));
const frontendUrl = required("PUBLIC_FRONTEND_URL").replace(/\/$/, "");
const apiUrl = required("PUBLIC_API_URL").replace(/\/$/, "");
const manifest = await loadManifest(manifestPath);
const readinessTakerValue = process.env.READINESS_TAKER_ADDRESS?.trim();
if (readinessTakerValue && !isAddress(readinessTakerValue)) throw new Error("READINESS_TAKER_ADDRESS is invalid");
const readinessTaker = readinessTakerValue ? getAddress(readinessTakerValue) : null;
const probeTaker = readinessTaker ?? manifest.maker;

const [frontendResponse, healthResponse, runtimeResponse] = await Promise.all([
  safeFetch(frontendUrl, "text/html"), safeFetch(`${apiUrl}/health`), safeFetch(`${apiUrl}/runtime`),
]);
if (!frontendResponse?.ok) failures.push("Vercel frontend is unavailable");
const health = await safeJson(healthResponse, "Azure /health");
const runtime = await safeJson(runtimeResponse, "Azure /runtime") as any;
if (health?.status !== "ok" || health?.deploymentAuthenticated !== true) failures.push("Azure health does not authenticate the deployment");
if (runtime?.manifestRevision !== manifest.manifestRevision) failures.push("API runtime and canonical manifest revisions differ");
if (JSON.stringify(runtime?.deploymentManifest) !== JSON.stringify(manifest)) failures.push("API runtime does not exactly embed the canonical public manifest");
if (runtime?.chainId !== 11155111 || JSON.stringify(runtime?.addresses) !== JSON.stringify(manifest.addresses)) failures.push("API runtime chain/addresses differ from the canonical manifest");
if (runtime?.quoteProvider?.url !== `${apiUrl}/quote/firm`) failures.push("API runtime quote URL is not canonical");

if (runtime?.rpcUrl) {
  const client = createPublicClient({ transport: http(runtime.rpcUrl) });
  try {
    const authentication = await authenticateFirmDepthDeployment(client, manifest.addresses);
    if (authentication.blockNumber < BigInt(manifest.deployment.blockNumber) || authentication.maxQuoteTtl !== 120n) failures.push("Sepolia deployment block/TTL authentication failed");
    for (const strategy of manifest.strategies) {
      const capacity = await readAquaCapacity(client, { aqua: manifest.addresses.aqua, router: manifest.addresses.firmRouter, maker: manifest.maker, orderHash: strategy.orderHash, tokenIn: manifest.addresses.weth, tokenOut: manifest.addresses.usdc });
      if (!capacity.strategyActive) failures.push(`${strategy.id} is inactive`);
      if (capacity.effectiveCapacity === 0n) failures.push(`${strategy.id} has no pullable depth`);
    }
    const bond = await readMakerBond(client, manifest.addresses.bondVault, manifest.maker);
    if (bond.available === 0n) failures.push("Maker has no available Bond");
    const firm = manifest.strategies.find((value) => value.kind === "FIRM")!;
    if (readinessTaker) {
      const acceptedEvents = await client.getContractEvents({
        address: manifest.addresses.registry,
        abi: registryAbi,
        eventName: "CommitmentAccepted",
        args: { taker: readinessTaker },
        fromBlock: BigInt(manifest.deployment.blockNumber),
        toBlock: "latest",
      });
      const acceptedCommitments = await Promise.all(acceptedEvents.map(async (event) => {
        const commitmentId = event.args.commitmentId;
        return commitmentId ? readCommitment(client, manifest.addresses.registry, commitmentId) : null;
      }));
      if (acceptedCommitments.some((commitment) => commitment?.status === "ACCEPTED")) failures.push("READINESS_TAKER_ADDRESS has an onchain ACCEPTED commitment");
    }
    const amountIn = BigInt(firm.suggestedAmountIn);
    const quoteResponse = await fetch(`${apiUrl}/quote/firm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: 11155111, registry: manifest.addresses.registry, strategyId: firm.id, orderHash: firm.orderHash, taker: probeTaker, amountIn: amountIn.toString(), pricingTtl: 120 }) });
    const payload = await quoteResponse.json() as any;
    if (!quoteResponse.ok) failures.push(`Signed probe quote failed (${quoteResponse.status}): ${String(payload.error ?? "unknown")}`);
    else {
      const quote = deserializeQuote(payload.quote);
      await validateFirmQuoteEnvelope(client, { quote, makerSignature: payload.makerSignature, quotedAtBlock: BigInt(payload.quotedAtBlock) }, { chainId: 11155111, registry: manifest.addresses.registry, executor: manifest.addresses.executor, router: manifest.addresses.firmRouter, tokenIn: manifest.addresses.weth, tokenOut: manifest.addresses.usdc, orderHash: firm.orderHash, order: { maker: firm.order.maker, traits: BigInt(firm.order.traits), data: firm.order.data }, maker: manifest.maker, taker: probeTaker, amountIn, pricingTtl: 120 });
      if (quote.referenceAmountOut <= 0n || quote.minAmountOut !== quote.referenceAmountOut) failures.push("120-second probe does not preserve positive live Soft reference output");
      const expectedBond = ceilDiv(quote.minAmountOut * BigInt(manifest.policies.requiredBondBps), 10_000n);
      if (quote.requiredBond !== expectedBond) failures.push("120-second probe Bond does not match the configured collateral ratio");
    }
  } catch (cause) { failures.push(`Sepolia readiness read failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
} else failures.push("API runtime does not provide a public browser RPC");

if (failures.length === 0) console.log("DEMO READY");
else {
  console.error("DEMO NOT READY");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

function deserializeQuote(value: any) {
  const bigintFields = ["amountIn", "referenceAmountOut", "minAmountOut", "requiredBond", "premiumAmount", "sigmaWad", "annualCapitalRateWad", "utilizationAfterWad", "minPremiumOut", "expiry", "nonce"];
  const result = { ...value };
  for (const field of bigintFields) result[field] = BigInt(result[field]);
  return result;
}

async function safeFetch(url: string, accept = "application/json"): Promise<Response | null> {
  try { return await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept } }); }
  catch { return null; }
}

async function safeJson(response: Response | null, label: string): Promise<any> {
  if (!response?.ok) { failures.push(`${label} is unavailable`); return null; }
  try { return await response.json(); } catch { failures.push(`${label} returned non-JSON content`); return null; }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function ceilDiv(value: bigint, denominator: bigint): bigint {
  return value === 0n ? 0n : (value - 1n) / denominator + 1n;
}
