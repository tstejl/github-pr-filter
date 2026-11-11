import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";

export function registerCustomizationSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: saved repository visibility synchronizes across tabs and canceled edits stay local`, async () => {
    const browser = context.browser();
    const url = new URL(context.fixture().urlFor({ mode: "preview", query: "is:pr state:open" }));
    url.pathname = `/octocat/sync-${crypto.randomUUID().slice(0, 8)}/pulls`;
    await browser.open(url.href);
    await browser.waitForControl();
    await browser.openNewTab(url.href);
    await browser.waitForControl();
    await browser.switchToTab(0);
    await browser.click(".gprf-lifecycle-summary");
    await browser.click(".gprf-customize-views");
    await browser.click('[data-visibility-id="builtin-draft"]');
    await browser.click(".gprf-save-views");
    await browser.waitForElementCount(".gprf-views-editor", 0);
    await browser.waitForElementCount('.gprf-saved-option[data-view-id="builtin-draft"]', 0);
    await browser.switchToTab(1);
    await browser.waitForElementCount('.gprf-saved-option[data-view-id="builtin-draft"]', 0);
    await browser.click(".gprf-lifecycle-summary");
    await browser.click(".gprf-customize-views");
    await browser.click('[data-visibility-id="builtin-draft"]');
    await browser.click(".gprf-view-editor-footer .gprf-view-actions button:first-child");
    await browser.click(".gprf-view-confirm .gprf-view-danger");
    await browser.waitForElementCount(".gprf-views-editor", 0);
    await browser.open(url.href);
    await browser.waitForControl();
    await browser.waitForElementCount('.gprf-saved-option[data-view-id="builtin-draft"]', 0);
    assert.equal(new URL(await browser.url()).searchParams.get("q"), "is:pr state:open");
  }, 120_000);
}
