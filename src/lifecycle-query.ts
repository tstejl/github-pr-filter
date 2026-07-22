import {
  combineQueryExpressions,
  createQueryAtom,
  hasOuterAttachedParenthesis,
  parseGitHubQuery,
  serializeGitHubQuery,
  type AtomExpression,
  type QueryDocument,
  type QueryExpression
} from "./github-query";
import {
  DEFAULT_SELECTION,
  LIFECYCLES,
  type ActiveLifecycleSelection,
  type CustomLifecycleReason,
  type Lifecycle
} from "./lifecycle";

/**
 * The finite lifecycle states that GitHub pull requests can occupy for the
 * dimensions controlled by this extension. A merged pull request cannot be a
 * draft, so it has a single state rather than separate draft/ready variants.
 */
export const PULL_REQUEST_LIFECYCLE_STATES = Object.freeze({
  openDraft: 1 << 0,
  openReady: 1 << 1,
  closedUnmergedDraft: 1 << 2,
  closedUnmergedReady: 1 << 3,
  merged: 1 << 4
});

export type LifecycleMask = number;

const OPEN_MASK = PULL_REQUEST_LIFECYCLE_STATES.openDraft | PULL_REQUEST_LIFECYCLE_STATES.openReady;
const CLOSED_UNMERGED_MASK =
  PULL_REQUEST_LIFECYCLE_STATES.closedUnmergedDraft |
  PULL_REQUEST_LIFECYCLE_STATES.closedUnmergedReady;
const MERGED_MASK = PULL_REQUEST_LIFECYCLE_STATES.merged;
const CLOSED_MASK = CLOSED_UNMERGED_MASK | MERGED_MASK;
const DRAFT_MASK =
  PULL_REQUEST_LIFECYCLE_STATES.openDraft | PULL_REQUEST_LIFECYCLE_STATES.closedUnmergedDraft;
const READY_MASK =
  PULL_REQUEST_LIFECYCLE_STATES.openReady |
  PULL_REQUEST_LIFECYCLE_STATES.closedUnmergedReady |
  PULL_REQUEST_LIFECYCLE_STATES.merged;
const UNMERGED_MASK = OPEN_MASK | CLOSED_UNMERGED_MASK;

export const ALL_LIFECYCLE_MASK = OPEN_MASK | CLOSED_MASK;

export const PRESET_LIFECYCLE_MASKS: Readonly<
  Record<Exclude<Lifecycle, "needs_review">, LifecycleMask>
> = Object.freeze({
  all: ALL_LIFECYCLE_MASK,
  open: OPEN_MASK,
  ready: PULL_REQUEST_LIFECYCLE_STATES.openReady,
  draft: PULL_REQUEST_LIFECYCLE_STATES.openDraft,
  closed: CLOSED_MASK,
  merged: MERGED_MASK,
  closed_unmerged: CLOSED_UNMERGED_MASK
});

export interface PullRequestQueryInput {
  /** The decoded value of GitHub's query parameter or search input. */
  readonly source: string;
  /** Whether the current URL explicitly contains GitHub's query parameter. */
  readonly parameterPresent: boolean;
}

export type LifecycleResolution =
  | "exact"
  | "unconstrained"
  | "partial"
  | "conflicting"
  | "ambiguous"
  | "correlated"
  | "unsupported"
  | "invalid";

export type LifecycleStatePartition = "open" | "closed" | "both" | "none";

export interface LifecycleQueryAnalysis {
  readonly input: PullRequestQueryInput;
  readonly document: QueryDocument;
  readonly selection: ActiveLifecycleSelection;
  readonly resolution: LifecycleResolution;
  readonly mask: LifecycleMask | null;
  readonly statePartition: LifecycleStatePartition;
  readonly safeToRewrite: boolean;
  /** True only for the complete, globally conjunctive Needs review signature. */
  readonly ownsNeedsReviewReviewTerms: boolean;
}

export type LifecycleRewriteUnsafeReason =
  | "correlated"
  | "unsupported"
  | "invalid"
  | "review-correlated";

