import { parseGitHubQuery } from "./github-query";

interface PredicateForm {
  qualifier: string;
  values: Readonly<Record<string, string>> | "opaque";
  identity?: "presence";
  /** Require isolation until interactions across lifecycle forms are established. */
  isolatedFrom?: readonly string[];
}
export interface PredicateFamily {
  dimension: string;
  orderGroup: string;
  forms: readonly PredicateForm[];
  negative: "literal";
}

const LIFECYCLE_DIMENSIONS = ["state", "merge", "draft"] as const;
const BOOLEAN_VALUES = { true: "true", false: "false" };
function family(
  dimension: string,
  forms: readonly PredicateForm[],
  orderGroup = dimension
): PredicateFamily {
  return { dimension, orderGroup, forms, negative: "literal" };
}
function opaque(qualifier: string): PredicateFamily {
  return family(qualifier, [{ qualifier, values: "opaque" }]);
}

/**
 * Comparison rules, not a query validator or a copy of GitHub's autocomplete.
 * Documented aliases: https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests
 * Positive draft/merge state aliases were observed on repository PR search on
 * 2026-11-09. Their interactions remain guarded; frontend aliases (notably
 * boolean yes/no and sort shorthands) do not establish server equivalence.
 */
export const PREDICATE_REGISTRY: readonly PredicateFamily[] = [
  family("kind", [
    { qualifier: "is", values: { pr: "pr", issue: "issue" } },
    { qualifier: "type", values: { pr: "pr", issue: "issue" } }
  ]),
  family(
    "state",
    [
      { qualifier: "is", values: { open: "open", closed: "closed" } },
      { qualifier: "state", values: { open: "open", closed: "closed" } }
    ],
    "lifecycle"
  ),
  family(
    "merge",
    [
      { qualifier: "is", values: { merged: "merged", unmerged: "unmerged" } },
      { qualifier: "state", values: { merged: "merged" }, isolatedFrom: LIFECYCLE_DIMENSIONS }
    ],
    "lifecycle"
  ),
  family("draft", [
    { qualifier: "draft", values: BOOLEAN_VALUES },
    { qualifier: "is", values: { draft: "true" } },
    { qualifier: "state", values: { draft: "true" }, isolatedFrom: LIFECYCLE_DIMENSIONS }
  ]),
  family("lock", [{ qualifier: "is", values: { locked: "true", unlocked: "false" } }]),
  family("queue", [{ qualifier: "is", values: { queued: "true" } }]),
  family("blocked", [{ qualifier: "is", values: { blocked: "true" } }]),
  family("blocking", [{ qualifier: "is", values: { blocking: "true" } }]),
  family("visibility", [{ qualifier: "is", values: { public: "public", private: "private" } }]),
  // Archiving a PR and archiving its repository are distinct filters.
  family("pr-archive", [{ qualifier: "is", values: { archived: "true" } }]),
  family("repository-archive", [{ qualifier: "archived", values: BOOLEAN_VALUES }]),
  family("review", [
    {
      qualifier: "review",
      values: {
        none: "none",
        required: "required",
        approved: "approved",
        changes_requested: "changes_requested"
      }
    }
  ]),
  family("status", [
    {
      qualifier: "status",
      values: {
        pending: "pending",
        success: "success",
        failure: "failure",
        queued: "queued",
        waiting: "waiting",
        cancelled: "cancelled",
        skipped: "skipped"
      }
    }
  ]),
  family("reason", [
    {
      qualifier: "reason",
      values: {
        completed: "completed",
        "not-planned": "not-planned",
        duplicate: "duplicate"
      }
    }
  ]),
  family("linked", [{ qualifier: "linked", values: { issue: "issue", pr: "pr" } }]),
  // Values remain opaque: preserve quotes, case, commas, ranges, and escapes.
  ...[
    "assignee",
    "author",
    "commenter",
    "involves",
    "mentions",
    "user",
    "reviewed-by",
    "review-requested",
    "user-review-requested",
    "review-involves",
    "team",
    "team-review-requested",
    "team-review-requested-user",
    "label",
    "milestone",
    "project",
    "language",
    "repo",
    "org",
    "parent-issue",
    "sub-issue",
    "blocked-by",
    "created",
    "updated",
    "closed",
    "merged",
    "comments",
    "interactions",
    "reactions",
    "base",
    "head",
    "sha",
    "in",
    "sort"
  ].map(opaque),
  family("blocking-target", [{ qualifier: "blocking", values: "opaque" }], "blocking"),
  // Metadata presence interacts with the corresponding value qualifier. Do not
  // assume has:assignee, assignee:*, or -no:assignee are interchangeable.
  ...["assignee", "label", "milestone", "project"].map((dimension) =>
    family(dimension, [
      { qualifier: "has", values: { [dimension]: "present" }, identity: "presence" },
      { qualifier: "no", values: { [dimension]: "absent" }, identity: "presence" }
    ])
  )
];

