import { LIFECYCLE_OPTIONS, type Lifecycle, type LifecycleOption } from "./lifecycle-options";

export interface LifecycleLayoutOptionEntry {
  readonly type: "option";
  readonly value: Lifecycle;
  readonly visible: boolean;
}

export interface LifecycleLayoutDividerEntry {
  readonly type: "divider";
  readonly id: string;
}

export type LifecycleLayoutEntry = LifecycleLayoutOptionEntry | LifecycleLayoutDividerEntry;

export interface LifecycleLayout {
  readonly version: 1;
  readonly entries: readonly LifecycleLayoutEntry[];
}

function nextDividerId(entries: readonly LifecycleLayoutEntry[]): string {
  const usedIds = new Set(
    entries.filter((entry) => entry.type === "divider").map((entry) => entry.id)
  );
  let sequence = 1;
  while (usedIds.has(`divider-${sequence}`)) {
    sequence += 1;
  }
  return `divider-${sequence}`;
}

export function createDefaultLifecycleLayout(): LifecycleLayout {
  const entries: LifecycleLayoutEntry[] = [];
  for (const option of LIFECYCLE_OPTIONS) {
    if ("startsSection" in option && option.startsSection) {
      entries.push({ type: "divider", id: nextDividerId(entries) });
    }
    entries.push({ type: "option", value: option.value, visible: true });
  }
  return { version: 1, entries };
}

export const DEFAULT_LIFECYCLE_LAYOUT = createDefaultLifecycleLayout();

export function cloneLifecycleLayout(layout: LifecycleLayout): LifecycleLayout {
  return { version: 1, entries: layout.entries.map((entry) => ({ ...entry })) };
}

export function lifecycleLayoutEntryKey(entry: LifecycleLayoutEntry): string {
  return entry.type === "option" ? `option-${entry.value}` : entry.id;
}

export function moveLifecycleLayoutEntry(
  layout: LifecycleLayout,
  key: string,
  offset: -1 | 1
): LifecycleLayout {
  const entries = [...layout.entries];
  const from = entries.findIndex((entry) => lifecycleLayoutEntryKey(entry) === key);
  const to = from + offset;
  const entry = entries[from];
  if (!entry || to < 0 || to >= entries.length) {
    return cloneLifecycleLayout(layout);
  }
  entries.splice(from, 1);
  entries.splice(to, 0, entry);
  return { version: 1, entries };
}

export function placeLifecycleLayoutEntry(
  layout: LifecycleLayout,
  sourceKey: string,
  targetKey: string,
  placement: "before" | "after"
): LifecycleLayout {
  const entries = [...layout.entries];
  const from = entries.findIndex((entry) => lifecycleLayoutEntryKey(entry) === sourceKey);
  if (from < 0 || sourceKey === targetKey) {
    return cloneLifecycleLayout(layout);
  }
  const entry = entries[from];
  if (!entry) {
    return cloneLifecycleLayout(layout);
  }
  entries.splice(from, 1);
  const targetIndex = entries.findIndex(
    (candidate) => lifecycleLayoutEntryKey(candidate) === targetKey
  );
  if (targetIndex < 0) {
    entries.push(entry);
  } else {
    entries.splice(targetIndex + (placement === "after" ? 1 : 0), 0, entry);
  }
  return { version: 1, entries };
}

export function setLifecycleVisibility(
  layout: LifecycleLayout,
  lifecycle: Lifecycle,
  visible: boolean
): LifecycleLayout {
  const visibleCount = layout.entries.filter(
    (entry) => entry.type === "option" && entry.visible
  ).length;
  if (!visible && visibleCount <= 1) {
    return cloneLifecycleLayout(layout);
  }
  return {
    version: 1,
    entries: layout.entries.map((entry) =>
      entry.type === "option" && entry.value === lifecycle ? { ...entry, visible } : { ...entry }
    )
  };
}

export function addLifecycleDivider(layout: LifecycleLayout): LifecycleLayout {
  return {
    version: 1,
    entries: [...layout.entries, { type: "divider", id: nextDividerId(layout.entries) }]
  };
}

export function removeLifecycleDivider(layout: LifecycleLayout, id: string): LifecycleLayout {
  return {
    version: 1,
    entries: layout.entries.filter((entry) => entry.type !== "divider" || entry.id !== id)
  };
}

export function isLifecycleVisible(layout: LifecycleLayout, lifecycle: Lifecycle): boolean {
  return layout.entries.some(
    (entry) => entry.type === "option" && entry.value === lifecycle && entry.visible
  );
}

export function visibleLifecycleLayoutEntries(
  layout: LifecycleLayout,
  options: readonly LifecycleOption[] = LIFECYCLE_OPTIONS,
  temporarilyVisible?: Lifecycle
): readonly (LifecycleOption | LifecycleLayoutDividerEntry)[] {
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  const result: (LifecycleOption | LifecycleLayoutDividerEntry)[] = [];
  let dividerPending = false;

  for (const entry of layout.entries) {
    if (entry.type === "divider") {
      dividerPending = result.length > 0;
      continue;
    }
    if (!entry.visible && entry.value !== temporarilyVisible) {
      continue;
    }
    const option = optionByValue.get(entry.value);
    if (!option) {
      continue;
    }
    if (dividerPending) {
      result.push({ type: "divider", id: `visible-${entry.value}` });
    }
    result.push(option);
    dividerPending = false;
  }
  return result;
}
