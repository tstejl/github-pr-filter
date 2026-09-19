import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.e2e.ts",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  maxFailures: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI)
});
