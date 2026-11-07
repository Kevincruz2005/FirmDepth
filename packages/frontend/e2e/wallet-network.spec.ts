import { expect, test, type Page } from "@playwright/test";

// Read-only wallet simulation against the actual hosted fork. No signing or
// operator token; these tests never reset or transact on the shared demo.
test.describe("fork wallet connection", () => {
  test.skip(process.env.FIRMDEPTH_WALLET_E2E !== "1", "Requires the running hosted fork");
  test.setTimeout(120000);

  for (const scenario of ["switch", "wrong-rpc", "cancel"] as const) {
    test(`${scenario}: wallet connection uses the fork RPC`, async ({ page }) => {
      await installReadOnlyWallet(page, scenario);
      await page.goto("/settlement", { timeout: 90000 });
      await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Choose wallet" });
      await expect(dialog.getByText("FirmDepth Azure Fork", { exact: true }).first()).toBeVisible({ timeout: 60000 });
      await dialog.getByRole("button", { name: /Connection Test Wallet/ }).click();
      if (scenario === "switch") {
        await expect(dialog).not.toBeVisible({ timeout: 60000 });
        await expect(page.locator(".account-summary")).toContainText("0x885a", { timeout: 60000 });
        const calls = await page.evaluate(() => (window as unknown as { walletTestCalls: Array<{ method: string; params: unknown[] }> }).walletTestCalls);
        expect(calls.find(call => call.method === "wallet_addEthereumChain")?.params).toEqual([{
          chainId: "0x2105", chainName: "FirmDepth Azure Fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [new URL("/rpc", page.url()).href],
        }]);
        expect(calls.filter(call => /send|sign/i.test(call.method))).toEqual([]);
      } else {
        await expect(dialog.getByRole("alert")).toContainText(scenario === "cancel" ? "Wallet connection cancelled." : "RPC does not match", { timeout: 60000 });
        await expect(dialog.getByText(new URL("/rpc", page.url()).href, { exact: true })).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
    });
  }
});

async function installReadOnlyWallet(page: Page, scenario: "switch" | "wrong-rpc" | "cancel") {
  await page.addInitScript(({ scenario }) => {
    let chain = scenario === "wrong-rpc" ? "0x2105" : "0xaa36a7";
    let authorized = false;
    let id = 0;
    const calls: Array<{ method: string; params: unknown[] }> = [];
    Object.assign(window, { walletTestCalls: calls });
    const provider = {
      async request({ method, params = [] }: { method: string; params?: unknown[] }) {
        calls.push({ method, params });
        if (method === "eth_chainId") return chain;
        if (method === "eth_accounts") return authorized ? ["0x885a51365c30De518a1efAd46a28531B9ad9B509"] : [];
        if (method === "eth_requestAccounts") { authorized = true; return ["0x885a51365c30De518a1efAd46a28531B9ad9B509"]; }
        if (method === "wallet_addEthereumChain") {
          if (scenario === "cancel") throw Object.assign(new Error("User rejected"), { code: 4001 });
          return null;
        }
        if (method === "wallet_switchEthereumChain") { chain = (params[0] as { chainId: string }).chainId; return null; }
        if (scenario === "wrong-rpc" && method === "eth_getCode") return "0x";
        if (!/^eth_(getCode|getBlockByNumber)$/.test(method)) throw Error("Read-only connection test");
        const response = await fetch("/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
        const data = await response.json();
        if (data.error) throw Error("Fork read failed");
        return data.result;
      },
      on() {}, removeListener() {},
    };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: {
      info: { uuid: "wallet-network-test", name: "Connection Test Wallet", rdns: "test.firmdepth.connection", icon: "data:image/png;base64,AA==" }, provider,
    } }));
    window.addEventListener("eip6963:requestProvider", announce);
  }, { scenario });
}
