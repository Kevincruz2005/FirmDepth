import { expect, test } from "@playwright/test";

const routes = [
  ["/", /The quote is soft/],
  ["/trade", /Trade the depth you can prove/],
  ["/evidence", /Don’t trust the status badge/],
  ["/maker", /Make certainty a priced resource/],
  ["/docs", /Execution certainty, explained/],
] as const;

test("application navigation has Docs and no redundant Open app control", async ({ page }) => {
  await page.goto("/trade");
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Docs" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open app/i })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Trade on Sepolia" })).toHaveAttribute("href", "/trade");
  await expect(page.getByRole("link", { name: "View evidence" })).toHaveAttribute("href", "/evidence");
  await expect(page.getByText(/0\.2000 WETH|690\.00 USDC|0\.000173 WETH/)).toHaveCount(0);
});

test("no-wallet discovery offers safe installation guidance", async ({ page }) => {
  await page.goto("/trade");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByText("No browser wallet detected.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Install MetaMask/ })).toHaveAttribute("href", "https://metamask.io/download/");
  await expect(page.getByRole("link", { name: /Install Rabby/ })).toHaveAttribute("href", "https://rabby.io/");
});

test("Sepolia proof leads and canonical Base details are compact by default", async ({ page }) => {
  await page.goto("/evidence");
  const manual = page.getByRole("heading", { name: "A real wallet reached FILLED_AQUA." });
  const runtime = page.getByRole("heading", { name: "Current contract state, read from the EVM." });
  await expect(manual).toBeVisible();
  await expect(runtime).toBeVisible();
  expect(await page.evaluate(() => {
    const first = document.querySelector("#manual-proof-title");
    const second = document.querySelector("#runtime-title");
    return first !== null && second !== null && Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  const badges = page.locator(".source-badge");
  expect(await badges.count()).toBeGreaterThanOrEqual(4);
  for (const badge of await badges.all()) expect((await badge.boundingBox())!.height).toBeLessThanOrEqual(34);
  const disclosure = page.locator(".base-proof-disclosure");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await disclosure.locator(":scope > summary").click();
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(disclosure.getByText("Base · block 51,123,118")).toBeVisible();
});

for (const [path, heading] of routes) {
  test(`${path} renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const width of [375, 390, 768, 1024, 1440]) {
  test(`surfaces have no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  });
}

test("keyboard navigation reaches the main application", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("unknown routes render an explicit Not Found state", async ({ page }) => {
  await page.goto("/not-a-firmdepth-route");
  await expect(page.getByRole("heading", { name: "This depth does not exist." })).toBeVisible();
  await expect(page).toHaveURL(/not-a-firmdepth-route/);
});

test("mobile navigation manages focus and closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Toggle navigation" });
  await menu.click();
  await expect(page.getByRole("link", { name: "Trade" }).first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});
