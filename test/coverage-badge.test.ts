import { describe, expect, test } from "bun:test";
import { lineCoverageFromLcov, renderCoverageBadge } from "../scripts/generate-coverage-badge";

describe("coverage badge", () => {
  test("combines line totals across LCOV records", () => {
    const coverage = lineCoverageFromLcov("LF:50\nLH:40\nend_of_record\nLF:50\nLH:43\n");

    expect(coverage).toEqual({ found: 100, hit: 83, percentage: 83 });
  });

  test("rejects reports without line totals", () => {
    expect(() => lineCoverageFromLcov("TN:\nend_of_record\n")).toThrow(
      "LCOV report does not contain valid line coverage totals."
    );
  });

  test("renders the rounded percentage accessibly", () => {
    const badge = renderCoverageBadge({ found: 100, hit: 83, percentage: 83.4 });

    expect(badge).toContain('aria-label="coverage: 83%"');
    expect(badge).toContain("#2da44e");
  });
});
