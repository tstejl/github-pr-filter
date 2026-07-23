import { describe, test } from "bun:test";
import * as assert from "node:assert/strict";
import {
  ALL_LIFECYCLE_MASK,
  PRESET_LIFECYCLE_MASKS,
  PULL_REQUEST_LIFECYCLE_STATES,
  analyzeLifecycleQuery,
  rewriteLifecycleQuery,
  type PullRequestQueryInput
} from "../src/lifecycle-query";
import { LIFECYCLES, type ActiveLifecycleSelection, type Lifecycle } from "../src/lifecycle";

function input(source: string): PullRequestQueryInput {
  return { source };
}

function selection(source: string): ActiveLifecycleSelection {
  return analyzeLifecycleQuery(input(source)).selection;
}

function preset(lifecycle: Lifecycle): ActiveLifecycleSelection {
  return { kind: "preset", lifecycle };
}

describe("lifecycle query analysis", () => {
  test("models the complete five-state lifecycle universe", () => {
    const stateBits = Object.values(PULL_REQUEST_LIFECYCLE_STATES);
    assert.equal(new Set(stateBits).size, 5);
    assert.equal(
      stateBits.reduce((mask, state) => mask | state, 0),
      ALL_LIFECYCLE_MASK
    );
    assert.equal(
      PRESET_LIFECYCLE_MASKS.open,
      PULL_REQUEST_LIFECYCLE_STATES.openDraft | PULL_REQUEST_LIFECYCLE_STATES.openReady
    );
    assert.equal(
      PRESET_LIFECYCLE_MASKS.closed,
      PULL_REQUEST_LIFECYCLE_STATES.closedUnmergedDraft |
        PULL_REQUEST_LIFECYCLE_STATES.closedUnmergedReady |
        PULL_REQUEST_LIFECYCLE_STATES.merged
    );
  });

  test("distinguishes GitHub's empty-query Open default from explicit All", () => {
    for (const queryInput of [input(""), input("   ")]) {
      const analysis = analyzeLifecycleQuery(queryInput);
      assert.deepEqual(analysis.selection, preset("open"));
      assert.equal(analysis.resolution, "exact");
    }

    for (const source of [
      "is:pr",
      "is:pr label:bug",
      "label:bug",
      "is:pr -review:approved -review:changes_requested"
    ]) {
      const analysis = analyzeLifecycleQuery(input(source));
      assert.deepEqual(analysis.selection, preset("all"));
      assert.equal(analysis.resolution, "unconstrained");
    }
  });

  test("recognizes exact presets independent of qualifier spelling and order", () => {
    const cases: readonly [string, Lifecycle][] = [
      ["is:pr is:open", "open"],
      ["label:x state:open", "open"],
      ["label:x is:OPEN", "open"],
      ["label:x draft:False is:open", "ready"],
      ["draft:false is:open", "ready"],
      ["-is:draft state:open", "ready"],
      ["is:draft is:open", "draft"],
      ["draft:true state:open", "draft"],
      ["is:closed", "closed"],
      ["-state:open", "closed"],
      ["-state:closed", "open"],
      ["is:merged", "merged"],
      ["is:closed -is:merged", "closed_unmerged"],
      ["is:closed is:unmerged", "closed_unmerged"],
      ["is:open is:unmerged", "open"],
      ["is:merged draft:false", "merged"]
    ];

    for (const [source, lifecycle] of cases) {
      assert.deepEqual(selection(source), preset(lifecycle), source);
    }
  });

  test("matches the independently observed mask for every supported negated primitive", () => {
    const states = PULL_REQUEST_LIFECYCLE_STATES;
    const draftMask = states.openDraft | states.closedUnmergedDraft;
    const unmergedMask = ALL_LIFECYCLE_MASK & ~states.merged;
    const nonDraftMask = ALL_LIFECYCLE_MASK & ~draftMask;
    const cases = [
      ["state:open", PRESET_LIFECYCLE_MASKS.open],
      ["-state:closed", PRESET_LIFECYCLE_MASKS.open],
      ["state:closed", PRESET_LIFECYCLE_MASKS.closed],
      ["-state:open", PRESET_LIFECYCLE_MASKS.closed],
      ["is:merged", states.merged],
      ["-is:unmerged", states.merged],
      ["is:unmerged", unmergedMask],
      ["-is:merged", unmergedMask],
      ["is:draft", draftMask],
      ["draft:true", draftMask],
      ["-draft:false", draftMask],
      ["draft:false", nonDraftMask],
      ["-draft:true", nonDraftMask],
      ["-is:draft", nonDraftMask]
    ] as const;

    for (const [source, expectedMask] of cases) {
      assert.equal(analyzeLifecycleQuery(input(source)).mask, expectedMask, source);
    }
  });

  test("reports the physical open/closed partition for exact and Custom masks", () => {
    const cases = [
      ["is:open", "open"],
      ["is:merged", "closed"],
      ["is:pr", "both"],
      ["is:pr draft:true", "both"],
      ["is:closed draft:true", "closed"],
      ["is:open is:closed", "none"]
    ] as const;
    for (const [source, statePartition] of cases) {
      assert.equal(analyzeLifecycleQuery(input(source)).statePartition, statePartition, source);
    }
  });

  test("recognizes Needs review only from its complete canonical signature", () => {
    const complete = analyzeLifecycleQuery(
      input(
        "is:pr -review:changes_requested label:bug draft:false is:open -review:approved reviewed-by:octocat"
      )
    );
    assert.deepEqual(complete.selection, preset("needs_review"));
    assert.equal(complete.ownsNeedsReviewReviewTerms, true);

    for (const source of [
      "is:pr -review:approved -review:changes_requested",
      "is:pr is:open -review:approved -review:changes_requested",
      "is:pr is:open draft:false -review:approved",
      "is:pr is:open draft:false review:changes_requested",
      "is:pr is:open draft:false -review:approved -review:changes_requested review:none",
      "is:pr is:open draft:false -review:APPROVED -review:CHANGES_REQUESTED"
    ]) {
      assert.notDeepEqual(selection(source), preset("needs_review"), source);
    }
  });

  test("never owns parenthesized review qualifiers on repository Pulls pages", () => {
    const source = "is:open draft:false (-review:approved) (-review:changes_requested) label:bug";
    assert.deepEqual(selection(source), preset("ready"));

    const needsReview = rewriteLifecycleQuery(input(source), "needs_review");
    assert.equal(needsReview.kind, "unsafe");
    assert.equal(needsReview.reason, "review-correlated");

    const closed = rewriteLifecycleQuery(input(source), "closed");
    assert.equal(closed.kind, "rewritten");
    assert.equal(
      closed.input.source,
      "(-review:approved) (-review:changes_requested) label:bug is:closed"
    );
  });

  test("keeps native review filters orthogonal to base lifecycle selection", () => {
    for (const review of ["none", "required", "approved", "changes_requested"]) {
      assert.deepEqual(selection(`is:pr is:open draft:false review:${review}`), preset("ready"));
      assert.deepEqual(selection(`is:pr is:open review:${review}`), preset("open"));
    }
  });

  test("accepts semantically identical lifecycle and Needs-review duplicates", () => {
    for (const source of [
      "is:open is:open",
      "state:open state:open",
      "is:open state:open",
      "is:open state:open -state:closed"
    ]) {
      assert.deepEqual(selection(source), preset("open"), source);
    }
    assert.deepEqual(selection("is:open is:draft draft:true"), preset("draft"));
    assert.equal(
      analyzeLifecycleQuery(input("draft:false -draft:true -is:draft")).mask,
      ALL_LIFECYCLE_MASK &
        ~(
          PULL_REQUEST_LIFECYCLE_STATES.openDraft |
          PULL_REQUEST_LIFECYCLE_STATES.closedUnmergedDraft
        )
    );
    assert.deepEqual(
      selection("is:open draft:false -review:approved -review:approved -review:changes_requested"),
      preset("needs_review")
    );
  });

  test("matches GitHub's inert negated is:open and is:closed behavior", () => {
    assert.deepEqual(selection("-is:open"), preset("all"));
    assert.deepEqual(selection("-is:closed"), preset("all"));
    assert.deepEqual(selection("is:open -is:open"), preset("open"));
    assert.deepEqual(selection("is:closed -is:closed"), preset("closed"));
    assert.deepEqual(selection("draft:true -is:closed"), {
      kind: "custom",
      reason: "partial"
    });

    const rewritten = rewriteLifecycleQuery(input("-is:open label:bug"), "draft");
    assert.equal(rewritten.kind, "rewritten");
    assert.equal(rewritten.input.source, "-is:open label:bug is:open draft:true");
    assert.deepEqual(rewritten.analysis.selection, preset("draft"));
  });

  test("keeps case-sensitive qualifier keys opaque", () => {
    assert.deepEqual(selection("IS:open"), preset("all"));
    assert.deepEqual(selection("STATE:open"), preset("all"));
    assert.deepEqual(selection("DRAFT:false"), preset("all"));
    assert.deepEqual(selection("IS:open is:closed"), preset("closed"));

    const rewritten = rewriteLifecycleQuery(input("IS:open label:bug"), "draft");
    assert.equal(rewritten.kind, "rewritten");
    assert.equal(rewritten.input.source, "IS:open label:bug is:open draft:true");
    assert.deepEqual(rewritten.analysis.selection, preset("draft"));
  });

  test("classifies partial lifecycle masks as Custom rather than a nearby preset", () => {
    const cases = [
      "is:pr draft:false",
      "is:pr draft:true",
      "is:pr is:unmerged",
      "is:pr is:closed draft:true",
      "is:pr is:closed draft:false"
    ] as const;

    for (const source of cases) {
      const analysis = analyzeLifecycleQuery(input(source));
      assert.deepEqual(analysis.selection, { kind: "custom", reason: "partial" }, source);
      assert.equal(analysis.resolution, "partial");
      assert.equal(analysis.safeToRewrite, true);
    }
  });

  test("classifies repeated lifecycle dimensions as order-sensitive Custom queries", () => {
    for (const source of [
      "is:open is:closed",
      "state:open state:closed",
      "state:open -state:open",
      "-state:closed state:closed",
      "draft:true draft:false",
      "is:draft -is:draft",
      "-draft:false -draft:true",
      "is:merged is:unmerged",
      "is:merged -is:merged"
    ]) {
      const analysis = analyzeLifecycleQuery(input(source));
      assert.deepEqual(analysis.selection, { kind: "custom", reason: "ambiguous" });
      assert.equal(analysis.resolution, "ambiguous");
      assert.equal(analysis.mask, null);
      assert.equal(analysis.safeToRewrite, true);
    }
  });

  test("classifies incompatible constraints from distinct dimensions as conflicting", () => {
    const analysis = analyzeLifecycleQuery(input("is:merged draft:true"));
    assert.deepEqual(analysis.selection, { kind: "custom", reason: "conflicting" });
    assert.equal(analysis.resolution, "conflicting");
    assert.equal(analysis.mask, 0);
    assert.equal(analysis.safeToRewrite, true);
  });

  test("does not interpret explicit Boolean or parenthesized lifecycle syntax on Pulls pages", () => {
    for (const source of [
      "is:open OR is:closed",
      "(is:open OR is:merged) is:unmerged",
      "is:closed AND is:unmerged",
      "(is:open)"
    ]) {
      const analysis = analyzeLifecycleQuery(input(source));
      assert.deepEqual(analysis.selection, { kind: "custom", reason: "unsupported" }, source);
      assert.equal(analysis.resolution, "unsupported", source);
      assert.equal(analysis.safeToRewrite, false, source);
    }
  });

  test("marks lifecycle and orthogonal OR branches as correlated", () => {
    for (const source of [
      "is:open OR label:bug",
      "(is:open AND label:one) OR (is:closed AND label:two)",
      "is:pr (draft:true OR author:octocat)"
    ]) {
      const analysis = analyzeLifecycleQuery(input(source));
      assert.deepEqual(analysis.selection, { kind: "custom", reason: "correlated" });
      assert.equal(analysis.resolution, "correlated");
      assert.equal(analysis.mask, null);
      assert.equal(analysis.safeToRewrite, false);
    }
  });

  test("marks malformed source invalid and never invents a lifecycle", () => {
    for (const source of ["is:open AND", "(is:open", 'label:"unterminated']) {
      const analysis = analyzeLifecycleQuery(input(source));
      assert.deepEqual(analysis.selection, { kind: "custom", reason: "invalid" });
      assert.equal(analysis.resolution, "invalid");
      assert.equal(analysis.safeToRewrite, false);
    }
  });

  test("marks unsupported lifecycle-shaped qualifiers as Custom", () => {
    for (const source of [
      "state:'open' label:bug",
      "state:open,closed",
      "state:OPEN",
      "state:",
      "-draft:",
      "is:",
      "draft:maybe",
      "is:open,merged"
    ]) {
      const analysis = analyzeLifecycleQuery(input(source));
      assert.deepEqual(analysis.selection, { kind: "custom", reason: "unsupported" }, source);
      assert.equal(analysis.resolution, "unsupported", source);
      assert.equal(analysis.safeToRewrite, false, source);
    }
  });
});

