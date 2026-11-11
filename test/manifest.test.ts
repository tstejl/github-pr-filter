import { test } from "bun:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import {
  isRepositoryIssueListPath,
  isRepositoryPullListPath,
  repositoryKeyFromIssueListPath,
  repositoryKeyFromPullListPath
} from "../src/page-scope";

const projectRoot = path.resolve(import.meta.dir, "..");
const builtRoot = path.join(projectRoot, "dist", "extension");
const firefoxRoot = path.join(projectRoot, "dist", "extension-firefox");

interface ManifestFixture {
  manifest_version: number;
  permissions: string[];
  host_permissions?: string[];
  browser_specific_settings?: {
    gecko: {
      id: string;
      data_collection_permissions: { required: string[] };
    };
  };
  background: { scripts?: string[]; service_worker?: string };
  options_ui?: unknown;
  content_scripts: Array<{
    matches: string[];
    run_at: string;
    css?: string[];
    js?: string[];
  }>;
  icons: Record<string, string>;
}

function assertManifestFixture(value: unknown): asserts value is ManifestFixture {
  assert.ok(typeof value === "object" && value !== null && "content_scripts" in value);
  const candidate = value as Record<string, unknown>;
  assert.ok(Array.isArray(candidate.content_scripts));
  assert.ok(typeof candidate.icons === "object" && candidate.icons !== null);
}

const parsedManifest: unknown = JSON.parse(
  fs.readFileSync(path.join(builtRoot, "manifest.json"), "utf8")
);
assertManifestFixture(parsedManifest);
const manifest = parsedManifest;
const firefoxParsed: unknown = JSON.parse(
  fs.readFileSync(path.join(firefoxRoot, "manifest.json"), "utf8")
);
assertManifestFixture(firefoxParsed);
const firefoxManifest = firefoxParsed;

test("Chromium build uses a clean MV3 service worker manifest", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.browser_specific_settings, undefined);
  assert.deepEqual(manifest.background, { service_worker: "src/background.js" });
  assert.equal(manifest.content_scripts.length, 2);
  assert.equal(manifest.options_ui, undefined);
  for (const contentScript of manifest.content_scripts) {
    assert.deepEqual(contentScript.matches, ["https://github.com/*"]);
  }
});

test("Firefox build uses only background scripts and retains Gecko metadata", () => {
  assert.equal(firefoxManifest.manifest_version, 3);
  assert.deepEqual(firefoxManifest.background, { scripts: ["src/background.js"] });
  assert.equal(
    firefoxManifest.browser_specific_settings?.gecko.data_collection_permissions.required[0],
    "none"
  );
  assert.match(firefoxManifest.browser_specific_settings?.gecko.id ?? "", /^\{[0-9a-f-]+\}$/);
});

test("anti-flicker CSS loads before the interactive content script", () => {
  const [bootstrap, interactive] = manifest.content_scripts;
  assert.ok(bootstrap);
  assert.ok(interactive);
  assert.equal(bootstrap.run_at, "document_start");
  assert.deepEqual(bootstrap.css, [
    "src/content.css",
    "src/views-menu.css",
    "src/views-editor.css"
  ]);
  assert.deepEqual(bootstrap.js, ["src/bootstrap.js"]);
  assert.equal(interactive.run_at, "document_end");
  assert.deepEqual(interactive.js, ["src/content.js"]);
});

test("bootstrap leaves native controls available while GitHub replaces page or frame content", () => {
  const bootstrap = fs.readFileSync(path.join(projectRoot, "src/bootstrap.ts"), "utf8");
  assert.match(bootstrap, /clearPageMarkers\(document\.documentElement\)/);
  assert.doesNotMatch(bootstrap, /markReplacementPending/);
});

