import { defineConfig } from "@playwright/test";

const port = Number(process.env.FIRMDEPTH_E2E_PORT ?? "4173");
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) throw new Error("FIRMDEPTH_E2E_PORT must be a valid TCP port");
const liveFork = process.env.FIRMDEPTH_LIVE_E2E === "1";
const liveSepolia = process.env.FIRMDEPTH_SEPOLIA_LIVE_E2E === "1";
const publicDeployment = process.env.FIRMDEPTH_PUBLIC_E2E === "1";
const hostedFork = process.env.FIRMDEPTH_HOSTED_E2E === "1";
const publicUrl = process.env.FIRMDEPTH_E2E_BASE_URL;
if ((publicDeployment || hostedFork) && !publicUrl) throw new Error("FIRMDEPTH_E2E_BASE_URL is required for hosted deployment checks");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: publicDeployment || hostedFork ? publicUrl : `http://127.0.0.1:${port}`,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH ?? "/usr/bin/google-chrome-stable" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    colorScheme: "light",
  },
  webServer: liveSepolia || publicDeployment || hostedFork ? undefined : {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI && !liveFork,
    timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
