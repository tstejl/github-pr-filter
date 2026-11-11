function rowFor(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>(".gprf-saved-option") : null;
}

/** A separate top-layer popover keeps descriptions outside the picker's clipped scroller. */
export function createViewDescriptionTooltip(control: HTMLElement, menu: HTMLElement) {
  const doc = control.ownerDocument;
  const foundView = doc.defaultView;
  if (!foundView) throw new Error("View descriptions require a window");
  const view = foundView;
  const tooltip = doc.createElement("div");
  tooltip.className = "gprf-view-description-tooltip";
  tooltip.id = `gprf-description-tooltip-${crypto.randomUUID()}`;
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("popover", "manual");
  control.append(tooltip);
  const events = new AbortController();
  const { signal } = events;
  let disposed = false;
  let activeRow: HTMLAnchorElement | null = null;
  let hoveredRow: HTMLAnchorElement | null = null;
  let hoverTimer = 0;
  let closeTimer = 0;
  let focusFrame = 0;

  function cancelHover(): void {
    view.clearTimeout(hoverTimer);
    hoverTimer = 0;
  }
  function cancelClose(): void {
    view.clearTimeout(closeTimer);
    closeTimer = 0;
  }
  function dismiss(cancelFocus = true): void {
    cancelHover();
    cancelClose();
    if (cancelFocus) {
      view.cancelAnimationFrame(focusFrame);
      focusFrame = 0;
    }
    if (activeRow) {
      const description = activeRow.querySelector(".gprf-view-copy > span");
      if (description?.id) activeRow.setAttribute("aria-describedby", description.id);
      else activeRow.removeAttribute("aria-describedby");
    }
    activeRow = null;
    if (tooltip.matches(":popover-open")) tooltip.hidePopover();
  }
  function reset(): void {
    hoveredRow = null;
    dismiss();
  }
  function reveal(row: HTMLAnchorElement): void {
    cancelHover();
    cancelClose();
    if (disposed || !menu.matches(":popover-open") || menu.dataset.mode || !menu.contains(row)) {
      dismiss();
      return;
    }
    const description = row.querySelector<HTMLElement>(".gprf-view-copy > span");
    const scroller = menu.querySelector<HTMLElement>(".gprf-saved-menu-scroll");
    if (!description || description.scrollWidth <= description.clientWidth + 1 || !scroller) {
      dismiss();
      return;
    }
    const anchor = row.getBoundingClientRect();
    const bounds = scroller.getBoundingClientRect();
    if (anchor.top < bounds.top - 1 || anchor.bottom > bounds.bottom + 1) {
      dismiss();
      return;
    }
    dismiss(false);
    activeRow = row;
    tooltip.textContent = description.textContent;
    row.setAttribute("aria-describedby", tooltip.id);
    const viewport = view.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? view.innerWidth) - 8;
    const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? view.innerHeight) - 8;
    tooltip.style.maxWidth = `${Math.max(0, Math.min(280, right - left))}px`;
    tooltip.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    tooltip.showPopover();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    let x = anchor.right + 8;
    let y = anchor.top + (anchor.height - height) / 2;
    let side = "right";
    if (x + width > right) {
      if (anchor.left - 8 - width >= left) {
        x = anchor.left - 8 - width;
        side = "left";
      } else {
        x = anchor.left;
        y = anchor.bottom + 8;
        side = "below";
        if (y + height > bottom && anchor.top - 8 - height >= top) {
          y = anchor.top - 8 - height;
          side = "above";
        }
      }
    }
    tooltip.style.left = `${Math.max(left, Math.min(x, right - width))}px`;
    tooltip.style.top = `${Math.max(top, Math.min(y, bottom - height))}px`;
    tooltip.dataset.side = side;
  }
  menu.addEventListener(
    "pointerover",
    (event) => {
      if (event.pointerType === "touch") return;
      const row = rowFor(event.target);
      if (!row || hoveredRow === row) return;
      hoveredRow = row;
      cancelClose();
      cancelHover();
      hoverTimer = view.setTimeout(() => reveal(row), 350);
    },
    { signal }
  );
  menu.addEventListener(
    "pointerout",
    (event) => {
      const row = rowFor(event.target);
      if (!row || rowFor(event.relatedTarget) === row) return;
      hoveredRow = null;
      cancelHover();
      if (event.relatedTarget instanceof Node && tooltip.contains(event.relatedTarget)) {
        cancelClose();
        return;
      }
      if (doc.activeElement === activeRow) return;
      closeTimer = view.setTimeout(() => dismiss(), 150);
    },
    { signal }
  );
  tooltip.addEventListener(
    "pointerenter",
    () => {
      cancelHover();
      cancelClose();
    },
    { signal }
  );
  tooltip.addEventListener(
    "pointerleave",
    (event) => {
      if (rowFor(event.relatedTarget) === activeRow || doc.activeElement === activeRow) return;
      closeTimer = view.setTimeout(() => dismiss(), 150);
    },
    { signal }
  );
  menu.addEventListener(
    "focusin",
    (event) => {
      const row = rowFor(event.target);
      dismiss();
      // Arrow-key navigation scrolls the row into view after focus moves.
      if (row)
        focusFrame = view.requestAnimationFrame(() => {
          focusFrame = 0;
          if (doc.activeElement === row) reveal(row);
        });
    },
    { signal }
  );
  menu.addEventListener("focusout", () => dismiss(), { signal });
  menu.addEventListener("click", reset, { capture: true, signal });
  menu.addEventListener(
    "toggle",
    () => {
      if (!menu.matches(":popover-open")) reset();
    },
    { signal }
  );
  doc.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !tooltip.matches(":popover-open")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    },
    { capture: true, signal }
  );
  view.addEventListener(
    "scroll",
    (event) => {
      if (event.target instanceof Node && tooltip.contains(event.target)) return;
      hoveredRow = null;
      // Keep a pending keyboard reveal; it runs after the focused row has scrolled.
      dismiss(false);
    },
    { capture: true, signal }
  );
  view.addEventListener("resize", reset, { signal });
  view.visualViewport?.addEventListener("resize", reset, { signal });
  view.visualViewport?.addEventListener("scroll", reset, { signal });
  return {
    reset,
    destroy(): void {
      disposed = true;
      reset();
      events.abort();
      tooltip.remove();
    }
  };
}
