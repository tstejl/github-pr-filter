import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";

const OPTION_SELECTOR = ".gprf-lifecycle-option";
const REVIEW_STATUSES = ["none", "required", "approved", "changes_requested"] as const;

export function registerReviewFilterSpecs(context: E2ETestContext): void {
  for (const reviewStatus of REVIEW_STATUSES) {
    test(`${context.browserName}: review:${reviewStatus} remains orthogonal to lifecycle`, async () => {
      const fixture = context.fixture();
      const browser = context.browser();
      const query = `is:pr is:open draft:false review:${reviewStatus}`;

      await browser.open(fixture.url);
      await browser.waitForControl();
      await browser.search(query);
      await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === query);
      await browser.waitForControl();
      assert.deepEqual(await browser.text(".gprf-summary-label"), ["Ready"]);

      await browser.click(".gprf-lifecycle-summary");
      assert.equal(
        await browser.attribute(`${OPTION_SELECTOR}[data-lifecycle="ready"]`, "aria-checked"),
        "true"
      );
    }, 90_000);
  }

  test(`${context.browserName}: reviewer-specific qualifiers survive lifecycle changes`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();
    const reviewerQuery =
      "is:pr is:open draft:false review:changes_requested reviewed-by:octocat review-requested:hubot user-review-requested:@me team-review-requested:github/docs";

    await browser.open(fixture.url);
    await browser.waitForControl();
    await browser.search(reviewerQuery);
    await browser.waitForUrl((url) => new URL(url).searchParams.get("q") === reviewerQuery);
    await browser.waitForControl();
    await browser.click(".gprf-lifecycle-summary");
    await browser.click(`${OPTION_SELECTOR}[data-lifecycle="draft"]`);
    await browser.waitForUrl((url) => {
      const query = new URL(url).searchParams.get("q") ?? "";
      return (
        query.includes("review:changes_requested") &&
        query.includes("reviewed-by:octocat") &&
        query.includes("review-requested:hubot") &&
        query.includes("user-review-requested:@me") &&
        query.includes("team-review-requested:github/docs") &&
        query.includes("draft:true")
      );
    });
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Draft"]);
  }, 90_000);
}
