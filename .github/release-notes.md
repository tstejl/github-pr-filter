## Changes in 0.9.0

- Edit saved PR views in place on the current repository pull-request page.
- Stage repository view changes in the editor and write them only after an explicit save.
- Customize queries, icons, visibility, order, and separators in one editor, with undoable deletion and additive view templates.
- Keep uniform 44px menu rows and reveal truncated descriptions on hover or keyboard focus.
- Keep older all-repository view data in storage without loading or changing it.
- Recognize verified query aliases and reordered filters while preserving the original search text.
- Preserve unsaved edits during external changes and keep stale result counts hidden during loading.
- Support the refreshed repository PR interface. Legacy PR controls remain native.
- Upgrade to Bun 1.4.4 with type-aware linting and checked browser builds.

## Installation

GitHub release assets are unsigned ZIP builds for manual installation, development, and
store submission. For a signed, permanently installed, auto-updating extension, use the
Firefox Add-ons or Chrome Web Store listing when available.

### Chromium, Chrome, Dia, and other Chromium browsers

1. Download the `chromium.zip` asset and extract it.
2. Open your browser's extensions page, such as `chrome://extensions`.
3. Enable developer mode, choose **Load unpacked**, and select the extracted folder.

Keep the extracted folder in place while the extension is installed.

### Firefox

The `firefox.zip` asset is an unsigned developer package. Extract it, open
`about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select its
`manifest.json`. Firefox removes temporary add-ons when the browser restarts.

GitHub Releases do not include XPI files. Permanent Firefox installation is provided by
the Mozilla Add-ons listing.

Checksums for both unsigned browser packages are included in `SHA256SUMS`.
