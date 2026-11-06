import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test.describe("public protected deployment", () => {
  test.skip(process.env.FIRMDEPTH_PUBLIC_E2E !== "1", "Requires an explicitly configured live deployment");
  test.setTimeout(90000);
  test("authenticates Azure runtime and exposes scaled immutable payouts", async ({ page }) => {
    const deployment = JSON.parse(readFileSync("../../deployments/protected-sepolia.json", "utf8"));
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto("/settlement");
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Signed taker:")).toBeVisible({ timeout: 45000 });
    await expect(page.getByText(deployment.address, { exact: true })).toBeVisible();
    await expect(page.locator(".settlement-page .truth-tag")).toHaveText("SEPOLIA TESTNET · LIVE");
    await expect(page.getByLabel("WETH principal")).toHaveValue("0.0001");
    await expect(page.getByLabel("USDC allocation 1", { exact: true })).toHaveValue("0.12");
    await expect(page.getByLabel("USDC allocation 2", { exact: true })).toHaveValue("0.08");
    await expect(page.getByRole("button", { name: "Create payout plan", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Add recipient", exact: true }).click();
    await expect(page.getByLabel("Recipient 3", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
  test("loads live Trade and mobile payout routes without overflow", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/trade");
    await expect(page.locator(".truth-tag").getByText("SEPOLIA TESTNET · LIVE", { exact: true })).toBeVisible({ timeout: 45000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settlement");
    await expect(page.getByText("Signed taker:")).toBeVisible({ timeout: 45000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
  test("recovers a real paid plan and verifies its recipient receipt in the browser", async ({ page }) => {
    const evidence = JSON.parse(readFileSync("../contracts/evidence/protected-settlement-sepolia.json", "utf8"));
    // Read-only account discovery: signing and transaction submission are disabled.
    await page.addInitScript(({ payer }) => {
      const provider = {
        request: async ({ method }: { method: string }) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts") return [payer];
          if (method === "eth_chainId") return "0xaa36a7";
          throw new Error("Read-only receipt inspection provider");
        },
        on() {}, removeListener() {},
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    }, { payer: evidence.payer });
    await page.goto("/settlement");
    await expect(page.getByRole("heading", { name: "SETTLED", exact: true })).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole("heading", { name: "Verified recipient payments", exact: true })).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(evidence.transactionHash, { exact: true })).toBeVisible();
    await expect(page.getByText(/Paid 0.2 USDC/)).toBeVisible();
  });
});
