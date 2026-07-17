import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type BrowserFlavor = "chromium" | "firefox";

export interface ExtensionManifest {
  manifest_version: number;
  version: string;
  browser_specific_settings?: {
    gecko?: {
      id?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface BuildReleaseOptions {
  requestedVersion?: string;
}

interface BuildReleaseResult {
  version: string;
  releaseRoot: string;
  artifacts: string[];
}

const ROOT = path.resolve(import.meta.dir, "..");
const RUNTIME_ROOT = path.join(ROOT, "dist", "extension");
const RUNTIME_PATHS = ["LICENSE", "PRIVACY.md", "assets", "src"] as const;
const VERSION_PATTERN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){1,3}$/;

function parseJsonObject(source: string, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function parseManifest(source: string): ExtensionManifest {
  const value = parseJsonObject(source, "manifest.json");
  if (typeof value.manifest_version !== "number" || typeof value.version !== "string") {
    throw new Error(
      "manifest.json must contain numeric manifest_version and string version fields."
    );
  }
  return value as ExtensionManifest;
}

function parsePackageVersion(source: string): string {
  const value = parseJsonObject(source, "package.json");
  if (typeof value.version !== "string") {
    throw new Error("package.json must contain a string version field.");
  }
  return value.version;
}

export function validateVersion(
  manifestVersion: string,
  packageVersion: string,
  requestedVersion?: string
): string {
  if (!VERSION_PATTERN.test(manifestVersion)) {
    throw new Error(`Unsupported manifest version: ${manifestVersion}`);
  }
  if (manifestVersion !== packageVersion) {
    throw new Error(
      `Version mismatch: manifest.json is ${manifestVersion}, package.json is ${packageVersion}`
    );
  }
  if (requestedVersion && requestedVersion !== manifestVersion) {
    throw new Error(
      `Requested release ${requestedVersion} does not match manifest version ${manifestVersion}`
    );
  }
  return manifestVersion;
}

export function manifestForBrowser(
  manifest: ExtensionManifest,
  browser: BrowserFlavor
): ExtensionManifest {
  const output = structuredClone(manifest);
  if (browser === "chromium") {
    delete output.browser_specific_settings;
  }
  return output;
}

export function packageName(browser: BrowserFlavor, version: string): string {
  return `github-pr-filter-v${version}-${browser}.zip`;
}

function stageBrowser(
  browser: BrowserFlavor,
  manifest: ExtensionManifest,
  stagingRoot: string
): string {
  const browserRoot = path.join(stagingRoot, browser);
  mkdirSync(browserRoot, { recursive: true });
  for (const runtimePath of RUNTIME_PATHS) {
    cpSync(path.join(RUNTIME_ROOT, runtimePath), path.join(browserRoot, runtimePath), {
      recursive: true
    });
  }
  writeFileSync(
    path.join(browserRoot, "manifest.json"),
    `${JSON.stringify(manifestForBrowser(manifest, browser), null, 2)}\n`
  );
  return browserRoot;
}

function runWebExt(sourceDir: string, artifactsDir: string, filename: string): void {
  const webExt = path.join(ROOT, "node_modules", ".bin", "web-ext");
  const result = spawnSync(
    webExt,
    [
      "build",
      "--source-dir",
      sourceDir,
      "--artifacts-dir",
      artifactsDir,
      "--filename",
      filename,
      "--overwrite-dest",
      "--no-config-discovery"
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `web-ext exited with ${result.status}`);
  }
}

function checksum(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function buildRelease({
  requestedVersion = process.env.RELEASE_VERSION
}: BuildReleaseOptions = {}): BuildReleaseResult {
  const manifest = parseManifest(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const packageVersion = parsePackageVersion(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = validateVersion(manifest.version, packageVersion, requestedVersion);
  const releaseRoot = path.join(ROOT, "dist", "releases");
  const stagingRoot = path.join(ROOT, "dist", "release-staging");

  rmSync(releaseRoot, { recursive: true, force: true });
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(releaseRoot, { recursive: true });

  const artifacts: string[] = [];
  try {
    for (const browser of ["chromium", "firefox"] as const) {
      const filename = packageName(browser, version);
      const sourceDir = stageBrowser(browser, manifest, stagingRoot);
      runWebExt(sourceDir, releaseRoot, filename);
      artifacts.push(path.join(releaseRoot, filename));
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }

  const checksumLines = artifacts
    .map((artifact) => `${checksum(artifact)}  ${path.basename(artifact)}`)
    .join("\n");
  writeFileSync(path.join(releaseRoot, "SHA256SUMS"), `${checksumLines}\n`);

  return { version, releaseRoot, artifacts };
}

if (import.meta.main) {
  try {
    const result = buildRelease();
    for (const artifact of result.artifacts) {
      console.log(path.relative(ROOT, artifact));
    }
    console.log(path.relative(ROOT, path.join(result.releaseRoot, "SHA256SUMS")));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
