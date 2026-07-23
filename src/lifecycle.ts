export const LIFECYCLES = Object.freeze([
  "all",
  "needs_review",
  "open",
  "ready",
  "draft",
  "closed",
  "merged",
  "closed_unmerged"
] as const);

export type Lifecycle = (typeof LIFECYCLES)[number];

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

const LIFECYCLE_SET: ReadonlySet<string> = new Set(LIFECYCLES);

export const DEFAULT_SELECTION: Readonly<ActiveLifecycleSelection> = Object.freeze({
  kind: "preset",
  lifecycle: "open"
});

export function isLifecycle(value: string): value is Lifecycle {
  return LIFECYCLE_SET.has(value);
}