export type LifecycleQueryRewrite =
  | {
      readonly kind: "unchanged";
      readonly input: PullRequestQueryInput;
      readonly analysis: LifecycleQueryAnalysis;
    }
  | {
      readonly kind: "rewritten";
      readonly input: PullRequestQueryInput;
      readonly previous: LifecycleQueryAnalysis;
      readonly analysis: LifecycleQueryAnalysis;
    }
  | {
      readonly kind: "unsafe";
      readonly input: PullRequestQueryInput;
      readonly analysis: LifecycleQueryAnalysis;
      readonly reason: LifecycleRewriteUnsafeReason;
    };

export interface LifecycleQueryPlan {
  readonly input: PullRequestQueryInput;
  readonly analysis: LifecycleQueryAnalysis;
  readonly transitions: Readonly<Record<Lifecycle, LifecycleQueryRewrite>>;
}

interface ParsedQualifier {
  readonly negated: boolean;
  readonly key: string;
  readonly value: string;
}

type LifecycleDimension = "state" | "merge" | "draft";

interface CoreExpressionSummary {
  readonly kind: "core" | "orthogonal" | "ambiguous" | "mixed" | "unsupported";
  readonly mask: LifecycleMask;
  readonly dimensions: readonly LifecycleDimension[];
}

interface SeparableQuery {
  readonly kind: "separable";
  readonly mask: LifecycleMask | null;
  readonly ambiguous: boolean;
  readonly terms: readonly QueryExpression[];
  readonly coreTerms: ReadonlySet<QueryExpression>;
}

interface CorrelatedQuery {
  readonly kind: "correlated";
}

interface UnsupportedQuery {
  readonly kind: "unsupported";
}

type QuerySeparation = SeparableQuery | CorrelatedQuery | UnsupportedQuery;

const CANONICAL_REVIEW_VALUES = new Set(["approved", "changes_requested"]);

function unquote(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value.at(-1);
  return first === '"' && last === '"' ? value.slice(1, -1) : value;
}

function qualifierForAtom(atom: AtomExpression): ParsedQualifier | null {
  const match = /^(-?)([a-z][a-z-]*):(.*)$/u.exec(atom.token.raw);
  const key = match?.[2];
  const rawValue = match?.[3];
  if (key === undefined || rawValue === undefined) {
    return null;
  }
  return {
    negated: match?.[1] === "-",
    key,
    value: unquote(rawValue)
  };
}

function complement(mask: LifecycleMask): LifecycleMask {
  return ALL_LIFECYCLE_MASK & ~mask;
}

function looksLikeUnsupportedCoreQualifier(qualifier: ParsedQualifier): boolean {
  if (qualifier.key === "state" || qualifier.key === "draft") {
    return true;
  }
  if (qualifier.key === "is" && qualifier.value.length === 0) {
    return true;
  }
  return (
    qualifier.key === "is" &&
    /(?:^|[^a-z])(open|closed|merged|unmerged|draft)(?:$|[^a-z])/u.test(
      qualifier.value.toLowerCase()
    )
  );
}

function summarizeAtom(atom: AtomExpression): CoreExpressionSummary {
  const qualifier = qualifierForAtom(atom);
  if (!qualifier) {
    return { kind: "orthogonal", mask: ALL_LIFECYCLE_MASK, dimensions: [] };
  }

  // GitHub treats `-state:open` and `-state:closed` as complements, but currently
  // ignores the superficially similar `-is:open` and `-is:closed` forms. Keep
  // those inert `is:` terms as opaque user input rather than inventing a mask.
  const value = qualifier.key === "state" ? qualifier.value : qualifier.value.toLowerCase();
  if (qualifier.negated && qualifier.key === "is" && (value === "open" || value === "closed")) {
    return { kind: "orthogonal", mask: ALL_LIFECYCLE_MASK, dimensions: [] };
  }

  let mask: LifecycleMask | null = null;
  let dimension: LifecycleDimension | null = null;
  if ((qualifier.key === "is" || qualifier.key === "state") && value === "open") {
    mask = OPEN_MASK;
    dimension = "state";
  } else if ((qualifier.key === "is" || qualifier.key === "state") && value === "closed") {
    mask = CLOSED_MASK;
    dimension = "state";
  } else if (qualifier.key === "is" && value === "merged") {
    mask = MERGED_MASK;
    dimension = "merge";
  } else if (qualifier.key === "is" && value === "unmerged") {
    mask = UNMERGED_MASK;
    dimension = "merge";
  } else if (qualifier.key === "is" && value === "draft") {
    mask = DRAFT_MASK;
    dimension = "draft";
  } else if (qualifier.key === "draft" && value === "true") {
    mask = DRAFT_MASK;
    dimension = "draft";
  } else if (qualifier.key === "draft" && value === "false") {
    mask = READY_MASK;
    dimension = "draft";
  }

  if (mask === null) {
    return {
      kind: looksLikeUnsupportedCoreQualifier(qualifier) ? "unsupported" : "orthogonal",
      mask: ALL_LIFECYCLE_MASK,
      dimensions: []
    };
  }
  return {
    kind: "core",
    mask: qualifier.negated ? complement(mask) : mask,
    dimensions: dimension === null ? [] : [dimension]
  };
}

