import { expect, test } from "@playwright/test";

const routes = [
  ["/", /The quote is soft/],
  ["/trade", /Trade the depth you can prove/],
  ["/evidence", /Don’t trust the status badge/],
  ["/maker", /Make certainty a priced resource/],
] as const;

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
