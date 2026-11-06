import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { authenticateFirmDepthDeployment } from "@firmdepth/sdk/deployment";
import { createPublicClient, getAddress, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createHandler } from "./app.js";
import { loadManifest } from "./manifest.js";
import { settlementQuote } from "./settlement.js";
import { createFirmQuote } from "./quote-engine.js";

const manifestPath = process.env.FIRMDEPTH_MANIFEST_PATH ?? fileURLToPath(new URL("../../../deployments/sepolia.json", import.meta.url));
const manifest = await loadManifest(manifestPath);
if (process.env.NODE_ENV === "production" && process.env.FIRMDEPTH_MANIFEST_REVISION !== manifest.manifestRevision) throw new Error("FIRMDEPTH_MANIFEST_REVISION does not match the deployed manifest");
const rpcUrl = required("SEPOLIA_RPC_URL");
const publicRpcUrl = required("PUBLIC_BROWSER_RPC_URL");
const apiUrl = new URL(required("PUBLIC_API_URL")).toString().replace(/\/$/, "");
const makerAccount = privateKeyToAccount(requiredHex("MAKER_PRIVATE_KEY"));
if (getAddress(makerAccount.address) !== manifest.maker) throw new Error("MAKER_PRIVATE_KEY does not match the public manifest");
const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 2, timeout: 10_000 }) });
const protectedAddress = process.env.FIRMDEPTH_SETTLEMENT_ADDRESS ? getAddress(process.env.FIRMDEPTH_SETTLEMENT_ADDRESS) : undefined;
const runtime = {
  ...(protectedAddress ? {settlement:{address:protectedAddress,quoteUrl:`${apiUrl}/quote/settlement`}} : {}),
  schemaVersion: "2",
  chainId: manifest.chain.id,
  networkName: manifest.chain.name,
  createdAt: manifest.deployment.deployedAt,
  rpcUrl: publicRpcUrl,
  deploymentBlock: manifest.deployment.blockNumber,
  manifestRevision: manifest.manifestRevision,
  deploymentManifest: manifest,
  explorerUrl: manifest.chain.explorerUrl,
  environment: { kind: "deployment", label: "Sepolia Testnet · Live", controlledEvidence: false },
  quoteProvider: { url: `${apiUrl}/quote/firm`, horizons: manifest.policies.horizons },
  sourceRevisions: { aqua: manifest.sourceRevisions.aqua, swapVM: manifest.sourceRevisions.swapVM, aquaSDK: manifest.sourceRevisions.aquaSDK },
  addresses: manifest.addresses,
  tokenMetadata: manifest.tokens,
  maker: manifest.maker,
  opcodeConfiguration: manifest.opcodeConfiguration,
  pricingPolicy: { version: manifest.policies.pricingVersion, maxQuoteTtl: manifest.policies.maxQuoteTtl },
  strategies: manifest.strategies.map(({ virtualBalances: _virtualBalances, ...strategy }) => strategy),
};
const corsOrigins = new Set(required("CORS_ORIGINS").split(",").map((value) => new URL(value.trim()).origin));
const tokenAbi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

const handler = createHandler({
  manifest,
  runtime,
  ...(protectedAddress ? {settlementQuote: (body:unknown) => settlementQuote(client,body,{chainId:manifest.chain.id,settlement:protectedAddress,addresses:manifest.addresses},(taker,amountIn,pricingTtl)=>{
    const strategy=manifest.strategies.find(s=>s.kind==="FIRM")!;
    return createFirmQuote(client,makerAccount,manifest,{chainId:manifest.chain.id,registry:manifest.addresses.registry,strategyId:strategy.id,orderHash:strategy.orderHash,taker,amountIn:amountIn.toString(),pricingTtl});
  })} : {}),
  corsOrigins,
  production: process.env.NODE_ENV === "production",
  async health() {
    try {
      const [chainId, authentication, block, wethSymbol, wethDecimals, usdcSymbol, usdcDecimals] = await Promise.all([
        client.getChainId(),
        authenticateFirmDepthDeployment(client, manifest.addresses),
        client.getBlock(),
        client.readContract({ address: manifest.addresses.weth, abi: tokenAbi, functionName: "symbol" }),
        client.readContract({ address: manifest.addresses.weth, abi: tokenAbi, functionName: "decimals" }),
        client.readContract({ address: manifest.addresses.usdc, abi: tokenAbi, functionName: "symbol" }),
        client.readContract({ address: manifest.addresses.usdc, abi: tokenAbi, functionName: "decimals" }),
      ]);
      const metadataOk = wethSymbol === "WETH" && wethDecimals === 18 && usdcSymbol === "USDC" && usdcDecimals === 6;
      const deploymentAuthenticated = chainId === manifest.chain.id && authentication.maxQuoteTtl === 120n && metadataOk;
      return { status: deploymentAuthenticated ? "ok" : "degraded", environment: process.env.NODE_ENV ?? "development", chainId, blockNumber: block.number, deploymentAuthenticated, maker: manifest.maker, manifestRevision: manifest.manifestRevision };
    } catch { return { status: "degraded", environment: process.env.NODE_ENV ?? "development", chainId: manifest.chain.id, deploymentAuthenticated: false, maker: manifest.maker, manifestRevision: manifest.manifestRevision }; }
  },
  quote: (request) => createFirmQuote(client, makerAccount, manifest, request),
  log: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
});

const port = integer(process.env.PORT ?? "8080");
createServer(handler).listen(port, "0.0.0.0", () => {
  process.stdout.write(`${JSON.stringify({ event: "service_started", port, chainId: manifest.chain.id, manifestRevision: manifest.manifestRevision })}\n`);
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredHex(name: string): `0x${string}` {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte hex private key`);
  return value as `0x${string}`;
}

function integer(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65535) throw new Error("PORT must be a valid TCP port");
  return parsed;
}