function combinedDimensions(
  summaries: readonly CoreExpressionSummary[]
): readonly LifecycleDimension[] {
  return [...new Set(summaries.flatMap(({ dimensions }) => dimensions))];
}

function hasConflictingDimension(summaries: readonly CoreExpressionSummary[]): boolean {
  const masksByDimension = new Map<LifecycleDimension, LifecycleMask>();
  for (const summary of summaries) {
    for (const dimension of summary.dimensions) {
      const previous = masksByDimension.get(dimension);
      if (previous !== undefined && previous !== summary.mask) {
        return true;
      }
      masksByDimension.set(dimension, summary.mask);
    }
  }
  return false;
}

function summarizeExpression(expression: QueryExpression): CoreExpressionSummary {
  if (expression.kind === "atom") {
    return summarizeAtom(expression);
  }

  if (expression.kind === "group") {
    if (expression.expression === null) {
      return { kind: "orthogonal", mask: ALL_LIFECYCLE_MASK, dimensions: [] };
    }
    const summary = summarizeExpression(expression.expression);
    if (summary.kind === "core" || summary.kind === "ambiguous") {
      return { kind: "unsupported", mask: ALL_LIFECYCLE_MASK, dimensions: [] };
    }
    return summary;
  }

  const summaries = expression.terms.map(summarizeExpression);
  if (summaries.some(({ kind }) => kind === "unsupported")) {
    return { kind: "unsupported", mask: ALL_LIFECYCLE_MASK, dimensions: [] };
  }
  if (summaries.every(({ kind }) => kind === "orthogonal")) {
    return { kind: "orthogonal", mask: ALL_LIFECYCLE_MASK, dimensions: [] };
  }
  if (!summaries.every(({ kind }) => kind === "core" || kind === "ambiguous")) {
    return { kind: "mixed", mask: ALL_LIFECYCLE_MASK, dimensions: [] };
  }

  const dimensions = combinedDimensions(summaries);
  if (expression.kind === "or" || expression.links.some(({ style }) => style === "explicit")) {
    return { kind: "unsupported", mask: ALL_LIFECYCLE_MASK, dimensions: [] };
  }
  if (
    summaries.some(({ kind }) => kind === "ambiguous") ||
    (expression.kind === "and" && hasConflictingDimension(summaries))
  ) {
    return { kind: "ambiguous", mask: ALL_LIFECYCLE_MASK, dimensions };
  }

  const mask = summaries.reduce(
    (result, summary) =>
      expression.kind === "and" ? result & summary.mask : result | summary.mask,
    expression.kind === "and" ? ALL_LIFECYCLE_MASK : 0
  );
  return { kind: "core", mask, dimensions };
}

function globalConjuncts(expression: QueryExpression | null): readonly QueryExpression[] {
  if (expression === null) {
    return [];
  }
  if (expression.kind !== "and" || expression.links.some(({ style }) => style === "explicit")) {
    return [expression];
  }
  return expression.terms.flatMap((term) => globalConjuncts(term));
}

function separateQuery(document: QueryDocument): QuerySeparation {
  const terms = globalConjuncts(document.root);
  const coreTerms = new Set<QueryExpression>();
  const masksByDimension = new Map<LifecycleDimension, LifecycleMask>();
  let mask = ALL_LIFECYCLE_MASK;
  let ambiguous = false;

  for (const term of terms) {
    const summary = summarizeExpression(term);
    if (summary.kind === "unsupported") {
      return { kind: "unsupported" };
    }
    if (summary.kind === "mixed") {
      return { kind: "correlated" };
    }
    if (summary.kind === "core" || summary.kind === "ambiguous") {
      coreTerms.add(term);
      const conflicts = summary.dimensions.some((dimension) => {
        const previous = masksByDimension.get(dimension);
        return previous !== undefined && previous !== summary.mask;
      });
      if (summary.kind === "ambiguous" || conflicts) {
        ambiguous = true;
      } else {
        mask &= summary.mask;
      }
      for (const dimension of summary.dimensions) {
        masksByDimension.set(dimension, summary.mask);
      }
    }
  }

  return { kind: "separable", terms, coreTerms, mask: ambiguous ? null : mask, ambiguous };
}

