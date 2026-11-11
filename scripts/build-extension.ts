import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { manifestForBrowser, type ExtensionManifest } from "./package-release";

const ROOT = path.resolve(import.meta.dir, "..");
export const OUTPUT_ROOT = path.join(ROOT, "dist", "extension");
export const FIREFOX_OUTPUT_ROOT = path.join(ROOT, "dist", "extension-firefox");

export async function buildExtension(): Promise<string> {
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  rmSync(FIREFOX_OUTPUT_ROOT, { recursive: true, force: true });
  mkdirSync(path.join(OUTPUT_ROOT, "src"), { recursive: true });

  const result = await Bun.build({
    entrypoints: [
      path.join(ROOT, "src", "bootstrap.ts"),
      path.join(ROOT, "src", "content.ts"),
      path.join(ROOT, "src", "background.ts")
    ],
    outdir: path.join(OUTPUT_ROOT, "src"),
    target: "browser",
    check: true,
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

  cpSync(path.join(ROOT, "src", "content.css"), path.join(OUTPUT_ROOT, "src", "content.css"));
  cpSync(path.join(ROOT, "src", "views-menu.css"), path.join(OUTPUT_ROOT, "src", "views-menu.css"));
  cpSync(
    path.join(ROOT, "src", "views-editor.css"),
    path.join(OUTPUT_ROOT, "src", "views-editor.css")
  );
  cpSync(path.join(OUTPUT_ROOT, "src"), path.join(FIREFOX_OUTPUT_ROOT, "src"), {
    recursive: true
  });
  for (const runtimeRoot of [OUTPUT_ROOT, FIREFOX_OUTPUT_ROOT]) {
    for (const runtimePath of ["LICENSE", "PRIVACY.md", "assets"]) {
      cpSync(path.join(ROOT, runtimePath), path.join(runtimeRoot, runtimePath), {
        recursive: true
      });
    }
  }
  const sourceManifest = JSON.parse(
    readFileSync(path.join(ROOT, "manifest.json"), "utf8")
  ) as ExtensionManifest;
  for (const [browser, runtimeRoot] of [
    ["chromium", OUTPUT_ROOT],
    ["firefox", FIREFOX_OUTPUT_ROOT]
  ] as const) {
    writeFileSync(
      path.join(runtimeRoot, "manifest.json"),
      `${JSON.stringify(manifestForBrowser(sourceManifest, browser), null, 2)}\n`
    );
  }

  return OUTPUT_ROOT;
}

if (import.meta.main) {
  buildExtension().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
