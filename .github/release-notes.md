## Installation

### Chromium, Chrome, Dia, and other Chromium browsers

1. Download the `chromium.zip` asset and extract it.
2. Open your browser's extensions page, such as `chrome://extensions`.
3. Enable developer mode, choose **Load unpacked**, and select the extracted folder.

Keep the extracted folder in place while the extension is installed.

### Firefox

The `firefox.zip` asset is an unsigned developer package. Extract it, open
`about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select its
`manifest.json`. Firefox removes temporary add-ons when the browser restarts.

A permanently installable, Mozilla-signed XPI will be added in a later release.

Checksums for both browser packages are included in `SHA256SUMS`.
