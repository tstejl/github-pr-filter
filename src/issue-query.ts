import {
  combineQueryExpressions,
  createQueryAtom,
  parseGitHubQuery,
  serializeGitHubQuery,
  type AtomExpression,
  type QueryDocument,
  type QueryExpression
} from "./github-query";
import type { ActiveLifecycleSelection, Lifecycle } from "./lifecycle";
import type { LifecycleStatePartition } from "./lifecycle-query";

export interface IssueQueryInput {
  readonly source: string;
}

export type IssueQueryResolution =
  | "exact"
  | "unconstrained"
  | "unsupported"
  | "conflicting"
  | "correlated"
  | "invalid";

export interface IssueQueryAnalysis {
  readonly input: IssueQueryInput;
  readonly document: QueryDocument;
  readonly selection: ActiveLifecycleSelection;
  readonly resolution: IssueQueryResolution;
  readonly statePartition: LifecycleStatePartition;
  readonly safeToRewrite: boolean;
}

export type IssueQueryRewrite =
  | {
      readonly kind: "unchanged";
      readonly input: IssueQueryInput;
      readonly analysis: IssueQueryAnalysis;
    }
  | {
      readonly kind: "rewritten";
      readonly input: IssueQueryInput;
      readonly previous: IssueQueryAnalysis;
      readonly analysis: IssueQueryAnalysis;
    }
  | {
      readonly kind: "unsafe";
      readonly input: IssueQueryInput;
      readonly analysis: IssueQueryAnalysis;
      readonly reason: "correlated" | "unsupported" | "invalid";
    };

export interface IssueQueryPlan {
  readonly input: IssueQueryInput;
  readonly analysis: IssueQueryAnalysis;
  readonly transitions: Readonly<
    Record<Extract<Lifecycle, "all" | "open" | "closed">, IssueQueryRewrite>
  >;
}

type IssueLifecycle = Extract<Lifecycle, "all" | "open" | "closed">;

interface ParsedQualifier {
  readonly negated: boolean;
  readonly key: string;
  readonly value: string;
}

const ISSUE_LIFECYCLES: readonly IssueLifecycle[] = Object.freeze(["all", "open", "closed"]);

function unquote(value: string): string {
  if (value.length < 2) {
    return value;
  }
  return value[0] === '"' && value.at(-1) === '"' ? value.slice(1, -1) : value;
}

function qualifierForAtom(atom: AtomExpression): ParsedQualifier | null {
  const match = /^(-?)([a-z][a-z-]*):(.*)$/iu.exec(atom.token.raw);
  if (!match?.[2] || match[3] === undefined) {
    return null;
  }
  return {
    negated: match[1] === "-",
    key: match[2].toLowerCase(),
    value: unquote(match[3]).toLowerCase()
  };
}

function customSelection(
  reason: "correlated" | "unsupported" | "conflicting" | "invalid"
): ActiveLifecycleSelection {
  return { kind: "custom", reason };
}

function statePartitionForSelection(selection: IssueLifecycle): LifecycleStatePartition {
  return selection === "all" ? "both" : selection;
}

function flatAtoms(document: QueryDocument): readonly AtomExpression[] | null {
  if (document.root === null) {
    return [];
  }
  if (document.root.kind === "atom") {
    return [document.root];
  }
  if (
    document.root.kind !== "and" ||
    document.root.links.some(({ style }) => style !== "implicit") ||
    document.root.terms.some((term) => term.kind !== "atom")
  ) {
    return null;
  }
  return document.root.terms as readonly AtomExpression[];
}

function unsupportedStatus(qualifier: ParsedQualifier): boolean {
  if (qualifier.key === "state") {
    return !["open", "closed"].includes(qualifier.value) || qualifier.negated;
  }
  if (qualifier.key === "draft" || qualifier.key === "review") {
    return true;
  }
  if (qualifier.key !== "is") {
    return false;
  }
  if (qualifier.value === "pr" || (qualifier.value === "issue" && qualifier.negated)) {
    return true;
  }
  if (["open", "closed"].includes(qualifier.value)) {
    return qualifier.negated;
  }
  return ["merged", "unmerged", "draft", "ready"].includes(qualifier.value);
}

function issueState(qualifier: ParsedQualifier): IssueLifecycle | null {
  if (qualifier.negated || !["is", "state"].includes(qualifier.key)) {
    return null;
  }
  return qualifier.value === "open" || qualifier.value === "closed" ? qualifier.value : null;
}

function analysisFor(
  input: IssueQueryInput,
  document: QueryDocument,
  selection: ActiveLifecycleSelection,
  resolution: IssueQueryResolution,
  statePartition: LifecycleStatePartition,
  safeToRewrite: boolean
): IssueQueryAnalysis {
  return { input, document, selection, resolution, statePartition, safeToRewrite };
}

