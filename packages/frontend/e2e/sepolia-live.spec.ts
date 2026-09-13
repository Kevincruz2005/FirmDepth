import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { authenticateFirmDepthDeployment } from "@firmdepth/sdk/deployment";
import { validateFirmQuoteEnvelope } from "@firmdepth/sdk/quote-provider";
import { getLiquidityReality, quoteSwapExactIn, readMakerBond } from "@firmdepth/sdk/readers";
import { getFirmExecutionReceipt } from "@firmdepth/sdk/receipt";
import { createPublicClient, http } from "viem";

interface Manifest {
  chain: { id: number };
  deployment: { blockNumber: number };
  manifestRevision: `0x${string}`;
  maker: `0x${string}`;
  addresses: Record<"aqua" | "weth" | "usdc" | "bondVault" | "registry" | "firmRouter" | "executor", `0x${string}`>;
  policies: { maxQuoteTtl: number; requiredBondBps: number };
  strategies: Array<{ id: string; kind: "SOFT" | "FIRM"; orderHash: `0x${string}`; suggestedAmountIn: string; takerTraits: `0x${string}`; order: { maker: `0x${string}`; traits: string; data: `0x${string}` } }>;
}

test.describe("read-only live Sepolia smoke", () => {
  test.skip(process.env.FIRMDEPTH_SEPOLIA_LIVE_E2E !== "1", "Run through scripts/test_frontend_sepolia_live.sh");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  test("authenticates the runtime, liquidity, Soft quote, Bond, and maker-signed 120s Firm quote", async ({ request }) => {
    const manifest = readManifest();
    const [healthResponse, runtimeResponse] = await Promise.all([
      request.get("http://127.0.0.1:8080/health"),
      request.get("http://127.0.0.1:8080/runtime"),
    ]);
    expect(healthResponse.ok()).toBe(true);
    const health = await healthResponse.json() as { status: string; deploymentAuthenticated: boolean; manifestRevision: string };
    expect(health).toMatchObject({ status: "ok", deploymentAuthenticated: true, manifestRevision: manifest.manifestRevision });
    expect(runtimeResponse.ok()).toBe(true);
    const runtime = await runtimeResponse.json() as { chainId: number; rpcUrl: string; manifestRevision: string; deploymentManifest: unknown; quoteProvider: { url: string; horizons: number[] } };
    expect(runtime.chainId).toBe(11155111);
    expect(runtime.manifestRevision).toBe(manifest.manifestRevision);
    expect(runtime.deploymentManifest).toEqual(manifest);
    expect(runtime.quoteProvider.horizons).toEqual([5, 30, 120]);

    const client = createPublicClient({ transport: http(runtime.rpcUrl, { timeout: 20_000, retryCount: 2 }) });
    const authenticated = await authenticateFirmDepthDeployment(client, manifest.addresses);
    expect(authenticated.blockNumber).toBeGreaterThanOrEqual(BigInt(manifest.deployment.blockNumber));
    expect(authenticated.maxQuoteTtl).toBe(BigInt(manifest.policies.maxQuoteTtl));
    const soft = manifest.strategies.find((strategy) => strategy.kind === "SOFT")!;
    const firm = manifest.strategies.find((strategy) => strategy.kind === "FIRM")!;
    const base = { aqua: manifest.addresses.aqua, router: manifest.addresses.firmRouter, maker: manifest.maker, tokenIn: manifest.addresses.weth, tokenOut: manifest.addresses.usdc };
    const [softLiquidity, firmLiquidity, softQuote, bond] = await Promise.all([
      getLiquidityReality(client, { ...base, orderHash: soft.orderHash }),
      getLiquidityReality(client, { ...base, orderHash: firm.orderHash }),
      quoteSwapExactIn(client, manifest.addresses.firmRouter, deserializeOrder(soft.order), BigInt(soft.suggestedAmountIn), soft.takerTraits),
      readMakerBond(client, manifest.addresses.bondVault, manifest.maker),
    ]);
    expect(softLiquidity.strategyActive).toBe(true);
    expect(softLiquidity.pullableDepth).toBeGreaterThan(0n);
    expect(firmLiquidity.strategyActive).toBe(true);
    expect(firmLiquidity.pullableDepth).toBeGreaterThan(0n);
    expect(softQuote.amountOut).toBeGreaterThan(0n);
    expect(bond.available).toBeGreaterThan(0n);
    expect(bond.locked).toBe(0n);

    const quoteResponse = await request.post(runtime.quoteProvider.url, { data: { chainId: manifest.chain.id, registry: manifest.addresses.registry, strategyId: firm.id, orderHash: firm.orderHash, taker: manifest.maker, amountIn: firm.suggestedAmountIn, pricingTtl: 120 } });
    expect(quoteResponse.ok()).toBe(true);
    const payload = await quoteResponse.json() as any;
    const quote = deserializeQuote(payload.quote);
    await validateFirmQuoteEnvelope(client, { quote, makerSignature: payload.makerSignature, quotedAtBlock: BigInt(payload.quotedAtBlock) }, {
      chainId: manifest.chain.id, registry: manifest.addresses.registry, executor: manifest.addresses.executor, router: manifest.addresses.firmRouter,
      tokenIn: manifest.addresses.weth, tokenOut: manifest.addresses.usdc, orderHash: firm.orderHash, order: deserializeOrder(firm.order), maker: manifest.maker,
      taker: manifest.maker, amountIn: BigInt(firm.suggestedAmountIn), pricingTtl: 120,
    });
    expect(quote.referenceAmountOut).toBe(softQuote.amountOut);
    expect(quote.minAmountOut).toBeGreaterThan(0n);
    expect(quote.requiredBond).toBe(ceilDiv(quote.minAmountOut * BigInt(manifest.policies.requiredBondBps), 10_000n));

    const evidence = readManualEvidence();
    const reconstructed = await getFirmExecutionReceipt(client, {
      registry: manifest.addresses.registry,
      executor: manifest.addresses.executor,
      router: manifest.addresses.firmRouter,
      vault: manifest.addresses.bondVault,
      commitmentId: evidence.commitmentId,
      acceptanceTransactionHash: evidence.acceptance.transactionHash,
      terminalTransactionHash: evidence.execution.transactionHash,
    });
    expect(reconstructed.finalState).toBe("FILLED_AQUA");
    expect(reconstructed.path).toBe("AQUA");
    expect(reconstructed.acceptanceBlock).toBe(BigInt(evidence.acceptance.blockNumber));
    expect(reconstructed.executionBlock).toBe(BigInt(evidence.execution.blockNumber));
    expect(reconstructed.totalTokenDeltas.traderTokenIn).toBe(-1_000_650_400_000_000n);
    expect(reconstructed.totalTokenDeltas.traderTokenOut).toBe(2_500_000n);
    expect(reconstructed.bondInitiallyLocked).toBe(3_000_000n);
    expect(reconstructed.bondReleased).toBe(3_000_000n);
    expect(reconstructed.bondConsumed).toBe(0n);
    expect(reconstructed.bondRemaining).toBe(0n);
    expect(reconstructed.firmPrice).toMatchObject({ opcode: 82, executed: true });
    expect(reconstructed.firmGuard).toMatchObject({ opcode: 33, executed: true });
  });

  test("renders live Sepolia routes, depletion-safe Soft data, and disconnected-wallet UX", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /The quote is soft/ })).toBeVisible();
    await page.goto("/trade");
    await expect(page.locator(".truth-tag").getByText("SEPOLIA TESTNET · LIVE", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "120s" })).toHaveAttribute("aria-pressed", "true");
    for (const horizon of [5, 30, 120]) await expect(page.getByRole("button", { name: `${horizon}s` })).toBeEnabled();
    await page.getByRole("tab", { name: "Soft" }).click();
    await expect(page.getByText(/SwapVM quote · block/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".inspector-metrics .metric").filter({ hasText: "Pullable depth" })).toContainText(/5(?:\.00)? USDC/);
    await expect(page.getByLabel("WETH amount")).toHaveValue("0.001");
    await page.reload();
    await expect(page.locator(".truth-tag").getByText("SEPOLIA TESTNET · LIVE", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.goto("/maker");
    await expect(page.getByText("Observed on Sepolia")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".maker-metrics .metric").filter({ hasText: "Available bond" })).toContainText(/18(?:\.00)? USDC/);
    await expect(page.locator(".maker-metrics .metric").filter({ hasText: "Locked bond" })).toContainText(/0(?:\.00)? USDC/);
    await page.goto("/evidence");
    await expect(page.getByRole("heading", { name: /Don’t trust the status badge/ })).toBeVisible();
    await page.reload();
    const liveEvidence = page.locator(".live-evidence");
    await expect(liveEvidence.getByText("FILLED_AQUA", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(liveEvidence.getByText("2.5 USDC", { exact: true }).first()).toBeVisible();
    await expect(liveEvidence.getByText("AQUA terminal path", { exact: true }).first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test("keeps the live trade surface usable at a mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/trade");
    await expect(page.locator(".truth-tag").getByText("SEPOLIA TESTNET · LIVE", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

function readManifest(): Manifest {
  return JSON.parse(readFileSync(resolve(process.cwd(), "../../deployments/sepolia.json"), "utf8")) as Manifest;
}

function readManualEvidence() {
  return JSON.parse(readFileSync(resolve(process.cwd(), "../contracts/evidence/sepolia-manual-firm.json"), "utf8")) as {
    commitmentId: `0x${string}`;
    acceptance: { transactionHash: `0x${string}`; blockNumber: number };
    execution: { transactionHash: `0x${string}`; blockNumber: number };
  };
}

function deserializeOrder(order: Manifest["strategies"][number]["order"]) {
  return { maker: order.maker, traits: BigInt(order.traits), data: order.data };
}

function deserializeQuote(value: any) {
  const result = { ...value };
  for (const field of ["amountIn", "referenceAmountOut", "minAmountOut", "requiredBond", "premiumAmount", "sigmaWad", "annualCapitalRateWad", "utilizationAfterWad", "minPremiumOut", "expiry", "nonce"]) result[field] = BigInt(result[field]);
  return result;
}

function ceilDiv(value: bigint, denominator: bigint): bigint {
  return value === 0n ? 0n : (value - 1n) / denominator + 1n;
}
