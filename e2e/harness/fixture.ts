import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  BrowserName,
  FixturePageMode,
  FixturePageOptions,
  FixtureServer,
  PreparedExtension
} from "./contracts";

interface NativeHeaderFixture {
  kind: "partitioned" | "total";
  selected?: "open" | "closed" | null;
}

interface NativeHeaderRule {
  matches: (query: string) => boolean;
  fixture: NativeHeaderFixture;
}

export interface PrepareExtensionOptions {
  contentMode?: "complete" | "bootstrap-only";
  interactiveDelayMs?: number;
}

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dir, "../..");

function queryHasTerm(query: string, term: string): boolean {
  const normalizedTerm = term.toLowerCase();
  return query
    .trim()
    .split(/\s+/)
    .some((candidate) => candidate.toLowerCase() === normalizedTerm);
}

// These rules describe only the fake GitHub responses exercised by this suite.
// They intentionally do not import or mirror the extension's lifecycle analyzer.
const NATIVE_HEADER_RULES: readonly NativeHeaderRule[] = [
  {
    matches: (query) => queryHasTerm(query, "is:merged"),
    fixture: { kind: "total" }
  },
  {
    matches: (query) => query.trim().toLowerCase() === "is:pr is:unmerged",
    fixture: { kind: "total" }
  },
  {
    matches: (query) => queryHasTerm(query, "is:closed") || queryHasTerm(query, "state:closed"),
    fixture: { kind: "partitioned", selected: "closed" }
  },
  {
    matches: (query) => queryHasTerm(query, "is:open") || queryHasTerm(query, "state:open"),
    fixture: { kind: "partitioned", selected: "open" }
  }
];

function nativeHeaderFixture(query: string): NativeHeaderFixture {
  return (
    NATIVE_HEADER_RULES.find((rule) => rule.matches(query))?.fixture ?? {
      kind: "partitioned",
      selected: null
    }
  );
}

