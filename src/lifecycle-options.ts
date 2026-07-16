import type { OcticonName } from "./octicons";

export type Lifecycle =
  | "needs_review"
  | "open"
  | "ready"
  | "draft"
  | "closed"
  | "merged"
  | "closed_unmerged";

export interface LifecyclePreferences {
  lifecycle: Lifecycle;
}

export interface LifecycleOption {
  readonly value: Lifecycle;
  readonly label: string;
  readonly description: string;
  readonly icon: OcticonName;
  readonly startsSection?: boolean;
}

export const LIFECYCLE_OPTIONS = Object.freeze([
  {
    value: "needs_review",
    label: "Needs review",
    description: "Open and awaiting review",
    icon: "codeReview"
  },
  {
    value: "open",
    label: "Open",
    description: "Open, including drafts",
    icon: "gitPullRequest",
    startsSection: true
  },
  {
    value: "ready",
    label: "Ready",
    description: "Open, not a draft",
    icon: "checkCircle"
  },
  {
    value: "draft",
    label: "Draft",
    description: "Open drafts",
    icon: "gitPullRequestDraft"
  },
  {
    value: "closed",
    label: "Closed",
    description: "Closed, including merged",
    icon: "archive",
    startsSection: true
  },
  {
    value: "merged",
    label: "Merged",
    description: "Successfully merged",
    icon: "gitMerge"
  },
  {
    value: "closed_unmerged",
    label: "Closed without merging",
    description: "Closed and unmerged",
    icon: "gitPullRequestClosed"
  }
] as const satisfies readonly LifecycleOption[]);

export const DEFAULT_PREFERENCES: Readonly<LifecyclePreferences> = Object.freeze({
  lifecycle: "open"
});

export function isLifecycle(value: string): value is Lifecycle {
  return LIFECYCLE_OPTIONS.some((option) => option.value === value);
}
