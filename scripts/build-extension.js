"use strict";

const { cpSync, mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_ROOT = path.join(ROOT, "dist", "extension");

async function buildExtension() {
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  mkdirSync(path.join(OUTPUT_ROOT, "src"), { recursive: true });

  const result = await Bun.build({
    entrypoints: [
      path.join(ROOT, "src", "bootstrap.ts"),
      path.join(ROOT, "src", "content.ts")
    ],
    outdir: path.join(OUTPUT_ROOT, "src"),
    target: "browser",
    format: "iife",
    naming: "[name].[ext]",
    minify: false,
    sourcemap: "none"
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error("Bun failed to build the extension.");
  }

  for (const runtimePath of ["LICENSE", "PRIVACY.md", "assets", "manifest.json"]) {
    cpSync(path.join(ROOT, runtimePath), path.join(OUTPUT_ROOT, runtimePath), { recursive: true });
  }
  cpSync(
    path.join(ROOT, "src", "content.css"),
    path.join(OUTPUT_ROOT, "src", "content.css")
  );

  return OUTPUT_ROOT;
}

if (require.main === module) {
  buildExtension().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { buildExtension, OUTPUT_ROOT };