function fixturePageMode(url: URL): FixturePageMode {
  const mode = url.searchParams.get("_fixture");
  if (
    mode === "decoy-state-group" ||
    mode === "duplicate-search-inputs" ||
    mode === "partial-status-hydration" ||
    mode === "responsive-groups" ||
    mode === "open-selected-all" ||
    mode === "no-state-groups"
  ) {
    return mode;
  }
  return "default";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fixturePage(requestUrl: string): string {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const mode = fixturePageMode(url);
  const rawQuery = url.searchParams.get("q") || "is:pr is:open";
  const query = escapeHtml(rawQuery);
  const nativeHeader =
    mode === "open-selected-all"
      ? ({ kind: "partitioned", selected: "open" } satisfies NativeHeaderFixture)
      : nativeHeaderFixture(rawQuery);
  const nativeStatusLinks =
    nativeHeader.kind === "total"
      ? `<a class="btn-link selected" data-turbo-frame="repo-content" href="/octocat/hello-world/pulls?q=${encodeURIComponent(rawQuery)}">4 Total</a>`
      : `<a class="btn-link${nativeHeader.selected === "open" ? " selected" : ""}" data-turbo-frame="repo-content" href="/octocat/hello-world/pulls?q=is%3Apr+is%3Aopen">3 Open</a>
        <a class="btn-link${nativeHeader.selected === "closed" ? " selected" : ""}" data-turbo-frame="repo-content" href="/octocat/hello-world/pulls?q=is%3Apr+is%3Aclosed">2 Closed</a>`;
  const stateGroup = (fixtureName: string): string =>
    `<div class="table-list-header-toggle states" data-fixture-group="${fixtureName}">
        ${nativeStatusLinks}
      </div>`;
  const stateGroups =
    mode === "no-state-groups" || mode === "duplicate-search-inputs"
      ? ""
      : mode === "partial-status-hydration"
        ? `<div class="table-list-header-toggle states" data-fixture-group="partial">
            <a class="btn-link" href="/octocat/hello-world/issues">Loading open state</a>
            <a class="btn-link" href="/octocat/hello-world/issues">Loading closed state</a>
          </div>`
        : mode === "decoy-state-group"
          ? `<div class="table-list-header-toggle states" data-fixture-group="decoy">
            <a class="btn-link" href="/octocat/hello-world/issues?q=is%3Aopen">9 Open issues</a>
            <a class="btn-link" href="/octocat/hello-world/pulls?q=label%3Abug">7 Tagged</a>
          </div>`
          : mode === "responsive-groups"
            ? `${stateGroup("wide")}${stateGroup("narrow")}`
            : stateGroup("default");
  const outsideMainGroup = mode === "responsive-groups" ? stateGroup("stray") : "";
  const outsideMainSearch =
    mode === "duplicate-search-inputs"
      ? `<form role="search" action="/octocat/hello-world/pulls" method="get" data-fixture-search="committed">
          <input aria-label="Search all issues" name="q" type="search" value="${query}">
        </form>`
      : "";
  const searchForms =
    mode === "partial-status-hydration"
      ? ""
      : mode === "duplicate-search-inputs"
        ? `<form role="search" action="/octocat/hello-world/pulls" method="get" data-fixture-search="stale" style="display:none">
          <input aria-label="Search all issues" name="q" type="search" value="is:pr is:closed">
        </form>`
        : `<form role="search" action="/octocat/hello-world/pulls" method="get">
          <input aria-label="Search all issues" name="q" type="search" value="${query}">
        </form>`;
  const hydrationScript =
    mode === "partial-status-hydration"
      ? `<script>
          setTimeout(() => {
            const group = document.querySelector('[data-fixture-group="partial"]');
            if (group) {
              group.innerHTML = ${JSON.stringify(nativeStatusLinks)};
            }
          }, 750);
        </script>`
      : "";

  return `<!doctype html>
<html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark">
  <head>
    <meta charset="utf-8">
    <title>Pull requests</title>
    <script>
      (() => {
        let probeFrames = 0;
        let preMountFrames = 0;
        const sample = () => {
          const control = document.querySelector(".gprf-lifecycle");
          const nativeLinks = [
            ...document.querySelectorAll(".table-list-header-toggle.states > a.btn-link")
          ];
          probeFrames += 1;
          document.documentElement.setAttribute(
            "data-gprf-probe-frames",
            String(probeFrames)
          );
          if (!control && nativeLinks.length > 0) {
            preMountFrames += 1;
            document.documentElement.setAttribute(
              "data-gprf-pre-mount-frames",
              String(preMountFrames)
            );
          }
          const nativeVisible = nativeLinks.some((link) => {
            const style = getComputedStyle(link);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number.parseFloat(style.opacity || "1") > 0 &&
              link.getClientRects().length > 0
            );
          });
          if (nativeVisible) {
            document.documentElement.setAttribute("data-gprf-native-ever-visible", "true");
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      })();
    </script>
  </head>
  <body>
    ${outsideMainGroup}
    ${outsideMainSearch}
    <main>
      ${searchForms}
      <a class="js-clear-search" href="/octocat/hello-world/pulls">
        Clear current search query, filters, and sorts
      </a>
      ${stateGroups}
      <div id="repo-content">Fixture pull requests</div>
    </main>
    ${hydrationScript}
  </body>
</html>`;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixturePage(request.url ?? "/"));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/octocat/hello-world/pulls`;
  const urlFor = (options: FixturePageOptions = {}): string => {
    const url = new URL(baseUrl);
    if (options.query !== null) {
      url.searchParams.set("q", options.query ?? "is:pr is:open");
    }
    if (options.mode && options.mode !== "default") {
      url.searchParams.set("_fixture", options.mode);
    }
    return url.href;
  };
  return {
    url: urlFor(),
    urlFor,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}

export async function prepareExtension(
  browserName: BrowserName,
  options: PrepareExtensionOptions = {}
): Promise<PreparedExtension> {
  const root = await mkdtemp(path.join(os.tmpdir(), "github-pr-filter-e2e-"));
  const extensionDir = path.join(root, "extension");
  await mkdir(extensionDir);
  await cp(path.join(ROOT, "dist", "extension"), extensionDir, { recursive: true });

  const manifestPath = path.join(extensionDir, "manifest.json");
  const parsedManifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.ok(
    typeof parsedManifest === "object" &&
      parsedManifest !== null &&
      "content_scripts" in parsedManifest &&
      Array.isArray(parsedManifest.content_scripts),
    "Built manifest should contain content scripts"
  );
  const manifest = parsedManifest as {
    content_scripts: Array<{ matches: string[]; js?: string[]; run_at?: string }>;
  };
  if (options.contentMode === "bootstrap-only") {
    const originalLength = manifest.content_scripts.length;
    manifest.content_scripts = manifest.content_scripts.filter(
      (script) => script.run_at !== "document_end" && !script.js?.includes("content.js")
    );
    assert.ok(
      manifest.content_scripts.length < originalLength,
      "Bootstrap-only fixture should omit the interactive content script"
    );
  }
  if (options.interactiveDelayMs !== undefined) {
    assert.ok(
      Number.isFinite(options.interactiveDelayMs) && options.interactiveDelayMs >= 0,
      "Interactive delay should be a non-negative finite number"
    );
    const interactiveScript = manifest.content_scripts
      .flatMap((script) => script.js ?? [])
      .find((script) => script.endsWith("content.js"));
    assert.ok(interactiveScript, "Delayed fixture should include the interactive content script");
    const interactivePath = path.join(extensionDir, interactiveScript);
    const interactiveSource = await readFile(interactivePath, "utf8");
    await writeFile(
      interactivePath,
      `setTimeout(() => {\n${interactiveSource}\n}, ${options.interactiveDelayMs});\n`
    );
  }
  for (const script of manifest.content_scripts) {
    script.matches = ["http://127.0.0.1/*"];
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  let xpiPath = null;
  if (browserName === "firefox") {
    const artifactsDir = path.join(root, "artifacts");
    const webExt = path.join(ROOT, "node_modules", ".bin", "web-ext");
    await execFileAsync(webExt, [
      "build",
      "--source-dir",
      extensionDir,
      "--artifacts-dir",
      artifactsDir,
      "--overwrite-dest"
    ]);
    const artifact = (await readdir(artifactsDir)).find((name) => name.endsWith(".zip"));
    assert.ok(artifact, "web-ext should produce a Firefox package");
    xpiPath = path.join(artifactsDir, artifact);
  }

  return { root, extensionDir, xpiPath };
}