function visitAtoms(
  expression: QueryExpression | null,
  visitor: (atom: AtomExpression) => void
): void {
  if (expression === null) {
    return;
  }
  if (expression.kind === "atom") {
    visitor(expression);
    return;
  }
  if (expression.kind === "group") {
    visitAtoms(expression.expression, visitor);
    return;
  }
  for (const term of expression.terms) {
    visitAtoms(term, visitor);
  }
}

function statusReviewQualifier(atom: AtomExpression): ParsedQualifier | null {
  const qualifier = qualifierForAtom(atom);
  return qualifier?.key === "review" ? qualifier : null;
}

function canonicalReviewQualifier(atom: AtomExpression): ParsedQualifier | null {
  const qualifier = statusReviewQualifier(atom);
  return qualifier?.negated && CANONICAL_REVIEW_VALUES.has(qualifier.value) ? qualifier : null;
}

function simpleAtom(expression: QueryExpression): AtomExpression | null {
  return expression.kind === "atom" ? expression : null;
}

interface ReviewInspection {
  readonly allStatusAtoms: readonly AtomExpression[];
  readonly globalStatusTerms: ReadonlyMap<QueryExpression, AtomExpression>;
  readonly canonicalGlobalTerms: ReadonlyMap<QueryExpression, AtomExpression>;
  readonly hasExactCanonicalPair: boolean;
  readonly allStatusTermsAreGlobal: boolean;
}

function inspectReviewTerms(
  document: QueryDocument,
  globalTerms: readonly QueryExpression[]
): ReviewInspection {
  const allStatusAtoms: AtomExpression[] = [];
  visitAtoms(document.root, (atom) => {
    if (statusReviewQualifier(atom)) {
      allStatusAtoms.push(atom);
    }
  });

  const globalStatusTerms = new Map<QueryExpression, AtomExpression>();
  const canonicalGlobalTerms = new Map<QueryExpression, AtomExpression>();
  for (const term of globalTerms) {
    const atom = simpleAtom(term);
    if (!atom || !statusReviewQualifier(atom)) {
      continue;
    }
    globalStatusTerms.set(term, atom);
    if (canonicalReviewQualifier(atom)) {
      canonicalGlobalTerms.set(term, atom);
    }
  }

  const canonicalValues = new Set(
    [...canonicalGlobalTerms.values()].map((atom) => canonicalReviewQualifier(atom)?.value)
  );
  const hasExactCanonicalPair =
    allStatusAtoms.length === canonicalGlobalTerms.size &&
    canonicalValues.has("approved") &&
    canonicalValues.has("changes_requested") &&
    [...allStatusAtoms].every((atom) => canonicalReviewQualifier(atom) !== null);

  return {
    allStatusAtoms,
    globalStatusTerms,
    canonicalGlobalTerms,
    hasExactCanonicalPair,
    allStatusTermsAreGlobal: allStatusAtoms.length === globalStatusTerms.size
  };
}

function presetForMask(mask: LifecycleMask): Exclude<Lifecycle, "needs_review"> | null {
  const presets: readonly Exclude<Lifecycle, "needs_review">[] = [
    "all",
    "open",
    "ready",
    "draft",
    "closed",
    "merged",
    "closed_unmerged"
  ];
  return presets.find((preset) => PRESET_LIFECYCLE_MASKS[preset] === mask) ?? null;
}

function customSelection(reason: CustomLifecycleReason): ActiveLifecycleSelection {
  return { kind: "custom", reason };
}

function statePartitionForMask(mask: LifecycleMask | null): LifecycleStatePartition {
  if (mask === null || mask === 0) {
    return "none";
  }
  const includesOpen = (mask & OPEN_MASK) !== 0;
  const includesClosed = (mask & CLOSED_MASK) !== 0;
  if (includesOpen && includesClosed) {
    return "both";
  }
  return includesOpen ? "open" : "closed";
}

