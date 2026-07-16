import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
export const OUTPUT_ROOT = path.join(ROOT, "dist", "extension");

export async function buildExtension(): Promise<string> {
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

if (import.meta.main) {
  buildExtension().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
