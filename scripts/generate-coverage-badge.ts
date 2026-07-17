import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const REPORT_PATH = path.join(ROOT, "coverage", "lcov.info");
const BADGE_PATH = path.join(ROOT, "assets", "coverage.svg");

export interface LineCoverage {
  found: number;
  hit: number;
  percentage: number;
}

export function lineCoverageFromLcov(report: string): LineCoverage {
  let found = 0;
  let hit = 0;

  for (const line of report.split("\n")) {
    if (line.startsWith("LF:")) {
      found += Number.parseInt(line.slice(3), 10);
    } else if (line.startsWith("LH:")) {
      hit += Number.parseInt(line.slice(3), 10);
    }
  }

  if (found === 0 || !Number.isFinite(found) || !Number.isFinite(hit)) {
    throw new Error("LCOV report does not contain valid line coverage totals.");
  }

  return { found, hit, percentage: (hit / found) * 100 };
}

function badgeColor(percentage: number): string {
  if (percentage >= 90) return "#1f883d";
  if (percentage >= 80) return "#2da44e";
  if (percentage >= 70) return "#bf8700";
  return "#cf222e";
}

export function renderCoverageBadge(coverage: LineCoverage): string {
  const percentage = Math.round(coverage.percentage);
  const color = badgeColor(coverage.percentage);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="106" height="20" role="img" aria-label="coverage: ${percentage}%">
  <title>coverage: ${percentage}%</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
    <stop offset=".9" stop-color="#000" stop-opacity=".3"/>
    <stop offset="1" stop-color="#000" stop-opacity=".5"/>
  </linearGradient>
  <clipPath id="r"><rect width="106" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="63" height="20" fill="#555"/>
    <rect x="63" width="43" height="20" fill="${color}"/>
    <rect width="106" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="31.5" y="15" fill="#010101" fill-opacity=".3">coverage</text>
    <text x="31.5" y="14">coverage</text>
    <text x="84.5" y="15" fill="#010101" fill-opacity=".3">${percentage}%</text>
    <text x="84.5" y="14">${percentage}%</text>
  </g>
</svg>
`;
}

function main(): void {
  const badge = renderCoverageBadge(lineCoverageFromLcov(readFileSync(REPORT_PATH, "utf8")));

  if (process.argv.includes("--check")) {
    const current = readFileSync(BADGE_PATH, "utf8");
    if (current !== badge) {
      throw new Error("Coverage badge is stale. Run `bun run coverage:update` and commit it.");
    }
    return;
  }

  writeFileSync(BADGE_PATH, badge);
}

if (import.meta.main) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
