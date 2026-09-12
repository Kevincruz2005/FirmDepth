import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { bondVaultAbi, registryAbi } from "@firmdepth/sdk/requests";

interface RuntimeFixture {
  rpcUrl: string;
  accounts: { maker: string; trader: string; drainer: string };
  deploymentBlock: number;
  addresses: { executor: `0x${string}`; registry: `0x${string}`; bondVault: `0x${string}` };
}

test.describe("real pinned Base-fork UI", () => {
  test.skip(process.env.FIRMDEPTH_LIVE_E2E !== "1", "Run through scripts/test_frontend_base_fork.sh");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  let pristineSnapshot: unknown;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    seedFork();
    pristineSnapshot = await rpc("http://127.0.0.1:8545", "evm_snapshot", []);
  });
  test.beforeEach(async () => {
    if (pristineSnapshot !== undefined) {
      const restored = await rpc("http://127.0.0.1:8545", "evm_revert", [pristineSnapshot]);
      if (restored !== true) throw new Error("Unable to restore pristine Base-fork fixture");
      pristineSnapshot = await rpc("http://127.0.0.1:8545", "evm_snapshot", []);
    }
  });

  test("prices all production horizons through actual signed quote responses", async ({ page }) => {
    const fixture = runtimeFixture();
    await installRpcWallet(page, fixture.rpcUrl, fixture.accounts.trader);
    await page.goto("/trade");
    const premiums: string[] = [];
    for (const horizon of [5, 30, 120]) {
      await page.getByRole("button", { name: `${horizon}s` }).click();
      await expect(page.getByText(`Pricing v2 · signed TTL ${horizon}s`)).toBeVisible({ timeout: 30_000 });
      premiums.push(await page.locator(".premium-row strong").innerText());
    }
    expect(new Set(premiums).size).toBe(3);
  });

  test("reads eligibility, accepts, executes through Aqua, and decodes the receipt", async ({ page }) => {
    const fixture = runtimeFixture();
    await installRpcWallet(page, fixture.rpcUrl, fixture.accounts.trader);
    await page.goto("/trade");
    await acceptFirmInUi(page);
    await page.reload();
    await expect(page.getByText("Commitment accepted · restored from chain")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Execute accepted commitment" })).toBeEnabled();
    await page.getByRole("button", { name: "Execute accepted commitment" }).click();
    await expect(page.getByText(/FILLED_AQUA · receipt reconstructed from chain/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("AQUA", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(/FILLED_AQUA · receipt reconstructed from chain/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("AQUA", { exact: true })).toBeVisible();
    await page.goto("/evidence");
    await expect(page.locator(".live-evidence").getByText("FILLED_AQUA", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".live-evidence").getByText("Amount received")).toBeVisible();
  });

  test("settles from the locked Bond after a real sibling Soft drain", async ({ page, context }) => {
    const fixture = runtimeFixture();
    await installRpcWallet(page, fixture.rpcUrl, fixture.accounts.trader);
    await page.goto("/trade");
    await acceptFirmInUi(page);

    const drainerPage = await context.newPage();
    await installRpcWallet(drainerPage, fixture.rpcUrl, fixture.accounts.drainer);
    await drainerPage.goto("/trade");
    await drainerPage.getByRole("tab", { name: "Soft" }).click();
    await expect(drainerPage.getByText("Strategy live")).toBeVisible();
    const drainerConnect = drainerPage.getByRole("button", { name: "Connect wallet" });
    if (await drainerConnect.isVisible()) await drainerConnect.click();
    await drainerPage.getByLabel("WETH amount").fill("1");
    await expect(drainerPage.getByText(/SwapVM quote · block/)).toBeVisible();
    await drainerPage.getByRole("button", { name: "Execute Soft swap" }).click();
    await expect(drainerPage.getByText(/Soft execution confirmed/)).toBeVisible({ timeout: 30_000 });
    await drainerPage.close();

    await page.getByRole("button", { name: "Refresh depth" }).click();
    await expect(page.getByText("Not Firm-eligible")).toBeVisible();
    await expect(page.getByRole("button", { name: "Execute accepted commitment" })).toBeEnabled();
    await page.getByRole("button", { name: "Execute accepted commitment" }).click();
    await expect(page.getByText(/FILLED_BOND · receipt reconstructed from chain/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("BOND", { exact: true })).toBeVisible();
    await page.goto("/evidence");
    await expect(page.locator(".live-evidence").getByText("FILLED_BOND", { exact: true }).first()).toBeVisible();
  });

  test("expires naturally and unlocks the commitment bond", async ({ page }) => {
    const fixture = runtimeFixture();
    await installRpcWallet(page, fixture.rpcUrl, fixture.accounts.trader);
    await page.goto("/trade");
    await acceptFirmInUi(page);
    await rpc(fixture.rpcUrl, "evm_increaseTime", [301]);
    await rpc(fixture.rpcUrl, "evm_mine", []);
    await page.getByRole("button", { name: "Execute accepted commitment" }).click();
    await expect(page.locator(".action-state.error")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Settle if expired" }).click();
    await expect(page.getByText(/EXPIRED · receipt reconstructed from chain/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "EXPIRED", exact: true })).toBeVisible();
    await page.goto("/evidence");
    await expect(page.locator(".live-evidence").getByText("EXPIRED", { exact: true }).first()).toBeVisible();
  });

  test("keeps accepted state and bond intact on an unrelated executor revert", async ({ page }) => {
    const fixture = runtimeFixture();
    await installRpcWallet(page, fixture.rpcUrl, fixture.accounts.trader);
    await page.goto("/trade");
    await acceptFirmInUi(page);
    const client = createPublicClient({ transport: http(fixture.rpcUrl) });
    const events = await client.getContractEvents({ address: fixture.addresses.registry, abi: registryAbi, eventName: "CommitmentAccepted", fromBlock: BigInt(fixture.deploymentBlock) });
    const commitmentId = events.at(-1)?.args.commitmentId;
    if (!commitmentId) throw new Error("Acceptance event did not expose a commitment ID");
    const before = await client.readContract({ address: fixture.addresses.bondVault, abi: bondVaultAbi, functionName: "lockedFor", args: [commitmentId] });
    const executorCode = await rpc(fixture.rpcUrl, "eth_getCode", [fixture.addresses.executor, "latest"]);
    await rpc(fixture.rpcUrl, "hardhat_setCode", [fixture.addresses.executor, "0x60006000fd"]);
    await page.getByRole("button", { name: "Execute accepted commitment" }).click();
    await expect(page.locator(".action-state.error")).toBeVisible({ timeout: 30_000 });
    const [after, commitment] = await Promise.all([
      client.readContract({ address: fixture.addresses.bondVault, abi: bondVaultAbi, functionName: "lockedFor", args: [commitmentId] }),
      client.readContract({ address: fixture.addresses.registry, abi: registryAbi, functionName: "getCommitment", args: [commitmentId] }),
    ]);
    expect(after[1]).toBe(before[1]);
    expect(Number(commitment.status)).toBe(1);
    await rpc(fixture.rpcUrl, "hardhat_setCode", [fixture.addresses.executor, executorCode]);
    await page.goto("/evidence");
    await expect(page.locator(".live-evidence").getByText("ACCEPTED", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".live-evidence").getByText(`Bond currently locked: ${before[1]} raw USDC units`)).toBeVisible();
  });

  test("reads and mutates real maker bond state", async ({ page }) => {
    const fixture = runtimeFixture();
    await installRpcWallet(page, fixture.rpcUrl, fixture.accounts.maker);
    await page.goto("/maker");
    await expect(page.getByText("Base Fork · Block 51,123,118")).toBeVisible();
    const totalBond = page.locator(".metric").filter({ hasText: "Total bond" });
    const availableBond = page.locator(".metric").filter({ hasText: "Available bond" });
    const lockedBond = page.locator(".metric").filter({ hasText: "Locked bond" });
    await expect(totalBond).toContainText("1,000 USDC");
    await expect(availableBond).toContainText("1,000 USDC");
    await expect(lockedBond).toContainText("0 USDC");
    const makerConnect = page.getByRole("button", { name: "Connect maker wallet" });
    if (await makerConnect.isVisible()) await makerConnect.click();
    await page.getByLabel("Amount").fill("10");
    await page.getByRole("button", { name: "Deposit" }).click();
    await expect(page.getByText("Deposit confirmed")).toBeVisible({ timeout: 30_000 });
    await expect(totalBond).toContainText("1,010 USDC");
    await expect(availableBond).toContainText("1,010 USDC");
    await expect(lockedBond).toContainText("0 USDC");
    await page.getByLabel("Amount").fill("5");
    await page.getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByText("Withdrawal confirmed")).toBeVisible({ timeout: 30_000 });
    await expect(totalBond).toContainText("1,005 USDC");
    await expect(availableBond).toContainText("1,005 USDC");
    await expect(lockedBond).toContainText("0 USDC");
  });

  test("invalidates live quote state on account and chain changes", async ({ page }) => {
    const fixture = runtimeFixture();
    await installRpcWallet(page, fixture.rpcUrl, fixture.accounts.trader);
    await page.goto("/trade");
    await expect(page.getByText("Pricing v2 · signed TTL 30s")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => (window as any).__emitEthereum("chainChanged", "0x1"));
    await expect(page.getByText(/Wallet is on chain 1/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await page.evaluate(() => (window as any).__emitEthereum("chainChanged", "0x2105"));
    await expect(page.getByText("Eligible at observed block")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "120s" }).click();
    await expect(page.getByText("Pricing v2 · signed TTL 120s")).toBeVisible({ timeout: 30_000 });
    const reboundQuote = page.waitForResponse((response) => {
      if (!response.url().endsWith("/runtime/firm-quote") || response.request().method() !== "POST") return false;
      const request = response.request().postDataJSON() as { taker?: string; pricingTtl?: number };
      return request.taker?.toLowerCase() === fixture.accounts.drainer.toLowerCase() && request.pricingTtl === 120 && response.ok();
    });
    await page.evaluate((account) => (window as any).__emitEthereum("accountsChanged", [account]), fixture.accounts.drainer);
    const quotePayload = await (await reboundQuote).json() as { quote: { taker: string; pricingTtl: number } };
    expect(quotePayload.quote.taker.toLowerCase()).toBe(fixture.accounts.drainer.toLowerCase());
    expect(quotePayload.quote.pricingTtl).toBe(120);
    await expect(page.getByText("Pricing v2 · signed TTL 120s")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Accept Firm quote" })).toBeEnabled();
  });
});

async function acceptFirmInUi(page: import("@playwright/test").Page) {
  await expect(page.getByText("Base Fork · Block 51,123,118")).toBeVisible();
  await page.getByRole("button", { name: "120s" }).click();
  const connect = page.getByRole("button", { name: "Connect wallet" });
  if (await connect.isVisible()) await connect.click();
  await expect(page.getByText("Eligible at observed block")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/3,000(?:\.00)? USDC/).first()).toBeVisible();
  await page.getByRole("button", { name: "Accept Firm quote" }).click();
  await expect(page.getByText("Commitment accepted · bond locked")).toBeVisible({ timeout: 30_000 });
}

function seedFork() {
  const rpcUrl = "http://127.0.0.1:8545";
  execFileSync("npx", ["hardhat", "run", "scripts/setup-frontend-fork.ts", "--network", "localBase"], {
    cwd: resolve(process.cwd(), "../contracts"), env: { ...process.env, FIRMDEPTH_FORK_RPC_URL: rpcUrl }, stdio: "pipe",
  });
}

async function rpc(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const payload = await response.json() as { result?: unknown; error?: { message: string } };
  if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}

function runtimeFixture(): RuntimeFixture {
  return JSON.parse(readFileSync(resolve(process.cwd(), ".runtime/firmdepth.json"), "utf8")) as RuntimeFixture;
}

async function installRpcWallet(page: import("@playwright/test").Page, rpcUrl: string, account: string) {
  await page.addInitScript(({ url, selectedAccount }) => {
    let requestId = 0;
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      async request({ method, params }: { method: string; params?: unknown[] | object }) {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [selectedAccount];
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params: params ?? [] }),
        });
        const payload = await response.json();
        if (payload.error) throw new Error(payload.error.message);
        return payload.result;
      },
      on(event: string, listener: (...args: unknown[]) => void) { const values = listeners.get(event) ?? new Set(); values.add(listener); listeners.set(event, values); },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
    };
    (window as any).__emitEthereum = (event: string, value: unknown) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  }, { url: rpcUrl, selectedAccount: account });
}
