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
    const top = Math.max(8, Math.min(anchor.bottom + 8, view.innerHeight - 80));
    menu.style.left = `${Math.max(8, Math.min(anchor.left, view.innerWidth - width - 8))}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(64, view.innerHeight - top - 8)}px`;
  };
  const resize = view ? new view.ResizeObserver(position) : null;
  const hide = (): void => {
    active = false;
    resize?.disconnect();
    view?.removeEventListener("resize", position);
    view?.removeEventListener("scroll", position, true);
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
    },
    hide
  };
}