test("native status controls are hidden only while a replacement is pending or mounted", () => {
  const stylesheet = fs.readFileSync(path.join(projectRoot, "src/content.css"), "utf8");
  assert.match(stylesheet, /html\.gprf-replacement-pending/);
  assert.match(stylesheet, /html\.gprf-replacement-mounted \.gprf-native-status-hidden/);
  assert.doesNotMatch(stylesheet, /html\.gprf-replacement-mounted \.table-list-header-toggle/);
  assert.doesNotMatch(stylesheet, /(?:^|\n)\.gprf-native-status-hidden\s*\{/);
});

test("page scope includes repository PR lists and excludes global pulls", () => {
  assert.equal(isRepositoryPullListPath("/octocat/hello-world/pulls"), true);
  assert.equal(isRepositoryPullListPath("/octocat/hello-world/pulls/"), true);
  assert.equal(isRepositoryPullListPath("/pulls"), false);
  assert.equal(isRepositoryPullListPath("/pulls/assigned"), false);
  assert.equal(isRepositoryPullListPath("/octocat/hello-world/pull/1"), false);
  assert.equal(isRepositoryPullListPath("/octocat/hello-world/pulls/1"), false);
  assert.equal(repositoryKeyFromPullListPath("/OctoCat/Hello-World/pulls"), "octocat/hello-world");
  assert.equal(repositoryKeyFromPullListPath("/pulls"), null);
});

test("page scope includes repository issue lists and excludes issue details", () => {
  assert.equal(isRepositoryIssueListPath("/octocat/hello-world/issues"), true);
  assert.equal(isRepositoryIssueListPath("/octocat/hello-world/issues/"), true);
  assert.equal(isRepositoryIssueListPath("/issues"), false);
  assert.equal(isRepositoryIssueListPath("/octocat/hello-world/issues/1"), false);
  assert.equal(
    repositoryKeyFromIssueListPath("/OctoCat/Hello-World/issues"),
    "octocat/hello-world"
  );
  assert.equal(repositoryKeyFromIssueListPath("/issues"), null);
});

test("navigation keeps GitHub Turbo hooks instead of forcing a page reload", () => {
  const adapter = fs.readFileSync(
    path.join(projectRoot, "src/github-pull-list-adapter.ts"),
    "utf8"
  );
  assert.doesNotMatch(adapter, /location\.assign/);
  assert.match(adapter, /data-turbo-frame/);
});

test("lifecycle menu uses repeatable open and close transitions", () => {
  const stylesheet = fs.readFileSync(path.join(projectRoot, "src/content.css"), "utf8");
  assert.doesNotMatch(stylesheet, /gprf-lifecycle\[open\][^{]*gprf-chevron/);
  assert.match(stylesheet, /\.gprf-menu-opening[\s\S]*animation: gprf-menu-open 120ms/);
  assert.match(stylesheet, /\.gprf-menu-closing[\s\S]*animation: gprf-menu-close 120ms/);
  assert.match(stylesheet, /@keyframes gprf-menu-open/);
  assert.match(stylesheet, /@keyframes gprf-menu-close/);
  assert.match(stylesheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none;/);
});

test("active count remains visible while the lifecycle menu is expanded", () => {
  const stylesheet = fs.readFileSync(path.join(projectRoot, "src/content.css"), "utf8");
  assert.doesNotMatch(stylesheet, /gprf-lifecycle\[open\][^{]*gprf-summary-count/);
});

test("every packaged script, stylesheet, and icon exists", () => {
  const packagedFiles = [
    ...manifest.content_scripts.flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
    ...(manifest.background.scripts ?? []),
    ...(manifest.background.service_worker ? [manifest.background.service_worker] : []),
    ...Object.values(manifest.icons)
  ];

  for (const packagedFile of packagedFiles) {
    assert.equal(
      fs.existsSync(path.join(builtRoot, packagedFile)),
      true,
      `${packagedFile} should exist`
    );
  }
  for (const root of [builtRoot, firefoxRoot]) {
    for (const obsolete of ["options.html", "src/options.js", "src/views.css"])
      assert.equal(fs.existsSync(path.join(root, obsolete)), false, `${obsolete} is not packaged`);
  }
  const firefoxFiles = [
    ...firefoxManifest.content_scripts.flatMap((entry) => [
      ...(entry.js || []),
      ...(entry.css || [])
    ]),
    ...(firefoxManifest.background.scripts ?? []),
    ...Object.values(firefoxManifest.icons)
  ];
  for (const packagedFile of firefoxFiles) {
    assert.equal(
      fs.existsSync(path.join(firefoxRoot, packagedFile)),
      true,
      `${packagedFile} should exist in Firefox output`
    );
  }
  for (const sharedFile of [
    "src/background.js",
    "src/bootstrap.js",
    "src/content.js",
    "src/content.css",
    "src/views-menu.css",
    "src/views-editor.css"
  ]) {
    assert.deepEqual(
      fs.readFileSync(path.join(builtRoot, sharedFile)),
      fs.readFileSync(path.join(firefoxRoot, sharedFile)),
      `${sharedFile} should be identical in both browser outputs`
    );
  }
});
