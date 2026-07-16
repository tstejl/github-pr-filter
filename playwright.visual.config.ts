import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./visual",
  timeout: 30_000,
  workers: 1,
  webServer: {
    command: "bun run storybook -- --ci",
    url: "http://127.0.0.1:6006",
    reuseExistingServer: true,
    timeout: 120_000
  },
  use: {
    baseURL: "http://127.0.0.1:6006",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 }
  }
});
