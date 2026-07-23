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

const LIFECYCLE_OPTION_ORDER = Object.freeze([
  "needs_review",
  "open",
  "ready",
  "draft",
  "closed",
  "merged",
  "closed_unmerged",
  "all"
] as const satisfies readonly Lifecycle[]);

const LIFECYCLE_OPTION_METADATA = Object.freeze({
  needs_review: {
    label: "Needs review",
    description: "Open and awaiting review",
    icon: "codeReview"
  },
  open: {
    label: "Open",
    description: "Open, including drafts",
    icon: "gitPullRequest",
    startsSection: true
  },
  ready: {
    label: "Ready",
    description: "Open, not a draft",
    icon: "checkCircle"
  },
  draft: {
    label: "Draft",
    description: "Open drafts",
    icon: "gitPullRequestDraft"
  },
  closed: {
    label: "Closed",
    description: "Closed, including merged",
    icon: "archive",
    startsSection: true
  },
  merged: {
    label: "Merged",
    description: "Successfully merged",
    icon: "gitMerge"
  },
  closed_unmerged: {
    label: "Closed without merging",
    description: "Closed and unmerged",
    icon: "gitPullRequestClosed"
  },
  all: {
    label: "All",
    description: "All pull requests",
    icon: "listUnordered",
    startsSection: true
  }
} as const satisfies Readonly<Record<Lifecycle, Omit<LifecycleOption, "value">>>);

export const LIFECYCLE_OPTIONS: readonly LifecycleOption[] = Object.freeze(
  LIFECYCLE_OPTION_ORDER.map((value) =>
    Object.freeze({
      value,
      ...LIFECYCLE_OPTION_METADATA[value]
    })
  )
);

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