export function analyzeLifecycleQuery(input: PullRequestQueryInput): LifecycleQueryAnalysis {
  const document = parseGitHubQuery(input.source);
  if (document.diagnostics.length > 0) {
    return {
      input,
      document,
      selection: customSelection("invalid"),
      resolution: "invalid",
      mask: null,
      statePartition: "none",
      safeToRewrite: false,
      ownsNeedsReviewReviewTerms: false
    };
  }

  // GitHub's repository pull-request route defaults a missing or empty query
  // to Open. This is intentionally different from an explicit non-empty query
  // that has no lifecycle predicates, which means All lifecycle states.
  if (input.source.trim().length === 0) {
    return {
      input,
      document,
      selection: DEFAULT_SELECTION,
      resolution: "exact",
      mask: OPEN_MASK,
      statePartition: "open",
      safeToRewrite: true,
      ownsNeedsReviewReviewTerms: false
    };
  }

  const separation = separateQuery(document);
  if (separation.kind === "unsupported") {
    return {
      input,
      document,
      selection: customSelection("unsupported"),
      resolution: "unsupported",
      mask: null,
      statePartition: "none",
      safeToRewrite: false,
      ownsNeedsReviewReviewTerms: false
    };
  }
  if (separation.kind === "correlated") {
    return {
      input,
      document,
      selection: customSelection("correlated"),
      resolution: "correlated",
      mask: null,
      statePartition: "none",
      safeToRewrite: false,
      ownsNeedsReviewReviewTerms: false
    };
  }

  if (separation.ambiguous || separation.mask === null) {
    return {
      input,
      document,
      selection: customSelection("ambiguous"),
      resolution: "ambiguous",
      mask: null,
      statePartition: "none",
      safeToRewrite: true,
      ownsNeedsReviewReviewTerms: false
    };
  }

  const review = inspectReviewTerms(document, separation.terms);
  const ownsNeedsReviewReviewTerms =
    separation.mask === PRESET_LIFECYCLE_MASKS.ready && review.hasExactCanonicalPair;
  if (ownsNeedsReviewReviewTerms) {
    return {
      input,
      document,
      selection: { kind: "preset", lifecycle: "needs_review" },
      resolution: "exact",
      mask: separation.mask,
      statePartition: "open",
      safeToRewrite: true,
      ownsNeedsReviewReviewTerms: true
    };
  }

  if (separation.mask === 0) {
    return {
      input,
      document,
      selection: customSelection("conflicting"),
      resolution: "conflicting",
      mask: separation.mask,
      statePartition: "none",
      safeToRewrite: true,
      ownsNeedsReviewReviewTerms: false
    };
  }

  const preset = presetForMask(separation.mask);
  if (preset) {
    return {
      input,
      document,
      selection: { kind: "preset", lifecycle: preset },
      resolution: preset === "all" ? "unconstrained" : "exact",
      mask: separation.mask,
      statePartition: statePartitionForMask(separation.mask),
      safeToRewrite: true,
      ownsNeedsReviewReviewTerms: false
    };
  }

  return {
    input,
    document,
    selection: customSelection("partial"),
    resolution: "partial",
    mask: separation.mask,
    statePartition: statePartitionForMask(separation.mask),
    safeToRewrite: true,
    ownsNeedsReviewReviewTerms: false
  };
}

function isSelectedPreset(selection: ActiveLifecycleSelection, lifecycle: Lifecycle): boolean {
  return selection.kind === "preset" && selection.lifecycle === lifecycle;
}

function canonicalLifecycleTerms(lifecycle: Lifecycle): readonly QueryExpression[] {
  switch (lifecycle) {
    case "all":
      return [];
    case "open":
      return [createQueryAtom("is:open")];
    case "ready":
      return [createQueryAtom("is:open"), createQueryAtom("draft:false")];
    case "draft":
      return [createQueryAtom("is:open"), createQueryAtom("draft:true")];
    case "needs_review":
      return [
        createQueryAtom("is:open"),
        createQueryAtom("draft:false"),
        createQueryAtom("-review:approved"),
        createQueryAtom("-review:changes_requested")
      ];
    case "closed":
      return [createQueryAtom("is:closed")];
    case "merged":
      return [createQueryAtom("is:merged")];
    case "closed_unmerged":
      return [createQueryAtom("is:closed"), createQueryAtom("is:unmerged")];
  }
}

