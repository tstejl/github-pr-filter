export type Lifecycle =
  | "all"
  | "needs_review"
  | "open"
  | "ready"
  | "draft"
  | "closed"
  | "merged"
  | "closed_unmerged";

export type CustomLifecycleReason =
  | "partial"
  | "conflicting"
  | "ambiguous"
  | "correlated"
  | "unsupported"
  | "invalid";

export type ActiveLifecycleSelection =
  | { readonly kind: "preset"; readonly lifecycle: Lifecycle }
  | { readonly kind: "custom"; readonly reason: CustomLifecycleReason };

export const LIFECYCLES = Object.freeze([
  "all",
  "needs_review",
  "open",
  "ready",
  "draft",
  "closed",
  "merged",
  "closed_unmerged"
] as const satisfies readonly Lifecycle[]);

const LIFECYCLE_SET: ReadonlySet<string> = new Set(LIFECYCLES);

export const DEFAULT_SELECTION: Readonly<ActiveLifecycleSelection> = Object.freeze({
  kind: "preset",
  lifecycle: "open"
});

export function isLifecycle(value: string): value is Lifecycle {
  return LIFECYCLE_SET.has(value);
}