export function analyzeIssueQuery(input: IssueQueryInput): IssueQueryAnalysis {
  const document = parseGitHubQuery(input.source);
  if (document.diagnostics.length > 0) {
    return analysisFor(input, document, customSelection("invalid"), "invalid", "none", false);
  }

  if (input.source.trim().length === 0) {
    return analysisFor(
      input,
      document,
      { kind: "preset", lifecycle: "open" },
      "exact",
      "open",
      true
    );
  }

  const atoms = flatAtoms(document);
  if (atoms === null) {
    return analysisFor(input, document, customSelection("correlated"), "correlated", "none", false);
  }

  let selected: IssueLifecycle | null = null;
  for (const atom of atoms) {
    const qualifier = qualifierForAtom(atom);
    if (!qualifier) {
      continue;
    }
    if (unsupportedStatus(qualifier)) {
      return analysisFor(
        input,
        document,
        customSelection("unsupported"),
        "unsupported",
        "none",
        false
      );
    }
    const state = issueState(qualifier);
    if (!state) {
      continue;
    }
    if (selected !== null && selected !== state) {
      return analysisFor(
        input,
        document,
        customSelection("conflicting"),
        "conflicting",
        "none",
        false
      );
    }
    selected = state;
  }

  if (selected === null) {
    return analysisFor(
      input,
      document,
      { kind: "preset", lifecycle: "all" },
      "unconstrained",
      "both",
      true
    );
  }
  return analysisFor(
    input,
    document,
    { kind: "preset", lifecycle: selected },
    "exact",
    statePartitionForSelection(selected),
    true
  );
}

function selectedPreset(selection: ActiveLifecycleSelection, lifecycle: IssueLifecycle): boolean {
  return selection.kind === "preset" && selection.lifecycle === lifecycle;
}

function lifecycleTerm(lifecycle: IssueLifecycle): QueryExpression | null {
  if (lifecycle === "all") {
    return null;
  }
  return createQueryAtom(`state:${lifecycle}`);
}

function rewriteAnalyzedIssueQuery(
  analysis: IssueQueryAnalysis,
  target: IssueLifecycle
): IssueQueryRewrite {
  const { input } = analysis;
  if (selectedPreset(analysis.selection, target)) {
    return { kind: "unchanged", input, analysis };
  }
  if (!analysis.safeToRewrite) {
    const reason =
      analysis.resolution === "invalid"
        ? "invalid"
        : analysis.resolution === "unsupported"
          ? "unsupported"
          : "correlated";
    return { kind: "unsafe", input, analysis, reason };
  }

  const atoms = flatAtoms(analysis.document);
  if (atoms === null) {
    return { kind: "unsafe", input, analysis, reason: "correlated" };
  }
  const retained = atoms.filter((atom) => {
    const qualifier = qualifierForAtom(atom);
    return !qualifier || issueState(qualifier) === null;
  });
  const outputTerms: QueryExpression[] = [...retained];
  const hasIssueQualifier = retained.some((atom) => {
    const qualifier = qualifierForAtom(atom);
    return qualifier?.key === "is" && qualifier.value === "issue" && !qualifier.negated;
  });
  if (!hasIssueQualifier) {
    outputTerms.unshift(createQueryAtom("is:issue"));
  }
  const targetTerm = lifecycleTerm(target);
  if (targetTerm) {
    outputTerms.push(targetTerm);
  }
  const nextInput: IssueQueryInput = {
    source: serializeGitHubQuery(combineQueryExpressions("and", outputTerms))
  };
  const nextAnalysis = analyzeIssueQuery(nextInput);
  if (!selectedPreset(nextAnalysis.selection, target)) {
    return { kind: "unsafe", input, analysis, reason: "correlated" };
  }
  return { kind: "rewritten", input: nextInput, previous: analysis, analysis: nextAnalysis };
}

export function rewriteIssueQuery(
  input: IssueQueryInput,
  target: IssueLifecycle
): IssueQueryRewrite {
  return rewriteAnalyzedIssueQuery(analyzeIssueQuery(input), target);
}

export function createIssueQueryPlan(input: IssueQueryInput): IssueQueryPlan {
  const analysis = analyzeIssueQuery(input);
  const transitions = Object.fromEntries(
    ISSUE_LIFECYCLES.map((lifecycle) => [lifecycle, rewriteAnalyzedIssueQuery(analysis, lifecycle)])
  ) as Record<IssueLifecycle, IssueQueryRewrite>;
  return { input, analysis, transitions };
}

export type { IssueLifecycle };
