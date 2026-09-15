import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";

const METADATA = '[id$="-list-view-metadata"]';
const ACTIONS = `${METADATA} [role="toolbar"][aria-label="Actions"]`;
const STATUS_LIST = `${METADATA} ul.list-style-none`;
const CONTROL = `${METADATA} .gprf-lifecycle`;
const OPTION = ".gprf-lifecycle-option";

export function registerIssueSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: Issues mounts Open Closed All without PR controls`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ kind: "issues" }));
    await browser.waitForControl();

    assert.deepEqual(await browser.text(`${CONTROL} .gprf-summary-label`), ["Open"]);
    assert.deepEqual(await browser.text(`${CONTROL} .gprf-summary-count`), ["18,472"]);
    assert.equal(
      await browser.attribute(`${CONTROL} .gprf-lifecycle-summary`, "aria-label"),
      "18,472 issues: Open"
    );
    await browser.waitForElementCount(`${CONTROL} .gprf-configure-action`, 0);
    await browser.waitForElementCount(`${ACTIONS} .gprf-lifecycle`, 0);
    await browser.waitForElementCount(`${STATUS_LIST} li > .gprf-lifecycle`, 0);
    await browser.waitForElementCount(`${STATUS_LIST} a.gprf-native-status-hidden`, 2);
    await browser.waitForElementCount(
      `${METADATA} [data-fixture-issue-results].gprf-native-results-hidden`,
      0
    );

    await browser.click(`${CONTROL} .gprf-lifecycle-summary`);
    assert.deepEqual(await browser.text(`${OPTION} .gprf-option-label`), ["Open", "Closed", "All"]);
    assert.equal(
      (await browser.text(`${OPTION} .gprf-option-description`)).join(" ").includes("pull request"),
      false
    );
    await browser.waitForElementCount(`${OPTION}[data-lifecycle="needs_review"]`, 0);
    await browser.waitForElementCount(`${OPTION}[data-lifecycle="merged"]`, 0);
    await browser.waitForElementCount(`${OPTION}[data-lifecycle="draft"]`, 0);
  }, 90_000);

  test(`${context.browserName}: Issues transitions preserve filters and keep is:issue`, async () => {
    const browser = context.browser();
    await browser.open(
      context.fixture().urlFor({ kind: "issues", query: "is:issue state:open label:bug" })
    );
    await browser.waitForControl();

    await browser.click(`${CONTROL} .gprf-lifecycle-summary`);
    await browser.click(`${OPTION}[data-lifecycle="all"]`);
    await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === "is:issue label:bug");
    await browser.waitForControl();
    assert.deepEqual(await browser.text(`${CONTROL} .gprf-summary-label`), ["All"]);
    assert.deepEqual(await browser.text(`${CONTROL} .gprf-summary-count`), ["25,703"]);
    assert.equal((await browser.url()).includes("is%3Apr"), false);
    assert.ok(new URL(await browser.url()).searchParams.get("q")?.includes("is:issue"));

    await browser.click(`${CONTROL} .gprf-lifecycle-summary`);
    await browser.click(`${OPTION}[data-lifecycle="closed"]`);
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q") === "is:issue label:bug state:closed"
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(`${CONTROL} .gprf-summary-label`), ["Closed"]);
    assert.deepEqual(await browser.text(`${CONTROL} .gprf-summary-count`), ["7,231"]);

    await browser.click(`${CONTROL} .gprf-lifecycle-summary`);
    await browser.click(`${OPTION}[data-lifecycle="open"]`);
    await browser.waitForUrl(
      (url) => new URL(url).searchParams.get("q") === "is:issue label:bug state:open"
    );
    await browser.waitForControl();
    assert.deepEqual(await browser.text(`${CONTROL} .gprf-summary-label`), ["Open"]);
  }, 90_000);

  test(`${context.browserName}: Issues aggregate counts hide native status without duplicate controls`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ kind: "issues", query: "is:issue state:open" }));
    await browser.waitForControl();
    await browser.waitForElementCount(`${METADATA} [data-fixture-issue-results]`, 0);
    await browser.waitForElementCount(`${STATUS_LIST} a.gprf-native-status-hidden`, 2);
    await browser.waitForElementCount(`${STATUS_LIST} li > .gprf-lifecycle`, 0);
    await browser.waitForElementCount(`${METADATA} > .gprf-lifecycle`, 0);
    await browser.waitForElementCount(
      `${METADATA} [data-fixture-issue-status-wrap] > .gprf-lifecycle`,
      1
    );
    assert.equal(await browser.attribute(ACTIONS, "aria-label"), "Actions");
    const starts = Number(
      (await browser.attribute("html", "data-gprf-menu-animation-starts")) ?? "0"
    );

    await browser.click(`${CONTROL} .gprf-lifecycle-summary`);
    await browser.waitForElementCount(`${CONTROL}[open]`, 1);
    await browser.waitForElementCount(`${CONTROL} .gprf-lifecycle-menu:popover-open`, 1);
    await browser.wait(350);
    assert.equal(
      Number(await browser.attribute("html", "data-gprf-menu-animation-starts")),
      starts + 1
    );
    assert.equal(await browser.attribute("html", "data-gprf-summary-expansion-variants"), "1");
    await browser.waitForElementCount(`${CONTROL}[open]`, 1);
    await browser.click(`${CONTROL} .gprf-lifecycle-summary`);
    await browser.wait(160);
    await browser.waitForElementCount(`${CONTROL}[open]`, 0);
  }, 90_000);

  test(`${context.browserName}: SPA Issues and PR navigation gets distinct control snapshots`, async () => {
    const browser = context.browser();
    await browser.open(context.fixture().urlFor({ kind: "issues" }));
    await browser.waitForControl();
    assert.equal(
      await browser.attribute(`${CONTROL} .gprf-lifecycle-summary`, "aria-label"),
      "18,472 issues: Open"
    );

    await browser.navigateRepository("/octocat/hello-world/pulls");
    await browser.waitForElementCount(
      '.gprf-lifecycle-summary[aria-label*="Pull request"], .gprf-lifecycle-summary[aria-label*="pull requests"]',
      1
    );
    await browser.click(".gprf-lifecycle-summary");
    await browser.waitForElementCount(`${OPTION}[data-lifecycle="needs_review"]`, 1);
    await browser.waitForElementCount(".gprf-configure-action", 1);
    await browser.click(".gprf-lifecycle-summary");

    await browser.navigateRepository("/octocat/hello-world/issues");
    await browser.waitForElementCount('.gprf-lifecycle-summary[aria-label*="issues"]', 1);
    await browser.click(".gprf-lifecycle-summary");
    await browser.waitForElementCount(`${OPTION}[data-lifecycle="needs_review"]`, 0);
    await browser.waitForElementCount(".gprf-configure-action", 0);
    assert.deepEqual(await browser.text(`${OPTION} .gprf-option-label`), ["Open", "Closed", "All"]);
  }, 90_000);
}
