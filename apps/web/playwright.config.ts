import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./e2e/ports.ts";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalTeardown: "./e2e/teardown.ts",
  use: { baseURL: E2E.webUrl, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --experimental-strip-types --no-warnings e2e/stack.ts",
    url: E2E.webUrl,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});
