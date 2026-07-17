import type { Octicon } from "./octicons";

export function createIcon(document: Document, icon: Octicon): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("viewBox", icon.viewBox);
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.classList.add("octicon", "gprf-lifecycle-icon");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", icon.path);
  svg.append(path);
  return svg;
}

export function createIconButton(
  document: Document,
  className: string,
  label: string,
  icon: Octicon
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(createIcon(document, icon));
  return button;
}

export function createTextButton(
  document: Document,
  className: string,
  label: string
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}
