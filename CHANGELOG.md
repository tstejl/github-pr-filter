# Changelog

All notable changes will be documented in this file.

## 0.9.0

- Updated Bun to 1.4.4 and added type-aware lint and build checks.
- Added an in-place editor for saved views on repository pull-request pages.
- Used uniform 44px picker rows, centered description-free content, and a viewport-aware 560px panel cap with a fixed footer.
- Revealed truncated descriptions on row hover or keyboard focus without changing row height, with viewport-aware placement and Escape dismissal.
- Fixed native-header flashes during in-page filter changes by replacing rebuilt controls before the next paint.
- Added a CI audit for E2E registration, catalog-driven execution, explicit retirement records, and restored cross-controller regression coverage.
- Limited editor reads and writes to the current repository.
- Staged changes in the editor until an explicit save, with Back retaining drafts and Cancel changes discarding the complete session.
- Separated menu visibility from view definitions, with a hidden-view status and a link to its visibility control.
- Replaced Restore defaults with additive starter copies and added undoable deletion for views and separators.
- Validated all unfinished views before saving and preserved selected identities when equivalent queries are reordered.
- Kept older all-repository view data in storage without loading or changing it.
- Changed view selection to replace the complete query with the saved query.
- Used `state:open` and `state:closed` in built-in defaults and examples, with both spellings supported for matching.
- Added a predicate registry for query aliases and conservative matching of repeated or conflicting filters.
- Added explicit state transitions for repository loads, result counts, and staged view edits.
- Preserved legacy layouts during migration and protected unreadable or newer-format data from edits.
- Limited the injected menu to refreshed repository pull-request lists. Legacy controls remain native.

## 0.8.1 — 2026-09-18

- Fixed a closing-menu flash when navigation delays the timer that hides the dropdown.
- Fixed counts that stayed hidden after switching between PR searches with the same result count, including zero results.
- Restored counts when the associated list finishes loading, while keeping stale counts hidden during refreshes.

## 0.8.0 — 2026-09-17

- Added support for GitHub's new repository pull-request list while retaining classic-page support.
- Replaced Open/Closed tabs and result-count headers in place, including merged, all, and empty search results.
- Matched the new page's button hover styling and kept expanded menus above clipped list containers.
- Fixed repeated opening flicker on both page layouts and preserved keyboard focus during menu transitions.
- Stabilized labels and counts during search updates, delayed page loading, and navigation without a full reload.
- Kept Issues pages unchanged. Experimental Issues support remains disabled in this release.

## 0.7.1 — 2026-07-30

- Tightened **Needs review** to use GitHub's explicit `review:required` state, preventing
  approved pull requests—including stacked pull requests—from appearing in that view.
- Added compatibility for both `review:changes-requested` and the legacy
  `review:changes_requested` spelling while preserving reviewer-specific filters.

## 0.7.0 — 2026-07-22

- Added explicit All and Custom query states so the lifecycle menu always reflects GitHub's
  current search instead of guessing a nearby preset.
- Reworked lifecycle-query parsing and rewriting to preserve unrelated filters and disable
  preset actions when a query cannot be changed safely.
- Added contextual help for Custom queries, including distinct guidance for replaceable and
  unsafe searches.
- Expanded controlled unit, browser, and Storybook coverage for query interpretation,
  navigation, accessibility, and GitHub theme variants.

## 0.6.0 — 2026-07-17

- Added per-repository lifecycle menu customization for hiding, reordering, and grouping
  states with separators.
- Stored customized layouts locally and synchronized them between extension contexts while
  keeping GitHub's query as the active source of truth.
- Kept hidden active states visible and explainable when opening a matching GitHub query.
- Added safe storage recovery: corrupted layouts are removed and replaced with defaults,
  while unreadable or newer-format data degrades without blocking the menu.

## 0.5.0 — 2026-07-16

- Added a Needs review lifecycle view for open, non-draft pull requests that are neither
  approved nor awaiting changes (`-review:approved -review:changes_requested`).
- Selecting Needs review replaces conflicting review-status qualifiers; all other search
  terms and native review filters remain preserved.
- Clarified the Ready description to "Open, not a draft" so it is not read as a review
  queue.

## 0.4.1 — 2026-07-14

- Fixed the active count for Merged pull-request views using GitHub's `Total` header.
- Added deterministic coverage for GitHub's `state:open` and `state:closed` query forms.
- Limited the extension to repository pull-request lists while GitHub experiments with a new
  global pull-request layout.

## 0.4.0 — 2026-07-14

- Added a compact lifecycle menu for Open, Ready, Draft, Closed, Merged, and Closed without
  merging.
- Preserved GitHub search terms and native review filters through search qualifiers.
- Integrated with GitHub Turbo navigation and eliminated native-control flicker.
- Added adaptive Primer colors and Octicons for GitHub's light, dark, colorblind, tritanopia,
  dimmed, and high-contrast themes.
- Added shared Chromium and Firefox support with URL-driven lifecycle state.
- Added Firefox packaging, validation, privacy metadata, and desktop runtime verification.
