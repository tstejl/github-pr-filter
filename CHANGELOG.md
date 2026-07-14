# Changelog

All notable changes will be documented in this file.

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