function rewriteAnalyzedLifecycleQuery(
  analysis: LifecycleQueryAnalysis,
  target: Lifecycle
): LifecycleQueryRewrite {
  const { input } = analysis;
  if (isSelectedPreset(analysis.selection, target)) {
    return { kind: "unchanged", input, analysis };
  }
  if (!analysis.safeToRewrite) {
    const reason =
      analysis.resolution === "invalid" || analysis.resolution === "unsupported"
        ? analysis.resolution
        : "correlated";
    return {
      kind: "unsafe",
      input,
      analysis,
      reason
    };
  }
  // Parentheses attached to an outer atom boundary may be literal search text rather
  // than grouping. Re-serializing would insert spaces (foo(bar) -> foo (bar)), so the
  // extension must leave such input byte-for-byte intact.
  if (hasOuterAttachedParenthesis(analysis.document)) {
    return { kind: "unsafe", input, analysis, reason: "unsupported" };
  }

  const separation = separateQuery(analysis.document);
  if (separation.kind === "unsupported") {
    return { kind: "unsafe", input, analysis, reason: "unsupported" };
  }
  if (separation.kind === "correlated") {
    return { kind: "unsafe", input, analysis, reason: "correlated" };
  }
  const review = inspectReviewTerms(analysis.document, separation.terms);
  if (target === "needs_review" && !review.allStatusTermsAreGlobal) {
    return { kind: "unsafe", input, analysis, reason: "review-correlated" };
  }

  // `Ready` intentionally means the broad GitHub lifecycle state "open, not a draft".
  // Keeping the exact negative-review pair would make the rewritten query resolve back
  // to the narrower `Needs review` preset instead of the option the user selected.
  const removeCanonicalReviewPair =
    analysis.ownsNeedsReviewReviewTerms || (target === "ready" && review.hasExactCanonicalPair);
  const retainedTerms = separation.terms.filter((term) => {
    if (separation.coreTerms.has(term)) {
      return false;
    }
    if (target === "needs_review" && review.globalStatusTerms.has(term)) {
      return false;
    }
    if (removeCanonicalReviewPair && review.canonicalGlobalTerms.has(term)) {
      return false;
    }
    return true;
  });

  const outputTerms = [...retainedTerms];
  // An empty query makes GitHub's repository Pulls page fall back to Open. Give All an
  // explicit, neutral query only when removing lifecycle terms leaves nothing else.
  // Existing item-type expressions are orthogonal user input and must remain untouched.
  if (target === "all" && outputTerms.length === 0) {
    outputTerms.unshift(createQueryAtom("is:pr"));
  }
  outputTerms.push(...canonicalLifecycleTerms(target));
  const source = serializeGitHubQuery(combineQueryExpressions("and", outputTerms));
  const nextInput: PullRequestQueryInput = { source, parameterPresent: true };
  const nextAnalysis = analyzeLifecycleQuery(nextInput);
  // A rewrite is safe only if this same product model can prove the resulting preset.
  // This catches nonstandard GitHub grammar interactions such as an ungrouped explicit
  // Boolean expression absorbing an appended lifecycle qualifier into one branch.
  if (!isSelectedPreset(nextAnalysis.selection, target)) {
    return { kind: "unsafe", input, analysis, reason: "correlated" };
  }

  return {
    kind: "rewritten",
    input: nextInput,
    previous: analysis,
    analysis: nextAnalysis
  };
}

export function rewriteLifecycleQuery(
  input: PullRequestQueryInput,
  target: Lifecycle
): LifecycleQueryRewrite {
  return rewriteAnalyzedLifecycleQuery(analyzeLifecycleQuery(input), target);
}

export function createLifecycleQueryPlan(input: PullRequestQueryInput): LifecycleQueryPlan {
  const analysis = analyzeLifecycleQuery(input);
  const transitions = Object.fromEntries(
    LIFECYCLES.map((lifecycle) => [lifecycle, rewriteAnalyzedLifecycleQuery(analysis, lifecycle)])
  ) as Record<Lifecycle, LifecycleQueryRewrite>;
  return { input, analysis, transitions };
}