describe("lifecycle query rewriting", () => {
  test("reselecting the displayed preset is a byte-for-byte no-op", () => {
    const sources: readonly [string, Lifecycle][] = [
      ["", "open"],
      ["  is:pr   label:bug  ", "all"],
      ["label:bug state:open", "open"],
      ["is:pr review:approved draft:false is:open", "ready"],
      ["is:pr is:open draft:false -review:approved -review:changes_requested", "needs_review"]
    ];

    for (const [source, lifecycle] of sources) {
      const queryInput = input(source);
      const result = rewriteLifecycleQuery(queryInput, lifecycle);
      assert.equal(result.kind, "unchanged", source);
      assert.equal(result.input.source, source);
    }
  });

  test("All is explicit and can never collapse to GitHub's Open default", () => {
    const result = rewriteLifecycleQuery(input(""), "all");
    assert.equal(result.kind, "rewritten");
    assert.equal(result.input.source, "is:pr");
    assert.deepEqual(result.analysis.selection, preset("all"));

    const fromOnlyLifecycle = rewriteLifecycleQuery(input("is:open"), "all");
    assert.equal(fromOnlyLifecycle.kind, "rewritten");
    assert.equal(fromOnlyLifecycle.input.source, "is:pr");
  });

  test("All preserves arbitrary item-type filters without adding a contradictory scope", () => {
    const cases: readonly [string, string][] = [
      ["is:open -is:pr label:bug", "-is:pr label:bug"],
      ["is:open type:issue label:bug", "type:issue label:bug"],
      ["(is:pr OR author:octocat) is:open", "(is:pr OR author:octocat)"]
    ];

    for (const [source, expected] of cases) {
      const result = rewriteLifecycleQuery(input(source), "all");
      assert.equal(result.kind, "rewritten", source);
      assert.equal(result.input.source, expected, source);
      assert.deepEqual(result.analysis.selection, preset("all"), source);
    }
  });

  test("preserves arbitrary orthogonal filters while replacing lifecycle terms", () => {
    const result = rewriteLifecycleQuery(
      input('is:pr state:closed label:"ready for review" author:octocat reviewed-by:hubot'),
      "draft"
    );
    assert.equal(result.kind, "rewritten");
    assert.equal(
      result.input.source,
      'is:pr label:"ready for review" author:octocat reviewed-by:hubot is:open draft:true'
    );
    assert.deepEqual(result.analysis.selection, preset("draft"));
  });

  test("preserves apostrophes in free text while replacing lifecycle terms", () => {
    const result = rewriteLifecycleQuery(input("is:pr is:open don't"), "closed");
    assert.equal(result.kind, "rewritten");
    assert.equal(result.input.source, "is:pr don't is:closed");
    assert.deepEqual(result.analysis.selection, preset("closed"));
  });

  test("does not rewrite single-quoted lifecycle values as if GitHub supported them", () => {
    const analysis = analyzeLifecycleQuery(input("state:'open' label:bug"));
    assert.deepEqual(analysis.selection, { kind: "custom", reason: "unsupported" });

    const result = rewriteLifecycleQuery(input("state:'open' label:bug"), "draft");
    assert.equal(result.kind, "unsafe");
    assert.equal(result.reason, "unsupported");
    assert.equal(result.input.source, "state:'open' label:bug");
  });

  test("rewrites flat global conjunctions but refuses correlated Boolean queries", () => {
    const safe = rewriteLifecycleQuery(input("is:closed label:bug author:octocat"), "open");
    assert.equal(safe.kind, "rewritten");
    assert.equal(safe.input.source, "label:bug author:octocat is:open");

    const unsafe = rewriteLifecycleQuery(
      input("(is:open AND label:one) OR (is:closed AND label:two)"),
      "draft"
    );
    assert.equal(unsafe.kind, "unsafe");
    assert.equal(unsafe.reason, "correlated");
    assert.equal(unsafe.input.source, "(is:open AND label:one) OR (is:closed AND label:two)");
  });

  test("preserves an orthogonal OR expression while applying a global lifecycle", () => {
    const result = rewriteLifecycleQuery(input("(label:bug OR author:octocat) is:closed"), "draft");
    assert.equal(result.kind, "rewritten");
    assert.equal(result.input.source, "(label:bug OR author:octocat) is:open draft:true");
    assert.deepEqual(result.analysis.selection, preset("draft"));
  });

  test("refuses a rewrite that cannot prove its own resulting lifecycle", () => {
    const source = `author:o'connor AND -review:changes_requested label:"product ux" is:pr`;
    const result = rewriteLifecycleQuery(input(source), "open");
    assert.equal(result.kind, "unsafe");
    assert.equal(result.reason, "correlated");
    assert.equal(result.input.source, source);
  });

  test("never rewrites parentheses attached to opaque query text", () => {
    for (const source of ["foo(bar)", "(bar)foo", "is:open(review:approved)"]) {
      const result = rewriteLifecycleQuery(input(source), "closed");
      assert.equal(result.kind, "unsafe", source);
      assert.equal(result.reason, "unsupported", source);
      assert.equal(result.input.source, source);
    }
  });

  test("refuses to rewrite explicit Boolean lifecycle expressions", () => {
    const result = rewriteLifecycleQuery(input("is:open OR is:closed"), "merged");
    assert.equal(result.kind, "unsafe");
    assert.equal(result.reason, "unsupported");
    assert.equal(result.input.source, "is:open OR is:closed");
  });

  test("leaving Needs review removes only its canonical review signature", () => {
    const result = rewriteLifecycleQuery(
      input(
        "is:pr is:open draft:false -review:approved -review:changes_requested reviewed-by:octocat review-requested:hubot label:bug"
      ),
      "closed"
    );
    assert.equal(result.kind, "rewritten");
    assert.equal(
      result.input.source,
      "is:pr reviewed-by:octocat review-requested:hubot label:bug is:closed"
    );
    assert.deepEqual(result.analysis.selection, preset("closed"));
  });

  test("review-only All is stable when reselected and preserved for other base states", () => {
    const source = "is:pr -review:approved -review:changes_requested label:bug";
    const all = rewriteLifecycleQuery(input(source), "all");
    assert.equal(all.kind, "unchanged");
    assert.equal(all.input.source, source);

    const open = rewriteLifecycleQuery(input(source), "open");
    assert.equal(open.kind, "rewritten");
    assert.equal(
      open.input.source,
      "is:pr -review:approved -review:changes_requested label:bug is:open"
    );
    assert.deepEqual(open.analysis.selection, preset("open"));
  });

  test("selecting Ready removes an exact negative pair that would become Needs review", () => {
    const result = rewriteLifecycleQuery(
      input("is:pr -review:approved -review:changes_requested label:bug"),
      "ready"
    );
    assert.equal(result.kind, "rewritten");
    assert.equal(result.input.source, "is:pr label:bug is:open draft:false");
    assert.deepEqual(result.analysis.selection, preset("ready"));
  });

  test("entering Needs review replaces status filters but preserves reviewer identity filters", () => {
    const result = rewriteLifecycleQuery(
      input(
        "is:pr is:open review:approved -review:required reviewed-by:octocat review-requested:hubot user-review-requested:@me team-review-requested:org/team label:bug"
      ),
      "needs_review"
    );
    assert.equal(result.kind, "rewritten");
    assert.equal(
      result.input.source,
      "is:pr reviewed-by:octocat review-requested:hubot user-review-requested:@me team-review-requested:org/team label:bug is:open draft:false -review:approved -review:changes_requested"
    );
    assert.deepEqual(result.analysis.selection, preset("needs_review"));
  });

  test("refuses Needs review when review status is nested in Boolean logic", () => {
    const result = rewriteLifecycleQuery(
      input("is:pr is:open (review:approved OR label:exception)"),
      "needs_review"
    );
    assert.equal(result.kind, "unsafe");
    assert.equal(result.reason, "review-correlated");
  });

  test("rewrites separable partial and ambiguous queries to exact targets", () => {
    const cases: readonly [string, string][] = [
      ["is:pr draft:false label:bug", "is:pr label:bug is:merged"],
      ["is:open is:closed label:bug", "label:bug is:merged"]
    ];
    for (const [source, expected] of cases) {
      const result = rewriteLifecycleQuery(input(source), "merged");
      assert.equal(result.kind, "rewritten");
      assert.deepEqual(result.analysis.selection, preset("merged"));
      assert.equal(result.input.source, expected);
    }
  });

  test("every successful preset rewrite round-trips, is idempotent, and preserves filters", () => {
    const targets: readonly Lifecycle[] = [
      "all",
      "needs_review",
      "open",
      "ready",
      "draft",
      "closed",
      "merged",
      "closed_unmerged"
    ];

    for (const target of targets) {
      const first = rewriteLifecycleQuery(
        input('is:pr state:closed is:unmerged label:"product ux" author:octocat'),
        target
      );
      assert.notEqual(first.kind, "unsafe", target);
      if (first.kind === "unchanged") {
        assert.deepEqual(first.analysis.selection, preset(target), target);
        continue;
      }
      assert.deepEqual(first.analysis.selection, preset(target), target);
      assert.match(first.input.source, /label:"product ux"/u, target);
      assert.match(first.input.source, /author:octocat/u, target);

      const second = rewriteLifecycleQuery(first.input, target);
      assert.equal(second.kind, "unchanged", target);
      assert.equal(second.input.source, first.input.source, target);
    }
  });

  test("never rewrites invalid input", () => {
    const source = "is:open AND";
    const result = rewriteLifecycleQuery(input(source), "closed");
    assert.equal(result.kind, "unsafe");
    assert.equal(result.reason, "invalid");
    assert.equal(result.input.source, source);
  });

  test("deterministic arbitrary inputs preserve rewrite safety invariants", () => {
    const fragments = [
      "is:pr",
      "is:open",
      "state:closed",
      "draft:true",
      "is:merged",
      "is:unmerged",
      "-review:approved",
      "-review:changes_requested",
      'label:"product ux"',
      "author:o'connor",
      "AND",
      "OR",
      "(",
      ")",
      '"unterminated',
      "state:",
      "🌱"
    ] as const;
    let seed = 0x5eed1234;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };

    for (let example = 0; example < 512; example += 1) {
      const length = next() % 10;
      const parts = Array.from({ length }, () => fragments[next() % fragments.length] as string);
      const source = parts.join(next() % 4 === 0 ? "" : " ");
      const original = input(source);
      analyzeLifecycleQuery(original);

      for (const target of LIFECYCLES) {
        const first = rewriteLifecycleQuery(original, target);
        if (first.kind === "unsafe") {
          assert.equal(first.input.source, source);
          continue;
        }
        assert.deepEqual(
          first.analysis.selection,
          preset(target),
          `${target}: ${JSON.stringify(source)}`
        );
        const second = rewriteLifecycleQuery(first.input, target);
        assert.equal(second.kind, "unchanged");
        assert.equal(second.input.source, first.input.source);
      }
    }
  });
});
