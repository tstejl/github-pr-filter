import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type SpecCatalogEntry =
  | { file: string; status: "active"; register: string }
  | { file: string; status: "retired"; reason: string; replacements: readonly string[] };

const ROOT = path.resolve(import.meta.dir, "..");
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function relativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.startsWith("../") &&
    path.posix.normalize(value) === value
  );
}

/** Audit declarations against the files on disk, not an independent allowlist. */
export function validateSpecCatalog(
  value: unknown,
  modules: ReadonlyMap<string, string>,
  fileExists: (file: string) => boolean
): SpecCatalogEntry[] {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.specs))
    throw new Error("E2E catalog must contain version: 1 and a specs array.");
  const entries: SpecCatalogEntry[] = [];
  const seen = new Set<string>();
  const scanner = new Bun.Transpiler({ loader: "ts" });
  for (const raw of value.specs) {
    if (
      !record(raw) ||
      !relativePath(raw.file) ||
      !raw.file.endsWith(".ts") ||
      raw.file.endsWith(".d.ts")
    )
      throw new Error("Each E2E catalog entry needs a relative .ts spec path.");
    const file = raw.file;
    if (seen.has(file)) throw new Error(`Duplicate E2E catalog entry: ${file}`);
    seen.add(file);
    const source = modules.get(file);
    if (source === undefined) throw new Error(`E2E catalog references a missing spec: ${file}`);
    if (raw.status === "active") {
      if (typeof raw.register !== "string" || !/^[A-Za-z_$][\w$]*$/u.test(raw.register))
        throw new Error(`Active E2E spec needs a registrar export: ${file}`);
      if (Object.hasOwn(raw, "reason") || Object.hasOwn(raw, "replacements"))
        throw new Error(`Active E2E spec cannot carry retirement metadata: ${file}`);
      if (!scanner.scan(source).exports.includes(raw.register))
        throw new Error(`Active E2E spec ${file} does not export ${raw.register}.`);
      entries.push({ file, status: "active", register: raw.register });
    } else if (raw.status === "retired") {
      if (typeof raw.reason !== "string" || !raw.reason.trim())
        throw new Error(`Retired E2E spec needs a reason: ${file}`);
      if (Object.hasOwn(raw, "register"))
        throw new Error(`Retired E2E spec cannot have an active registrar: ${file}`);
      if (
        !Array.isArray(raw.replacements) ||
        !raw.replacements.every(
          (item): item is string =>
            relativePath(item) &&
            /^(?:e2e\/specs\/|test\/|visual\/)/u.test(item) &&
            item.endsWith(".ts") &&
            fileExists(item)
        )
      )
        throw new Error(
          `Retired E2E spec needs existing replacement test paths (or [] for removed behavior): ${file}`
        );
      entries.push({
        file,
        status: "retired",
        reason: raw.reason.trim(),
        replacements: [...raw.replacements]
      });
    } else throw new Error(`E2E spec must be active or retired: ${file}`);
  }
  const orphans = [...modules.keys()].filter((file) => !seen.has(file));
  if (orphans.length)
    throw new Error(
      `Unregistered E2E specs: ${orphans.join(", ")}. Add active entries or retire them with a reason in e2e/spec-catalog.json.`
    );
  if (!entries.some((entry) => entry.status === "active"))
    throw new Error("E2E catalog must include at least one active spec.");
  for (const entry of entries) {
    if (entry.status !== "retired") continue;
    for (const replacement of entry.replacements) {
      if (
        replacement.startsWith("e2e/specs/") &&
        !entries.some(
          (candidate) =>
            candidate.file === replacement.slice("e2e/specs/".length) &&
            candidate.status === "active"
        )
      )
        throw new Error(
          `Retired E2E spec ${entry.file} points to inactive replacement coverage: ${replacement}`
        );
    }
  }
  return entries;
}

export function auditE2ESpecs(root = ROOT): SpecCatalogEntry[] {
  const directory = path.join(root, "e2e", "specs");
  const modules = new Map<string, string>();
  function discover(relative = ""): void {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink())
        throw new Error(`E2E spec discovery does not follow symlinks: ${file}`);
      if (entry.isDirectory()) discover(file);
      else if (/\.(?:[cm]?[jt]sx?)$/u.test(file)) {
        if (!entry.isFile() || !file.endsWith(".ts") || file.endsWith(".d.ts"))
          throw new Error(`E2E specs must be .ts modules; move helpers to e2e/harness: ${file}`);
        modules.set(file, readFileSync(path.join(directory, file), "utf8"));
      }
    }
  }
  discover();
  const runner = readFileSync(path.join(root, "e2e/lifecycle.e2e.ts"), "utf8");
  const imports = new Bun.Transpiler({ loader: "ts" }).scan(runner).imports;
  if (!imports.some((entry) => entry.path.replace(/\.ts$/u, "") === "./harness/spec-registration"))
    throw new Error(
      "The E2E entrypoint must use the audited spec-registration loader, not manual spec imports."
    );
  const catalog: unknown = JSON.parse(
    readFileSync(path.join(root, "e2e", "spec-catalog.json"), "utf8")
  );
  return validateSpecCatalog(catalog, modules, (file) => existsSync(path.join(root, file)));
}

if (import.meta.main) {
  try {
    const entries = auditE2ESpecs();
    const active = entries.filter((entry) => entry.status === "active").length;
    console.log(
      `E2E registration valid: ${active} active, ${entries.length - active} explicitly retired; ${entries.length} modules audited.`
    );
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
