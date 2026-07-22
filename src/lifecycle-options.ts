import type { OcticonName } from "./octicons";
import type { CustomLifecycleReason, Lifecycle } from "./lifecycle";

export interface LifecycleOption {
  readonly value: Lifecycle;
  readonly label: string;
  readonly description: string;
  readonly icon: OcticonName;
  readonly startsSection?: boolean;
}

export interface CustomLifecycleOption {
  readonly value: "custom";
  readonly label: string;
  readonly description: string;
  readonly help: string;
  readonly icon: OcticonName;
}

export type LifecycleDisplayOption = LifecycleOption | CustomLifecycleOption;

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
  },
  {
    value: "all",
    label: "All",
    description: "All pull requests",
    icon: "listUnordered",
    startsSection: true
  }
] as const satisfies readonly LifecycleOption[]);

export const CUSTOM_LIFECYCLE_OPTION: Readonly<CustomLifecycleOption> = Object.freeze({
  value: "custom",
  label: "Custom query",
  description: "Current search doesn’t match a preset",
  help: "This GitHub query doesn’t exactly match a lifecycle preset. Choose a preset below or edit the search query directly.",
  icon: "filter"
});

const UNSAFE_CUSTOM_REASONS: ReadonlySet<CustomLifecycleReason> = new Set([
  "correlated",
  "unsupported",
  "invalid"
]);

export function customLifecycleOption(
  reason: CustomLifecycleReason
): Readonly<CustomLifecycleOption> {
  if (!UNSAFE_CUSTOM_REASONS.has(reason)) {
    return CUSTOM_LIFECYCLE_OPTION;
  }
  return Object.freeze({
    ...CUSTOM_LIFECYCLE_OPTION,
    description: "Presets can’t be applied safely",
    help: "This GitHub query can’t be safely changed by the extension. Edit the search query directly to choose another view."
  });
}
