import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditE2ESpecs, type SpecCatalogEntry } from "../../scripts/check-e2e-registration";
import type { E2ETestContext } from "./contracts";

type SpecLoader = (file: string) => Promise<Record<string, unknown>>;

/** The audited catalog also drives execution, so active does not merely mean listed. */
export async function registerCatalogSpecs(
  entries: readonly SpecCatalogEntry[],
  context: E2ETestContext,
  load: SpecLoader
): Promise<void> {
  const modules = await Promise.all(
    entries.flatMap((entry) =>
      entry.status === "active" ? [load(entry.file).then((module) => ({ entry, module }))] : []
    )
  );
  for (const { entry, module } of modules) {
    const registrar = module[entry.register];
    if (typeof registrar !== "function")
      throw new Error(`E2E spec ${entry.file} must export callable ${entry.register}.`);
    (registrar as (context: E2ETestContext) => void)(context);
  }
}

export async function registerE2ESpecs(context: E2ETestContext): Promise<void> {
  const root = path.resolve(import.meta.dir, "../..");
  await registerCatalogSpecs(auditE2ESpecs(root), context, async (file) => {
    const module: unknown = await import(pathToFileURL(path.join(root, "e2e/specs", file)).href);
    return module as Record<string, unknown>;
  });
}
