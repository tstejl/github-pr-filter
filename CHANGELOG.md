# Changelog

All notable changes will be documented in this file.

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
