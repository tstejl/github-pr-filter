"use strict";

import * as assert from "node:assert/strict";
import { test } from "bun:test";
import {
  manifestForBrowser,
  packageName,
  validateVersion
} from "../scripts/package-release";
import type { ExtensionManifest } from "../scripts/package-release";

const manifest: ExtensionManifest = {
  manifest_version: 3,
  version: "0.4.0",
  browser_specific_settings: {
    gecko: { id: "github-pr-filter@example.test" }
  }
};

test("release versions must agree across metadata and workflow input", () => {
  assert.equal(validateVersion("0.4.0", "0.4.0", "0.4.0"), "0.4.0");
  assert.throws(() => validateVersion("0.4.0", "0.5.0"), /Version mismatch/);
  assert.throws(() => validateVersion("0.4.0", "0.4.0", "0.5.0"), /Requested release/);
  assert.throws(() => validateVersion("version-1", "version-1"), /Unsupported manifest version/);
});

test("Chromium releases omit Firefox-only manifest metadata", () => {
  const chromium = manifestForBrowser(manifest, "chromium");
  assert.equal(chromium.browser_specific_settings, undefined);
  assert.ok(manifest.browser_specific_settings, "the source manifest must not be mutated");
});

test("Firefox releases preserve the stable Gecko identity", () => {
  const firefox = manifestForBrowser(manifest, "firefox");
  assert.equal(
    firefox.browser_specific_settings?.gecko?.id,
    "github-pr-filter@example.test"
  );
});

test("release filenames identify the version and browser flavor", () => {
  assert.equal(
    packageName("chromium", "0.4.0"),
    "github-pr-filter-v0.4.0-chromium.zip"
  );
  assert.equal(
    packageName("firefox", "0.4.0"),
    "github-pr-filter-v0.4.0-firefox.zip"
  );
});
