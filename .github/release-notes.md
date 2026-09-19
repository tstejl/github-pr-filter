## Changes in 0.8.1

- Fix a closing-menu flash during filter navigation on classic and new PR pages.
- Fix hidden counts after switching between PR searches with the same result count, including `0 Ready`.
- Restore counts when the associated list finishes loading without revealing stale counts during refreshes.

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
