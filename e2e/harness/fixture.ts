import { readFileSync } from "node:fs";
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
// Exact user-supplied header capture from the signed-in GitHub preview, September 2026.
const CAPTURED_PREVIEW_HEADER = readFileSync(
  path.join(ROOT, "e2e/fixtures/github-preview-status-header.html.txt"),
  "utf8"
);

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
    mode === "no-state-groups" ||
    mode === "preview-captured-checkbox" ||
    mode === "preview-captured" ||
    mode === "preview-captured-no-main" ||
    mode === "preview" ||
    mode === "preview-hydration"
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
  const classicHydrationScript =
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

  const previewReadyCount = queryHasTerm(rawQuery, "draft:false") ? 8 : 10;
  const previewClosedCount = queryHasTerm(rawQuery, "draft:false") ? 737 : 747;
  const previewResultCount = queryHasTerm(rawQuery, "gprf-no-match-928471")
    ? "0"
    : queryHasTerm(rawQuery, "is:merged")
      ? "700"
      : "757";
  const previewUsesResults =
    queryHasTerm(rawQuery, "is:merged") || rawQuery.trim().toLowerCase() === "is:pr";
  const previewStatusMarkup = `<div data-fixture-preview-status>
          <button type="button" aria-pressed="${queryHasTerm(rawQuery, "is:open") ? "true" : "false"}">Open <span>${previewReadyCount}</span></button>
          <button type="button" aria-pressed="${queryHasTerm(rawQuery, "is:closed") ? "true" : "false"}">Closed <span>${previewClosedCount}</span></button>
        </div>`;
  const previewResultMarkup = `<div data-fixture-preview-results>
          <h2 data-fixture-result-heading>${previewResultCount} results</h2>
        </div>`;
  const previewInitialMarkup =
    mode === "preview-hydration" && previewUsesResults
      ? `<div data-fixture-preview-results>
          <h2 data-fixture-result-heading>Loading results</h2>
        </div>`
      : previewUsesResults
        ? previewResultMarkup
        : previewStatusMarkup;
  // Modeled from the supplied screenshots and live accessibility tree, not captured DOM.
  const previewMarkup = `<main data-fixture-page="preview">
      <form role="search" action="/octocat/hello-world/pulls?_fixture=${mode}" method="get">
        <input aria-label="Search all issues" name="q" type="search" value="${query}">
        <input type="hidden" name="_fixture" value="${mode}">
      </form>
      <section data-fixture-preview-region>
        <h2 data-fixture-preview-title>Pull requests</h2>
        <div data-fixture-preview-header>
          ${previewInitialMarkup}
          <div data-fixture-preview-tools>
            <div role="toolbar" aria-label="Pull request filters">
              <button type="button">Author</button>
              <button type="button">Label</button>
            </div>
            <button type="button">Newest</button>
          </div>
        </div>
        <ul aria-label="Pull requests">
          <li>Fixture pull request</li>
        </ul>
      </section>
      <button type="button" data-fixture-transition-results>Replace header with results</button>
      <button type="button" data-fixture-transition-status>Replace header with status</button>
      <button type="button" data-fixture-update-results onclick="document.querySelector('[data-fixture-result-heading]').firstChild.data = '757 results'">Update fixture results</button>
      <section data-fixture-unrelated-results>
        <h2>747 results</h2>
      </section>
    </main>`;
  const previewHydrationScript =
    mode === "preview-hydration" && previewUsesResults
      ? `<script>
          setTimeout(() => {
            const heading = document.querySelector('[data-fixture-result-heading]');
            if (heading) {
              heading.textContent = ${JSON.stringify(`${previewResultCount} results`)};
            }
          }, 700);
        </script>`
      : "";

  // Only the header is captured; wrappers below exercise both host element types.
  const capturedPreview = `<${mode === "preview-captured" ? "main" : "div"}>
    <form role="search"><input aria-label="Search pull requests" name="q" type="search" value="${query}"></form>
    ${mode === "preview-captured-checkbox" ? CAPTURED_PREVIEW_HEADER.replace('class="Metadata-module__container__epfvu">', 'class="Metadata-module__container__epfvu"><input type="checkbox" aria-label="Select all pull requests">') : CAPTURED_PREVIEW_HEADER}
  </${mode === "preview-captured" ? "main" : "div"}>`;

  return `<!doctype html>
<html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark">
  <head>
    <meta charset="utf-8">
    <title>Pull requests</title>
    <script>
      (() => {
        let probeFrames = 0;
        let preMountFrames = 0;
        let menuAnimationStarts = 0;
        document.addEventListener("animationstart", (event) => {
          if (event.animationName !== "gprf-menu-open") {
            return;
          }
          menuAnimationStarts += 1;
          document.documentElement.setAttribute(
            "data-gprf-menu-animation-starts",
            String(menuAnimationStarts)
          );
        });
        const sample = () => {
          const control = document.querySelector(".gprf-lifecycle");
          const nativeLinks = [
            ...document.querySelectorAll(".table-list-header-toggle.states > a.btn-link, [data-fixture-preview-status] > button, [data-fixture-result-heading], [id$='-list-view-metadata'] > a")
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
              style.clipPath !== "inset(50%)" &&
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
    ${
      mode === "preview-captured-checkbox" ||
      mode === "preview-captured" ||
      mode === "preview-captured-no-main"
        ? capturedPreview
        : mode === "preview" || mode === "preview-hydration"
          ? previewMarkup
          : `${outsideMainGroup}
    ${outsideMainSearch}
    <main>
      ${searchForms}
      <a class="js-clear-search" href="/octocat/hello-world/pulls">
        Clear current search query, filters, and sorts
      </a>
      ${stateGroups}
      <div id="repo-content">Fixture pull requests</div>
    </main>
    ${classicHydrationScript}`
    }
    ${previewHydrationScript}
    <script>
      for (const kind of ["results", "status"]) {
        document.querySelector('[data-fixture-transition-' + kind + ']')?.addEventListener('click', () => {
          const url = new URL(location.href);
          url.searchParams.set('q', kind === 'results' ? 'is:pr is:merged label:bug' : 'is:pr is:open label:bug');
          history.replaceState({}, '', url);
          const slot = document.querySelector('[data-fixture-preview-status], [data-fixture-preview-results]');
          slot.outerHTML = kind === 'results'
            ? '<div data-fixture-preview-results><h2 data-fixture-result-heading>Loading results</h2></div>'
            : '<div data-fixture-preview-status><button>Open <span>10</span></button><button>Closed <span>747</span></button></div>';
          if (kind === 'results') setTimeout(() => {
            document.querySelector('[data-fixture-result-heading]').firstChild.data = '700 results';
          }, 700);
        });
      }
    </script>
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
