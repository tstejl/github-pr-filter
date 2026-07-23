export const REPLACEMENT_PENDING_CLASS = "gprf-replacement-pending";
export const REPLACEMENT_MOUNTED_CLASS = "gprf-replacement-mounted";

export interface PageMarkerRoot {
  readonly classList: Pick<DOMTokenList, "add" | "remove">;
}

export interface PageMarkerController {
  update(supported: boolean): void;
  destroy(): void;
}

interface PageMarkerControllerDependencies {
  readonly root: () => PageMarkerRoot | null;
}

export function markReplacementPending(root: PageMarkerRoot | null): void {
  root?.classList.add(REPLACEMENT_PENDING_CLASS);
  root?.classList.remove(REPLACEMENT_MOUNTED_CLASS);
}

export function markReplacementMounted(root: PageMarkerRoot | null): void {
  root?.classList.add(REPLACEMENT_MOUNTED_CLASS);
  root?.classList.remove(REPLACEMENT_PENDING_CLASS);
}

export function clearPageMarkers(root: PageMarkerRoot | null): void {
  root?.classList.remove(REPLACEMENT_PENDING_CLASS, REPLACEMENT_MOUNTED_CLASS);
}

export function createPageMarkerController(
  dependencies: PageMarkerControllerDependencies
): PageMarkerController {
  return {
    update(supported) {
      const root = dependencies.root();
      if (!supported) {
        clearPageMarkers(root);
        return;
      }
      markReplacementPending(root);
    },
    destroy() {
      clearPageMarkers(dependencies.root());
    }
  };
}