interface PredicateRule {
  family: PredicateFamily;
  form: PredicateForm;
}
interface Predicate {
  dimension: string;
  orderGroup: string;
  identity: readonly string[];
  isolatedFrom?: readonly string[];
}
const RULES = new Map<string, PredicateRule[]>();
for (const entry of PREDICATE_REGISTRY)
  for (const form of entry.forms) {
    const rules = RULES.get(form.qualifier) ?? [];
    rules.push({ family: entry, form });
    RULES.set(form.qualifier, rules);
  }

function predicate(raw: string): Predicate | null {
  const match = /^(-?)([a-z][\w-]*):(.+)$/u.exec(raw);
  if (!match) return null;
  const [, negative, qualifier, value] = match;
  if (!qualifier || !value) return null;
  for (const { family: entry, form } of RULES.get(qualifier) ?? []) {
    if (form.values !== "opaque" && !Object.hasOwn(form.values, value)) continue;
    const canonicalValue = form.values === "opaque" ? value : form.values[value];
    if (canonicalValue === undefined) continue;
    return {
      dimension: entry.dimension,
      orderGroup: entry.orderGroup,
      // Negation behavior differs between surfaces. Only the same spelling is
      // recognized; no inversion, complement, or cross-spelling substitution.
      identity:
        negative && entry.negative === "literal"
          ? ["literal", raw]
          : ["predicate", entry.dimension, form.identity ?? "value", canonicalValue],
      ...(form.isolatedFrom ? { isolatedFrom: form.isolatedFrom } : {})
    };
  }
  return null;
}

/** Recognition only. Never serialize this key back into a GitHub query. */
export function viewQueryKey(query: string): string {
  const document = parseGitHubQuery(query.trim());
  const root = document.root;
  if (document.diagnostics.length || !root) return `exact:${query.trim()}`;
  const predicates = document.tokens.map((token) =>
    token.kind === "atom" ? predicate(token.raw) : null
  );
  if (document.tokens.some((token, index) => token.kind === "atom" && !predicates[index]))
    return `exact:${query.trim()}`;
  const dimensions = new Map<string, number>();
  for (const entry of predicates)
    if (entry) dimensions.set(entry.dimension, (dimensions.get(entry.dimension) ?? 0) + 1);
  const guarded = predicates.some(
    (entry) =>
      entry?.isolatedFrom &&
      entry.isolatedFrom.some(
        (dimension) => (dimensions.get(dimension) ?? 0) > (entry.dimension === dimension ? 1 : 0)
      )
  );
  // A guarded spelling can change how neighboring qualifiers interact. Keep
  // the complete query literal, including negatives and neighboring aliases.
  if (guarded) return `exact:${query.trim()}`;
  // Keep operators, grouping, whitespace, and opaque text byte-stable, while
  // permitting verified, context-safe aliases in the same structural position.
  const structuralKey = `structural:${JSON.stringify(
    document.tokens.map(
      (token, index) => predicates[index]?.identity ?? ["raw", token.kind, token.raw]
    )
  )}`;
  const terms = root.kind === "atom" ? [root] : root.kind === "and" ? root.terms : [];
  if (!terms.length || terms.some((term) => term.kind !== "atom")) return structuralKey;
  const buckets = new Map<string, (readonly string[])[]>();
  for (const term of terms) {
    if (term.kind !== "atom") return structuralKey;
    const entry = predicate(term.token.raw);
    if (!entry) return structuralKey;
    const bucket = buckets.get(entry.orderGroup) ?? [];
    bucket.push(entry.identity);
    buckets.set(entry.orderGroup, bucket);
  }
  if (
    root.kind === "and" &&
    root.links.some((link) => link.style === "explicit") &&
    [...buckets.values()].some((bucket) => bucket.length > 1)
  )
    return structuralKey;
  // Repeated/coupled predicates keep their relative order and multiplicity.
  return `flat:${JSON.stringify([...buckets].toSorted(([a], [b]) => a.localeCompare(b)))}`;
}
