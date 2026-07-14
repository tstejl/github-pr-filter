"use strict";

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_PATHS = ["LICENSE", "PRIVACY.md", "assets", "src"];
const VERSION_PATTERN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){1,3}$/;

function validateVersion(manifestVersion, packageVersion, requestedVersion) {
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

function manifestForBrowser(manifest, browser) {
  const output = structuredClone(manifest);
  if (browser === "chromium") {
    delete output.browser_specific_settings;
  } else if (browser !== "firefox") {
    throw new Error(`Unsupported release browser: ${browser}`);
  }
  return output;
}

function packageName(browser, version) {
  return `github-pr-filter-v${version}-${browser}.zip`;
}

function stageBrowser(browser, manifest, stagingRoot) {
  const browserRoot = path.join(stagingRoot, browser);
  mkdirSync(browserRoot, { recursive: true });
  for (const runtimePath of RUNTIME_PATHS) {
    cpSync(path.join(ROOT, runtimePath), path.join(browserRoot, runtimePath), { recursive: true });
  }
  writeFileSync(
    path.join(browserRoot, "manifest.json"),
    `${JSON.stringify(manifestForBrowser(manifest, browser), null, 2)}\n`
  );
  return browserRoot;
}

function runWebExt(sourceDir, artifactsDir, filename) {
  const webExt = path.join(ROOT, "node_modules", ".bin", "web-ext");
  const result = spawnSync(webExt, [
    "build",
    "--source-dir", sourceDir,
    "--artifacts-dir", artifactsDir,
    "--filename", filename,
    "--overwrite-dest",
    "--no-config-discovery"
  ], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `web-ext exited with ${result.status}`);
  }
}

function checksum(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function buildRelease({ requestedVersion = process.env.RELEASE_VERSION } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = validateVersion(manifest.version, packageJson.version, requestedVersion);
  const releaseRoot = path.join(ROOT, "dist", "releases");
  const stagingRoot = path.join(ROOT, "dist", "release-staging");

  rmSync(releaseRoot, { recursive: true, force: true });
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(releaseRoot, { recursive: true });

  const artifacts = [];
  try {
    for (const browser of ["chromium", "firefox"]) {
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

if (require.main === module) {
  try {
    const result = buildRelease();
    for (const artifact of result.artifacts) {
      console.log(path.relative(ROOT, artifact));
    }
    console.log(path.relative(ROOT, path.join(result.releaseRoot, "SHA256SUMS")));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildRelease,
  manifestForBrowser,
  packageName,
  validateVersion
};
