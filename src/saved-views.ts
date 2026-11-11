import { viewQueryKey } from "./query-predicates";
export { viewQueryKey } from "./query-predicates";
import { LIFECYCLE_OPTIONS } from "./lifecycle-options";
import type { Lifecycle } from "./lifecycle";
import { OCTICONS, type OcticonName } from "./octicons";
import type { LifecycleLayout } from "./lifecycle-layout";

export interface SavedView {
  type: "view";
  id: string;
  name: string;
  description: string;
  query: string;
  icon: OcticonName;
  visible: boolean;
  destination: "repository" | "dashboard";
  builtin?: Lifecycle;
}
export interface ViewDivider {
  type: "divider";
  id: string;
  builtin?: boolean;
}
export type ViewEntry = SavedView | ViewDivider;
export interface ViewLayout {
  version: 1;
  entries: ViewEntry[];
}
export interface ScopedView {
  scope: string;
  view: SavedView;
}

export const VIEW_ICONS: readonly { name: OcticonName; label: string }[] = [
  { name: "gitPullRequest", label: "Pull request" },
  { name: "codeReview", label: "Review" },
  { name: "checkCircle", label: "Ready" },
  { name: "gitPullRequestDraft", label: "Draft" },
  { name: "gitMerge", label: "Merged" },
  { name: "gitPullRequestClosed", label: "Closed" },
  { name: "archive", label: "Archive" },
  { name: "listUnordered", label: "List" },
  { name: "eye", label: "Watch" },
  { name: "filter", label: "Filter" },
  { name: "sync", label: "Sync" },
  { name: "check", label: "Check" }
];

const DEFAULT_QUERIES: Record<Lifecycle, string> = {
  all: "is:pr",
  open: "is:pr state:open",
  ready: "is:pr state:open draft:false",
  needs_review: "is:pr state:open draft:false review:required",
  draft: "is:pr state:open draft:true",
  closed: "is:pr state:closed",
  merged: "is:pr is:merged",
  closed_unmerged: "is:pr state:closed is:unmerged"
};

export function normalizeViewRepository(value: string): string | null {
  return /^[a-z\d][a-z\d.-]*\/[a-z\d_.-]+$/iu.test(value) ? value.toLowerCase() : null;
}

export function createDefaultViewLayout(): ViewLayout {
  const entries: ViewEntry[] = [];
  for (const option of LIFECYCLE_OPTIONS) {
    if (option.startsSection && entries.length)
      entries.push({ type: "divider", id: `divider-${option.value}`, builtin: true });
    entries.push({
      type: "view",
      id: `builtin-${option.value}`,
      name: option.label,
      description: option.description,
      query: DEFAULT_QUERIES[option.value],
      icon: option.icon,
      visible: true,
      destination: "repository",
      builtin: option.value
    });
  }
  return { version: 1, entries };
}

export function migrateLifecycleLayout(layout: LifecycleLayout): ViewLayout {
  const defaults = createDefaultViewLayout();
  return {
    version: 1,
    entries: layout.entries.flatMap((entry, index): ViewEntry[] => {
      if (entry.type === "divider") return [{ type: "divider", id: `legacy-divider-${index}` }];
      const view = defaults.entries.find(
        (candidate): candidate is SavedView =>
          candidate.type === "view" && candidate.builtin === entry.value
      );
      return view ? [{ ...view, visible: entry.visible }] : [];
    })
  };
}

export function parseViewLayout(value: unknown): ViewLayout | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.entries) ||
    candidate.entries.length > 500
  )
    return null;
  const ids = new Set<string>();
  const entries: ViewEntry[] = [];
  for (const raw of candidate.entries) {
    if (!raw || typeof raw !== "object") return null;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== "string" || !/^[\w-]{1,100}$/u.test(entry.id) || ids.has(entry.id))
      return null;
    ids.add(entry.id);
    if (entry.type === "divider") {
      if (entry.builtin !== undefined && typeof entry.builtin !== "boolean") return null;
      entries.push({
        type: "divider",
        id: entry.id,
        ...(entry.builtin === true ? { builtin: true } : {})
      });
      continue;
    }
    if (
      entry.type !== "view" ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      entry.name.length > 100 ||
      typeof entry.query !== "string" ||
      !entry.query.trim() ||
      entry.query.length > 8000 ||
      typeof entry.description !== "string" ||
      entry.description.length > 250 ||
      typeof entry.visible !== "boolean" ||
      (entry.destination !== "repository" && entry.destination !== "dashboard") ||
      typeof entry.icon !== "string" ||
      !Object.hasOwn(OCTICONS, entry.icon)
    )
      return null;
    const builtin = LIFECYCLE_OPTIONS.find((option) => option.value === entry.builtin)?.value;
    if (entry.builtin !== undefined && !builtin) return null;
    entries.push({
      type: "view",
      id: entry.id,
      name: entry.name,
      description: entry.description,
      query: entry.query,
      icon: entry.icon as OcticonName,
      visible: entry.visible,
      destination: entry.destination,
      ...(builtin ? { builtin } : {})
    });
  }
  return { version: 1, entries };
}

/** Hide redundant separators without changing the saved order. */
export function visibleViewEntries(layout: ViewLayout): ViewEntry[] {
  const result: ViewEntry[] = [];
  let pending: ViewDivider | null = null;
  for (const entry of layout.entries) {
    if (entry.type === "divider") {
      pending = result.length ? entry : null;
      continue;
    }
    if (!entry.visible) continue;
    if (pending) result.push(pending);
    result.push(entry);
    pending = null;
  }
  return result;
}

export function matchSavedView(
  query: string,
  candidates: readonly ScopedView[],
  destination: SavedView["destination"] = "repository"
): ScopedView | null {
  const comparable = query.trim() || DEFAULT_QUERIES.open;
  const eligible = candidates.filter(({ view }) => view.destination === destination);
  const exact = eligible.find(({ view }) => view.query.trim() === comparable);
  if (exact) return exact;
  const key = viewQueryKey(comparable);
  return eligible.find(({ view }) => viewQueryKey(view.query) === key) ?? null;
}

export function viewDestinationUrl(
  view: SavedView,
  repository: string | null,
  pageUrl?: string
): string | null {
  if (view.destination === "repository" && (!repository || !normalizeViewRepository(repository)))
    return null;
  const target = new URL(
    view.destination === "dashboard" ? "/pulls" : `/${repository}/pulls`,
    "https://github.com"
  );
  // Preserve GitHub's page-local display preferences, while replacing the complete query.
  if (pageUrl && view.destination === "repository") {
    const current = new URL(pageUrl);
    if (
      current.origin === target.origin &&
      current.pathname.replace(/\/$/u, "") === target.pathname
    ) {
      for (const [key, value] of current.searchParams)
        if (!["q", "query", "page", "after", "before", "cursor"].includes(key))
          target.searchParams.append(key, value);
    }
  }
  target.searchParams.set("q", view.query);
  return target.href;
}
