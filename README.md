# GitHub PR Lifecycle Filter

[![CI](https://github.com/tstejl/github-pr-filter/actions/workflows/ci.yml/badge.svg)](https://github.com/tstejl/github-pr-filter/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/tstejl/github-pr-filter?display_name=tag&sort=semver)](https://github.com/tstejl/github-pr-filter/releases/latest)

A small Chromium and Firefox extension that makes GitHub's pull-request lifecycle views faster to use.

## Installation

Browser stores are the recommended installation route. Store builds are signed by the
browser vendor, install permanently, and receive normal automatic updates. Links will be
added here as the Firefox Add-ons and Chrome Web Store listings become available.

GitHub releases contain unsigned, browser-specific ZIP builds for manual installation,
development, and store submission. They do not contain CRX or XPI packages.

- **Chromium / Chrome / Dia:** download and extract the Chromium ZIP, open
  `chrome://extensions`, enable developer mode, choose **Load unpacked**, and select the
  extracted folder. Keep that folder in place while the extension is installed.
- **Firefox:** the Firefox ZIP cannot be installed permanently in standard Firefox. For
  temporary testing, extract it, open `about:debugging#/runtime/this-firefox`, choose
  **Load Temporary Add-on**, and select its `manifest.json`. Firefox removes the extension
  when the browser restarts. Use the Firefox Add-ons listing for permanent installation
  once it is available.

Each GitHub release includes SHA-256 checksums for both unsigned packages.

## What it does

- Filters repository pull-request lists on GitHub.
- Replaces GitHub's **Open / Closed** links with a compact seven-state lifecycle menu.
- Treats **Open** and **Closed** as aggregate views, matching GitHub's query semantics.
- Separates **Merged** pull requests from **Closed without merging**.
- Adds a **Needs review** view: open, non-draft pull requests that are neither approved
  nor awaiting changes from their author.
- Preserves GitHub's existing search terms and native review filters. The one exception is
  selecting **Needs review**, which replaces review-status (`review:`) qualifiers so the
  resulting query cannot contradict itself.
- Treats GitHub's search query, search submission, and clear action as the source of truth.
- Shows GitHub's matching PR count for the active lifecycle while the menu is collapsed.
- Keeps the compact trigger text-only and uses a distinct GitHub Octicon for every menu state.
- Uses GitHub search qualifiers, so filtered views remain visible in the URL.
- Uses GitHub's native Turbo navigation to update results without a full-page refresh.

The extension does not call the GitHub API, collect analytics, use a backend, or require a GitHub token.

## Install in Chromium for development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project directory. Dia and other Chromium-based browsers support the same unpacked-extension flow.
5. Open a repository's **Pull requests** page.

## Run in Firefox for development

```sh
npm install
npm run lint:firefox
npx web-ext run
```

The same source files and manifest are used in Chromium and Firefox. Firefox-specific
identity and privacy declarations live under `browser_specific_settings`, which Chromium
ignores. Firefox 140 or newer is required; Firefox for Android remains out of scope until
its GitHub layout has dedicated testing.

`web-ext lint` currently emits one Android-only compatibility warning because Mozilla's
data-collection manifest key arrived in Firefox for Android 142. Desktop Firefox validation
has no errors; the Android target is intentionally deferred.

Desktop Firefox Developer Edition has been manually verified for lifecycle filtering,
query synchronization, Turbo navigation, and GitHub theme integration.

## Development

The extension intentionally has no runtime or build dependencies.

```sh
npm test
npm run check
npm run lint:firefox
npm run build:firefox
npm run release:package
npm run test:e2e:chromium
npm run test:e2e:firefox
```

The end-to-end suite loads the real extension into each browser and exercises it against a
local GitHub-shaped fixture. Chromium uses Playwright; Firefox packages the same source as a
temporary add-on and installs it through WebDriver.

## Permissions

The extension requests no browser API permissions. Its content scripts are limited to
`https://github.com/*` and exit immediately outside supported pull-request list pages.

## Browser releases

The repository intentionally keeps a single manifest and source tree for Chromium and
Firefox. GitHub Actions runs unit, manifest, packaging, Chromium E2E, and Firefox E2E checks
for pull requests and `main`. GitHub Releases publish unsigned ZIP builds; signed,
auto-updating installations are distributed through the browser stores. Automated store
publishing remains a later phase.

## Privacy

The extension operates entirely in the browser and does not transmit data. See
[PRIVACY.md](PRIVACY.md) for the complete policy.

## Contributing

Bug reports and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the local validation workflow.

## License

[MIT](LICENSE)
