"use strict";

import * as assert from "node:assert/strict";
import { test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  manifestForBrowser,
  buildRelease,
  packageName,
  validateVersion,
  validateReleaseVersion
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

test("Chromium release converts Firefox background scripts to a service worker", () => {
  const source: ExtensionManifest = {
    ...manifest,
    background: { scripts: ["src/background.js"], service_worker: "src/background.js" }
  };
  const chromium = manifestForBrowser(source, "chromium");
  assert.deepEqual(chromium.background, { service_worker: "src/background.js" });
  assert.deepEqual(source.background, {
    scripts: ["src/background.js"],
    service_worker: "src/background.js"
  });
});

test("Firefox releases preserve the stable Gecko identity", () => {
  const firefox = manifestForBrowser(manifest, "firefox");
  assert.equal(firefox.browser_specific_settings?.gecko?.id, "github-pr-filter@example.test");
});

test("Firefox release preserves background scripts", () => {
  const source: ExtensionManifest = {
    ...manifest,
    background: { scripts: ["src/background.js"], service_worker: "src/background.js" }
  };
  assert.deepEqual(manifestForBrowser(source, "firefox").background, {
    scripts: ["src/background.js"]
  });
});

test("release filenames identify the version and browser flavor", () => {
  assert.equal(packageName("chromium", "0.4.0"), "github-pr-filter-v0.4.0-chromium.zip");
  assert.equal(packageName("firefox", "0.4.0"), "github-pr-filter-v0.4.0-firefox.zip");
});

test("release preflight checks the checked-out metadata before packaging", () => {
  const version = validateReleaseVersion();
  assert.equal(validateReleaseVersion(version), version);
  assert.throws(() => validateReleaseVersion("999.0.0"), /Requested release/);
});

test("both release ZIPs omit settings-page assets and include repository runtime files", () => {
  const { artifacts } = buildRelease();
  assert.equal(artifacts.length, 2);
  for (const artifact of artifacts) {
    const listing = spawnSync("unzip", ["-Z1", artifact], { encoding: "utf8" });
    assert.equal(listing.status, 0, listing.stderr);
    const files = new Set(listing.stdout.split("\n"));
    for (const file of ["src/background.js", "src/views-menu.css", "src/views-editor.css"])
      assert.ok(files.has(file), `${artifact} must include ${file}`);
    for (const file of ["options.html", "src/options.js", "src/views.css"])
      assert.ok(!files.has(file), `${artifact} must omit ${file}`);
    const manifestResult = spawnSync("unzip", ["-p", artifact, "manifest.json"], {
      encoding: "utf8"
    });
    assert.equal(manifestResult.status, 0, manifestResult.stderr);
    const packagedManifest = JSON.parse(manifestResult.stdout) as ExtensionManifest;
    if (artifact.includes("chromium")) {
      assert.deepEqual(packagedManifest.background, { service_worker: "src/background.js" });
      assert.equal(packagedManifest.browser_specific_settings, undefined);
    } else {
      assert.deepEqual(packagedManifest.background, { scripts: ["src/background.js"] });
      assert.ok(packagedManifest.browser_specific_settings?.gecko?.id);
    }
  }
}, 30_000);
