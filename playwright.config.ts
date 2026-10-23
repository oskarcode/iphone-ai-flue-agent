import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  timeout: 120_000,
  use: {
    baseURL: process.env.LEARNING_TEST_URL ?? "http://localhost:8792",
    ...devices["iPhone 13"],
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  outputDir: ".wrangler/browser-results",
});
