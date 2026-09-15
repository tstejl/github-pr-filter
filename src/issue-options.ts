import type { LifecycleOption } from "./lifecycle-options";

/** The only lifecycle choices that have a meaning for repository Issues. */
export const ISSUE_LIFECYCLE_OPTIONS: readonly LifecycleOption[] = Object.freeze([
  Object.freeze({
    value: "open",
    label: "Open",
    description: "Open issues",
    icon: "checkCircle",
    startsSection: true
  }),
  Object.freeze({
    value: "closed",
    label: "Closed",
    description: "Closed issues",
    icon: "archive",
    startsSection: true
  }),
  Object.freeze({
    value: "all",
    label: "All",
    description: "All issues",
    icon: "listUnordered",
    startsSection: true
  })
]);
