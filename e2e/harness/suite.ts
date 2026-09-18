import { test } from "@playwright/test";
import * as assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import type {
  BrowserName,
  BrowserSession,
  E2ETestContext,
  FixtureServer,
  PreparedExtension
} from "./contracts";
import { prepareExtension, startFixtureServer } from "./fixture";
import { startPreparedBrowserSession } from "./start-session";
import { measuredStep } from "./timing";

function selectedBrowser(): BrowserName {
  const browserValue = process.env.E2E_BROWSER;
  if (browserValue !== "chromium" && browserValue !== "firefox") {
    throw new Error("Set E2E_BROWSER to chromium or firefox.");
  }
  return browserValue;
}

export function installE2EHarness(): E2ETestContext {
  const browserName = selectedBrowser();
  let activeFixture: FixtureServer | undefined;
  let activeBrowser: BrowserSession | undefined;
  let preparedExtension: PreparedExtension | undefined;

  test.beforeAll(async () => {
    test.setTimeout(browserName === "firefox" ? 60_000 : 30_000);
    const prepared = await measuredStep(browserName, "prepare extension", () =>
      prepareExtension(browserName)
    );
    preparedExtension = prepared;
    activeBrowser = await measuredStep(browserName, "start browser session", () =>
      startPreparedBrowserSession(browserName, prepared)
    );
  });

  test.beforeEach(async () => {
    activeFixture = await startFixtureServer();
  });

  test.afterEach(async () => {
    test.setTimeout(30_000);
    try {
      await activeBrowser?.reset();
    } finally {
      await activeFixture?.close();
      activeFixture = undefined;
    }
  });

  test.afterAll(async () => {
    test.setTimeout(30_000);
    try {
      await activeBrowser?.close();
    } finally {
      activeBrowser = undefined;
      if (preparedExtension) {
        await rm(preparedExtension.root, { recursive: true, force: true });
      }
      preparedExtension = undefined;
    }
  });

  return {
    browserName,
    browser() {
      assert.ok(activeBrowser, "Browser session has not started");
      return activeBrowser;
    },
    fixture() {
      assert.ok(activeFixture, "Fixture server has not started");
      return activeFixture;
    }
  };
}
