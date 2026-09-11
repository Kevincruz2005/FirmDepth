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

  test("reads eligibility, accepts, executes through Aqua, and decodes the receipt", async ({ page }) => {
    const fixture = runtimeFixture();
    await installRpcWallet(page, fixture.rpcUrl, fixture.accounts.trader);
    await page.goto("/trade");
    await acceptFirmInUi(page);
    await page.getByRole("button", { name: "Execute accepted commitment" }).click();
    await expect(page.getByText("FILLED_AQUA · receipt reconciled")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("AQUA", { exact: true })).toBeVisible();
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
    await drainerPage.getByRole("button", { name: "Connect wallet" }).click();
    await drainerPage.getByRole("button", { name: "Execute Soft swap" }).click();
    await expect(drainerPage.getByText(/Soft execution confirmed/)).toBeVisible({ timeout: 30_000 });
    await drainerPage.close();

    await page.getByRole("button", { name: "Execute accepted commitment" }).click();
    await expect(page.getByText("FILLED_BOND · receipt reconciled")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("BOND", { exact: true })).toBeVisible();
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
    await page.getByRole("button", { name: "Settle expired commitment" }).click();
    await expect(page.getByText("EXPIRED · bond unlocked")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("EXPIRED", { exact: true })).toBeVisible();
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
    await rpc(fixture.rpcUrl, "hardhat_setCode", [fixture.addresses.executor, "0x60006000fd"]);
    await page.getByRole("button", { name: "Execute accepted commitment" }).click();
    await expect(page.locator(".action-state.error")).toBeVisible({ timeout: 30_000 });
    const [after, commitment] = await Promise.all([
      client.readContract({ address: fixture.addresses.bondVault, abi: bondVaultAbi, functionName: "lockedFor", args: [commitmentId] }),
      client.readContract({ address: fixture.addresses.registry, abi: registryAbi, functionName: "getCommitment", args: [commitmentId] }),
    ]);
    expect(after[1]).toBe(before[1]);
    expect(Number(commitment.status)).toBe(1);
  });

  test("reads and mutates real maker bond state", async ({ page }) => {
    const fixture = runtimeFixture();
    await installRpcWallet(page, fixture.rpcUrl, fixture.accounts.maker);
    await page.goto("/maker");
    await expect(page.getByText("Base fork live")).toBeVisible();
    await page.getByRole("button", { name: "Connect maker wallet" }).click();
    await page.getByLabel("Amount").fill("10");
    await page.getByRole("button", { name: "Deposit" }).click();
    await expect(page.getByText("Deposit confirmed")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Amount").fill("5");
    await page.getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByText("Withdrawal confirmed")).toBeVisible({ timeout: 30_000 });
  });
});

async function acceptFirmInUi(page: import("@playwright/test").Page) {
  await expect(page.getByText("Base fork live")).toBeVisible();
  await expect(page.getByText("Eligible at observed block")).toBeVisible();
  await expect(page.getByText(/3,000(?:\.00)? USDC/).first()).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet" }).click();
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
      on() {},
      removeListener() {},
    };
    Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
  }, { url: rpcUrl, selectedAccount: account });
}
