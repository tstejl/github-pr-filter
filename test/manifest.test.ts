import { test } from "bun:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { isRepositoryPullListPath } from "../src/page-scope";

const projectRoot = path.resolve(import.meta.dir, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
const builtRoot = path.join(projectRoot, "dist", "extension");

test("manifest uses a minimal Manifest V3 permission set", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, {
    required: ["none"]
  });
  assert.match(manifest.browser_specific_settings.gecko.id, /^\{[0-9a-f-]+\}$/);
  assert.equal(manifest.content_scripts.length, 2);
  for (const contentScript of manifest.content_scripts) {
    assert.deepEqual(contentScript.matches, ["https://github.com/*"]);
  }
});

test("anti-flicker CSS loads before the interactive content script", () => {
  const [bootstrap, interactive] = manifest.content_scripts;
  assert.equal(bootstrap.run_at, "document_start");
  assert.deepEqual(bootstrap.css, ["src/content.css"]);
  assert.deepEqual(bootstrap.js, ["src/bootstrap.js"]);
  assert.equal(interactive.run_at, "document_end");
  assert.deepEqual(interactive.js, ["src/content.js"]);
});

test("page scope includes repository PR lists and excludes global pulls", () => {
  assert.equal(isRepositoryPullListPath("/octocat/hello-world/pulls"), true);
  assert.equal(isRepositoryPullListPath("/octocat/hello-world/pulls/"), true);
  assert.equal(isRepositoryPullListPath("/pulls"), false);
  assert.equal(isRepositoryPullListPath("/pulls/assigned"), false);
  assert.equal(isRepositoryPullListPath("/octocat/hello-world/pull/1"), false);
  assert.equal(isRepositoryPullListPath("/octocat/hello-world/pulls/1"), false);
});

test("navigation keeps GitHub Turbo hooks instead of forcing a page reload", () => {
  const content = fs.readFileSync(path.join(projectRoot, "src/content.ts"), "utf8");
  const stylesheet = fs.readFileSync(path.join(projectRoot, "src/content.css"), "utf8");
  assert.doesNotMatch(content, /location\.assign/);
  assert.match(content, /data-turbo-frame/);
  assert.match(stylesheet, /html\.gprf-supported-page/);
});

test("lifecycle menu follows GitHub's fixed-caret motion pattern", () => {
  const stylesheet = fs.readFileSync(path.join(projectRoot, "src/content.css"), "utf8");
  assert.doesNotMatch(stylesheet, /gprf-lifecycle\[open\][^{]*gprf-chevron/);
  assert.match(stylesheet, /animation: gprf-menu-open 120ms/);
  assert.match(stylesheet, /@keyframes gprf-menu-open/);
  assert.match(stylesheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none;/);
});

test("active count remains visible while the lifecycle menu is expanded", () => {
  const stylesheet = fs.readFileSync(path.join(projectRoot, "src/content.css"), "utf8");
  assert.doesNotMatch(stylesheet, /gprf-lifecycle\[open\][^{]*gprf-summary-count/);
});

test("every packaged script, stylesheet, and icon exists", () => {
  const packagedFiles = [
    ...manifest.content_scripts.flatMap((entry: { js?: string[]; css?: string[] }) => [
      ...(entry.js || []),
      ...(entry.css || [])
    ]),
    ...Object.values(manifest.icons)
  ];

  for (const packagedFile of packagedFiles) {
    assert.equal(
      fs.existsSync(path.join(builtRoot, packagedFile)),
      true,
      `${packagedFile} should exist`
    );
  }
});
