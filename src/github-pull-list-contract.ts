import type { PullListQueryContext } from "./lifecycle-navigation";
import { analyzeLifecycleQuery, type LifecycleStatePartition } from "./lifecycle-query";
import { repositoryKeyFromPullListPath } from "./page-scope";

export interface CommittedSearchField {
  readonly name: string;
  readonly committedValue: string;
}

export interface StatusGroupCandidate<T> {
  readonly value: T;
  readonly connected: boolean;
  readonly withinMain: boolean;
  readonly capable: boolean;
}

export interface SearchFieldCandidate<T> {
  readonly value: T;
  readonly connected: boolean;
  readonly withinMain: boolean;
  readonly visible: boolean;
  readonly pullListForm: boolean;
}

export interface NativeStatusLink {
  readonly href: string;
  readonly text: string;
  readonly selected: boolean;
}

interface ParsedNativeCount {
  readonly label: string;
  readonly value: number | null;
}

type CountableStatePartition = Exclude<LifecycleStatePartition, "both" | "none">;

/**
 * GitHub commits a query either into the URL or into the server-rendered search
 * field. The URL wins when present. Callers should pass the input's
 * `defaultValue`, not its mutable `value`, so unsubmitted typing never changes
 * the extension's selected lifecycle.
 */
export function createCommittedQueryContext(
  pageUrl: string,
  searchField: CommittedSearchField | null
): PullListQueryContext {
  const searchParams = new URL(pageUrl).searchParams;
  for (const parameter of ["q", "query"] as const) {
    const urlQuery = searchParams.get(parameter);
    if (urlQuery !== null) {
      return {
        pageUrl,
        input: { source: urlQuery.trim() },
        queryParameter: parameter
      };
    }
  }

  const source = searchField?.committedValue.trim() ?? "";
  return {
    pageUrl,
    input: { source },
    queryParameter: searchField?.name === "query" ? "query" : "q"
  };
}

/**
 * GitHub can render separate responsive copies of the native state controls.
 * Keep every connected copy within `<main>` in DOM order so each breakpoint is
 * usable. Only fall back to out-of-main candidates when GitHub supplies no
 * scoped group at all.
 */
export function selectStatusGroups<T>(
  candidates: readonly StatusGroupCandidate<T>[]
): readonly T[] {
  const connected = candidates.filter((candidate) => candidate.connected && candidate.capable);
  const withinMain = connected.filter((candidate) => candidate.withinMain);
  return (withinMain.length > 0 ? withinMain : connected).map((candidate) => candidate.value);
}

/**
 * GitHub can leave stale or responsive search fields in the DOM. Prefer a
 * visible field owned by this repository's pull-list form, while retaining
 * conservative fallbacks for older GitHub markup.
 */
export function selectSearchField<T>(candidates: readonly SearchFieldCandidate<T>[]): T | null {
  const connected = candidates.filter((candidate) => candidate.connected);
  const preferWithinMain = (
    predicate: (candidate: SearchFieldCandidate<T>) => boolean
  ): SearchFieldCandidate<T> | undefined =>
    connected.find((candidate) => predicate(candidate) && candidate.withinMain) ??
    connected.find(predicate);
  const selected =
    preferWithinMain((candidate) => candidate.visible && candidate.pullListForm) ??
    preferWithinMain((candidate) => candidate.pullListForm) ??
    preferWithinMain((candidate) => candidate.visible) ??
    preferWithinMain(() => true);
  return selected?.value ?? null;
}

function parseNativeCount(text: string): ParsedNativeCount | null {
  const label = text
    .trim()
    .match(/[\p{Number}][\p{Number}\s.,]*/u)?.[0]
    .trim();
  if (!label) {
    return null;
  }
  const digits = label.replace(/[^0-9]/g, "");
  return { label, value: digits ? Number.parseInt(digits, 10) : null };
}

function partitionForNativeLink(link: NativeStatusLink, pageUrl: string): LifecycleStatePartition {
  const query = queryForNativeLink(link, pageUrl);
  return query === null ? "none" : analyzeLifecycleQuery({ source: query }).statePartition;
}

function queryForNativeLink(link: NativeStatusLink, pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(link.href, pageUrl);
  } catch {
    return null;
  }
  const queryParameter = url.searchParams.has("q")
    ? "q"
    : url.searchParams.has("query")
      ? "query"
      : null;
  return queryParameter === null ? "" : (url.searchParams.get(queryParameter) ?? "");
}

/**
 * A matching CSS class is not enough to replace a GitHub control. Require at
 * least one direct status link whose count and lifecycle partition we can
 * interpret, so changed or unrelated markup fails open.
 */
export function hasRecognizableNativeStatusLinks(
  links: readonly NativeStatusLink[],
  pageUrl: string
): boolean {
  let parsedPageUrl: URL;
  let pageRepository: string | null;
  try {
    parsedPageUrl = new URL(pageUrl);
    pageRepository = repositoryKeyFromPullListPath(parsedPageUrl.pathname);
  } catch {
    return false;
  }
  if (pageRepository === null) {
    return false;
  }

  return links.some((link) => {
    if (parseNativeCount(link.text) === null) {
      return false;
    }
    let linkUrl: URL;
    try {
      linkUrl = new URL(link.href, pageUrl);
    } catch {
      return false;
    }
    if (
      linkUrl.origin !== parsedPageUrl.origin ||
      repositoryKeyFromPullListPath(linkUrl.pathname) !== pageRepository
    ) {
      return false;
    }
    const source = queryForNativeLink(link, pageUrl);
    if (source === null || source.trim().length === 0) {
      return false;
    }
    const analysis = analyzeLifecycleQuery({ source });
    return analysis.resolution !== "unconstrained" && analysis.statePartition !== "none";
  });
}

/**
 * Resolve the number GitHub already calculated for the current filtered list.
 * Open/closed partitions reuse their matching native number. The unconstrained
 * All view adds both native counts instead of trusting GitHub's selected-link
 * styling, which can still emphasize Open for a neutral `is:pr` query.
 */
export function resolveNativeStatusCount(
  links: readonly NativeStatusLink[],
  statePartition: LifecycleStatePartition,
  pageUrl: string,
  locale?: string
): string | null {
  if (statePartition === "none") {
    return null;
  }

  for (const link of links) {
    if (
      !link.selected ||
      partitionForNativeLink(link, pageUrl) !== statePartition ||
      (statePartition === "both" && links.length > 1)
    ) {
      continue;
    }
    const selectedCount = parseNativeCount(link.text);
    if (selectedCount) {
      return selectedCount.label;
    }
  }

  const counts = new Map<CountableStatePartition, ParsedNativeCount>();
  for (const link of links) {
    const partition = partitionForNativeLink(link, pageUrl);
    if (partition !== "open" && partition !== "closed") {
      continue;
    }
    const count = parseNativeCount(link.text);
    if (count) {
      const current = counts.get(partition);
      if (!current || link.selected) {
        counts.set(partition, count);
      }
    }
  }

  if (statePartition === "both") {
    const open = counts.get("open")?.value;
    const closed = counts.get("closed")?.value;
    if (open === undefined || open === null || closed === undefined || closed === null) {
      return null;
    }
    return new Intl.NumberFormat(locale || undefined).format(open + closed);
  }

  return counts.get(statePartition)?.label ?? null;
}
