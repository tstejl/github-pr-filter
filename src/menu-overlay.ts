interface PickerPlacementInput {
  anchor: { top: number; bottom: number; left: number };
  viewport: { top: number; left: number; width: number; height: number };
  width: number;
  naturalHeight: number;
}

/** The cap includes the footer. Short pickers keep their natural height. */
export function pickerPlacement({ anchor, viewport, width, naturalHeight }: PickerPlacementInput) {
  const topEdge = viewport.top + 8;
  const bottomEdge = viewport.top + viewport.height - 8;
  const usableHeight = Math.max(0, viewport.height - 16);
  const below = Math.max(0, Math.min(usableHeight, bottomEdge - anchor.bottom - 8));
  const above = Math.max(0, Math.min(usableHeight, anchor.top - topEdge - 8));
  const flip = Math.min(560, naturalHeight) > below && above > below;
  const available = Math.max(above, below) === 0 ? usableHeight : flip ? above : below;
  const maxHeight = Math.min(560, available);
  const actualHeight = Math.min(naturalHeight, maxHeight);
  return {
    side: flip ? "above" : "below",
    left: Math.max(
      viewport.left + 8,
      Math.min(anchor.left, viewport.left + viewport.width - width - 8)
    ),
    top: Math.max(
      topEdge,
      Math.min(flip ? anchor.top - 8 - actualHeight : anchor.bottom + 8, bottomEdge - actualHeight)
    ),
    maxHeight
  };
}

/** Keep preview menus in the top layer, outside GitHub's clipped list container. */
export function createMenuOverlay(
  control: HTMLDetailsElement,
  summary: HTMLElement,
  menu: HTMLElement
) {
  const view = control.ownerDocument.defaultView;
  let active = false;
  const position = (): void => {
    if (!active || !view) return;
    const anchor = summary.getBoundingClientRect();
    const width = menu.offsetWidth;
    const viewport = view.visualViewport;
    const height = viewport?.height ?? view.innerHeight;
    const availableWidth = viewport?.width ?? view.innerWidth;
    const offsetTop = viewport?.offsetTop ?? 0;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    const editing = Boolean(menu.dataset.mode);
    const scroll = menu.querySelector<HTMLElement>(".gprf-saved-menu-scroll");
    if (!editing && scroll) {
      const footer = menu.querySelector<HTMLElement>(".gprf-saved-menu-footer");
      const css = view.getComputedStyle(menu);
      const edges = [
        css.paddingTop,
        css.paddingBottom,
        css.borderTopWidth,
        css.borderBottomWidth
      ].reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
      const placement = pickerPlacement({
        anchor,
        viewport: { top: offsetTop, left: offsetLeft, width: availableWidth, height },
        width,
        naturalHeight: scroll.scrollHeight + (footer?.offsetHeight ?? 0) + edges
      });
      menu.style.left = `${placement.left}px`;
      menu.style.maxHeight = `${placement.maxHeight}px`;
      menu.style.top = `${placement.top}px`;
      menu.dataset.side = placement.side;
      menu.dataset.moreAbove = String(scroll.scrollTop > 1);
      menu.dataset.moreBelow = String(
        scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 1
      );
      return;
    }
    delete menu.dataset.side;
    delete menu.dataset.moreAbove;
    delete menu.dataset.moreBelow;
    const minimumHeight = editing ? Math.min(520, height - 16) : 80;
    const top =
      offsetTop +
      (editing && availableWidth <= 640
        ? 8
        : Math.max(8, Math.min(anchor.bottom - offsetTop + 8, height - minimumHeight - 8)));
    menu.style.left = `${offsetLeft + Math.max(8, Math.min(anchor.left - offsetLeft, availableWidth - width - 8))}px`;
    menu.style.top = `${top}px`;
    const availableHeight = Math.max(64, height + offsetTop - top - 8);
    menu.style.maxHeight = `${editing && availableWidth > 640 ? Math.min(660, availableHeight) : availableHeight}px`;
  };
  const resize = view ? new view.ResizeObserver(position) : null;
  const hide = (): void => {
    active = false;
    resize?.disconnect();
    view?.removeEventListener("resize", position);
    view?.removeEventListener("scroll", position, true);
    view?.visualViewport?.removeEventListener("resize", position);
    view?.visualViewport?.removeEventListener("scroll", position);
    if (menu.matches(":popover-open")) menu.hidePopover();
  };
  return {
    show(): void {
      if (!control.classList.contains("gprf-lifecycle--preview") || !control.isConnected) return;
      active = true;
      menu.setAttribute("popover", "manual");
      if (!menu.matches(":popover-open")) menu.showPopover();
      position();
      resize?.observe(menu);
      resize?.observe(summary);
      view?.addEventListener("resize", position);
      view?.addEventListener("scroll", position, true);
      view?.visualViewport?.addEventListener("resize", position);
      view?.visualViewport?.addEventListener("scroll", position);
    },
    hide
  };
}
