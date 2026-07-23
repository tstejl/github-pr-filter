import { test } from "bun:test";
import * as assert from "node:assert/strict";
import type { E2ETestContext } from "../harness/contracts";

const OPTION_SELECTOR = ".gprf-lifecycle-option";

export function registerAdapterContractSpecs(context: E2ETestContext): void {
  test(`${context.browserName}: unsubmitted search typing does not change lifecycle state`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();
    const url = fixture.urlFor({ query: null });

    await browser.open(url);
    await browser.waitForControl();
    await browser.mutationCount(".gprf-lifecycle", 250);

    const committedUrl = await browser.url();
    const selectedLabel = await browser.text(".gprf-summary-label");
    const actionUrls = await browser.attributes(OPTION_SELECTOR, "href");

    await browser.setUnsubmittedSearchQuery("is:pr is:closed draft:true");
    await browser.appendUnrelatedDomMutation();
    assert.equal(await browser.mutationCount(".gprf-lifecycle", 250), 0);

    assert.equal(await browser.url(), committedUrl);
    assert.deepEqual(await browser.text(".gprf-summary-label"), selectedLabel);
    assert.deepEqual(await browser.attributes(OPTION_SELECTOR, "href"), actionUrls);
  }, 90_000);

  test(`${context.browserName}: URL replacement reconciles without a GitHub event`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.url);
    await browser.waitForControl();
    await browser.replaceUrlQuery("is:pr is:closed label:bug");
    await browser.waitForText(".gprf-summary-label", "Closed", true);

    assert.deepEqual(await browser.text(".gprf-summary-count"), ["2"]);
    const openHref = await browser.attribute(`${OPTION_SELECTOR}[data-lifecycle="open"]`, "href");
    assert.ok(openHref);
    assert.ok(new URL(openHref).searchParams.get("q")?.includes("label:bug"));
  }, 90_000);

  test(`${context.browserName}: server-committed search attributes reconcile without navigation`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.urlFor({ mode: "no-state-groups", query: null }));
    await browser.waitForControl();
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);

    await browser.setCommittedSearchQuery("is:pr is:closed label:bug");
    await browser.waitForText(".gprf-summary-label", "Closed", true);
    const openHref = await browser.attribute(`${OPTION_SELECTOR}[data-lifecycle="open"]`, "href");
    assert.ok(openHref);
    assert.ok(new URL(openHref).searchParams.get("q")?.includes("label:bug"));
  }, 90_000);

  test(`${context.browserName}: responsive in-main groups mount while stray groups remain native`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.urlFor({ mode: "responsive-groups" }));
    await browser.waitForElementCount("main .table-list-header-toggle.states > .gprf-lifecycle", 2);
    await browser.waitForElementCount(".gprf-lifecycle", 2);
    await browser.waitForElementCount(
      'body > .table-list-header-toggle.states[data-fixture-group="stray"] > .gprf-lifecycle',
      0
    );
    await browser.waitForElementCount(
      "main .table-list-header-toggle.states > a.gprf-native-status-hidden",
      4
    );

    assert.ok(
      ((await browser.attribute("html", "class")) || "").includes("gprf-replacement-mounted")
    );
    assert.equal(
      await browser.attribute(
        'body > .table-list-header-toggle.states[data-fixture-group="stray"] > a:first-child',
        "class"
      ),
      "btn-link selected"
    );
    assert.notEqual(
      await browser.cssValue(
        'body > .table-list-header-toggle.states[data-fixture-group="stray"] > a:first-child',
        "display"
      ),
      "none"
    );
  }, 90_000);

  test(`${context.browserName}: All aggregates native counts despite GitHub selecting Open`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.urlFor({ mode: "open-selected-all", query: "is:pr" }));
    await browser.waitForControl();

    assert.equal(
      await browser.attribute(
        'main .table-list-header-toggle.states > a[href*="is%3Aopen"]',
        "class"
      ),
      "btn-link selected gprf-native-status-hidden"
    );
    assert.deepEqual(await browser.text(".gprf-summary-label"), ["All"]);
    assert.deepEqual(await browser.text(".gprf-summary-count"), ["5"]);
  }, 90_000);

  test(`${context.browserName}: missing native state groups use one standalone search control`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.urlFor({ mode: "no-state-groups" }));
    await browser.waitForControl();
    await browser.waitForElementCount(".gprf-lifecycle", 1);
    await browser.waitForElementCount(".gprf-lifecycle--standalone", 1);
    await browser.waitForElementCount(
      'form[role="search"] + .gprf-lifecycle.gprf-lifecycle--standalone',
      1
    );
    await browser.waitForElementCount(".gprf-native-status-hidden", 0);
  }, 90_000);

  test(`${context.browserName}: matching but unrecognized state markup fails open`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.urlFor({ mode: "decoy-state-group" }));
    await browser.waitForControl();
    await browser.waitForElementCount('[data-fixture-group="decoy"] > .gprf-lifecycle', 0);
    await browser.waitForElementCount(".gprf-lifecycle--standalone", 1);
    await browser.waitForElementCount(".gprf-native-status-hidden", 0);
    assert.notEqual(
      await browser.cssValue('[data-fixture-group="decoy"] > .btn-link:first-child', "display"),
      "none"
    );
    assert.notEqual(
      await browser.cssValue('[data-fixture-group="decoy"] > .btn-link:last-child', "display"),
      "none"
    );
  }, 90_000);

  test(`${context.browserName}: duplicate search fields use the visible committed pull-list field`, async () => {
    const fixture = context.fixture();
    const browser = context.browser();

    await browser.open(fixture.urlFor({ mode: "duplicate-search-inputs", query: null }));
    await browser.waitForControl();

    assert.deepEqual(await browser.text(".gprf-summary-label"), ["Open"]);
    await browser.waitForElementCount(
      'form[data-fixture-search="committed"] + .gprf-lifecycle--standalone',
      1
    );
    await browser.waitForElementCount(
      'form[data-fixture-search="stale"] + .gprf-lifecycle--standalone',
      0
    );

    await browser.swapResponsiveSearchFields();
    await browser.waitForText(".gprf-summary-label", "Closed", true);
    await browser.waitForElementCount(
      'form[data-fixture-search="stale"] + .gprf-lifecycle--standalone',
      1
    );
    await browser.waitForElementCount(
      'form[data-fixture-search="committed"] + .gprf-lifecycle--standalone',
      0
    );
  }, 90_000);
}
