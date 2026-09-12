/// <reference types="vitest/config" />
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { buildFirmQuote } from "@firmdepth/sdk/quote";
import { firmQuoteTypedData } from "@firmdepth/sdk/eip712";
import { createPublicClient, createWalletClient, getAddress, http, keccak256, parseAbi, stringToHex } from "viem";

const runtimePath = resolve(process.cwd(), ".runtime/firmdepth.json");

function runtimeArtifact() {
  let quoteSequence = 0;
  return {
    name: "firmdepth-runtime-artifact",
    configureServer(server: { middlewares: { use: (path: string, handler: (request: unknown, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use("/runtime/firmdepth.json", async (_request, response, next) => {
        try {
          const body = await readFile(runtimePath, "utf8");
          response.statusCode = 200;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(body);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") next();
          else {
            response.statusCode = 500;
            response.end("Runtime artifact unavailable");
          }
        }
      });
      server.middlewares.use("/runtime/firm-quote", async (request: any, response: any) => {
        try {
          if (request.method !== "POST") return respondJson(response, 405, { error: "Method not allowed" });
          const artifact = JSON.parse(await readFile(runtimePath, "utf8"));
          if (artifact.schemaVersion !== "2" || artifact.environment?.kind !== "base-fork" || artifact.environment?.controlledEvidence !== true || artifact.forkBlock !== 51_123_118) {
            return respondJson(response, 403, { error: "Controlled quote adapter requires the canonical Base fork" });
          }
          const body = JSON.parse(await readBody(request));
          const pricingTtl = Number(body.pricingTtl);
          if (![5, 30, 120, 300].includes(pricingTtl)) return respondJson(response, 400, { error: "Unsupported Firm horizon" });
          const amountIn = BigInt(body.amountIn);
          if (amountIn <= 0n) return respondJson(response, 400, { error: "amountIn must be positive" });
          const taker = getAddress(body.taker);
          const strategy = artifact.strategies.find((value: any) => value.id === body.strategyId && value.kind === "FIRM");
          if (!strategy || strategy.orderHash.toLowerCase() !== String(body.orderHash).toLowerCase()) return respondJson(response, 400, { error: "Unknown Firm strategy" });
          const publicClient = createPublicClient({ transport: http(artifact.rpcUrl) });
          const walletClient = createWalletClient({ transport: http(artifact.rpcUrl) });
          const block = await publicClient.getBlock();
          const referenceAmountOut = amountIn * 2_000_000_000n / 10n ** 18n;
          if (referenceAmountOut <= 0n) return respondJson(response, 400, { error: "Amount is below the quoteable minimum" });
          const requiredBond = referenceAmountOut * 120n / 100n;
          const maker = getAddress(strategy.order.maker);
          const registry = getAddress(artifact.addresses.registry);
          const nonce = BigInt(keccak256(stringToHex(`${block.number}:${taker}:${amountIn}:${pricingTtl}:${quoteSequence++}`)));
          const utilizationAfterWad = await publicClient.readContract({
            address: registry,
            abi: parseAbi(["function utilizationAfter(address maker,uint256 requiredBond) view returns (uint256)"]),
            functionName: "utilizationAfter",
            args: [maker, requiredBond],
          });
          const quote = buildFirmQuote({
            maker, taker, executor: artifact.addresses.executor, swapRouter: artifact.addresses.firmRouter,
            orderHash: strategy.orderHash, tokenIn: artifact.addresses.weth, tokenOut: artifact.addresses.usdc,
            amountIn, referenceAmountOut, minAmountOut: referenceAmountOut, requiredBond,
            premiumToken: artifact.addresses.weth, sigmaWad: 800_000_000_000_000_000n,
            annualCapitalRateWad: 100_000_000_000_000_000n, capacityKBps: 10,
            utilizationAfterWad, minPremiumOut: 1n,
            expiry: block.timestamp + BigInt(pricingTtl), nonce,
          }, block.timestamp);
          const makerSignature = await walletClient.signTypedData({ account: maker, ...firmQuoteTypedData(registry, artifact.chainId, quote) });
          return respondJson(response, 200, { quote, makerSignature, quotedAtBlock: block.number });
        } catch (error) {
          return respondJson(response, 400, { error: error instanceof Error ? error.message : "Unable to create Firm quote" });
        }
      });
    },
  };
}

async function readBody(request: AsyncIterable<Uint8Array>): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += Buffer.from(chunk).toString("utf8");
    if (body.length > 16_384) throw new Error("Request body is too large");
  }
  return body;
}

function respondJson(response: any, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
}

export default defineConfig({
  plugins: [react(), runtimeArtifact()],
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "vendor-react";
      if (id.includes("node_modules/viem") || id.includes("node_modules/ox")) return "vendor-web3";
      return undefined;
    } } },
  },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], css: true, include: ["src/**/*.test.{ts,tsx}"] },
});
