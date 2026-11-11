# GitHub PR Lifecycle Filter

[![CI](https://github.com/tstejl/github-pr-filter/actions/workflows/ci.yml/badge.svg)](https://github.com/tstejl/github-pr-filter/actions/workflows/ci.yml)
![Coverage](assets/coverage.svg)
[![Latest release](https://img.shields.io/github/v/release/tstejl/github-pr-filter?display_name=tag&sort=semver)](https://github.com/tstejl/github-pr-filter/releases/latest)

Save GitHub pull-request searches and open them from a menu on repository pull-request lists.
The menu includes editable default views and your own queries.

## Manage views

Edit views in place from the pull-request menu for the current repository.
The editor changes only that repository's views.
You can add or edit a view, change its name and query, and choose an icon.
Changes stay in the editor until you select **Save changes**.
Back keeps drafts in the editor. **Cancel changes** discards the complete editing session.
An unfinished view blocks saving and shows the fields that need attention.
Empty new drafts disappear quietly.

Truncated descriptions reveal their complete text on hover or keyboard focus.
Menu rows keep a uniform height.

Use **Show in menu** to keep a view saved without showing its shortcut.
**Delete view** stages deletion, with **Undo** available until saving.
**Add from templates…** adds independent copies without changing your existing views or layout.

Saved views search the current repository.
Older all-repository layouts stay in browser storage and remain inactive.
Repository views always search the current repository, including older entries with dashboard destination metadata.

Selecting a view replaces the complete search with its saved query.
GitHub interprets that query and applies its search rules.
The menu identifies matching views from flat qualifiers in a different order when safe.
Repeated qualifiers and grouped expressions use conservative matching.
An unmatched search appears as **Custom search**.

## Your settings stay local

The extension stores repository views in browser-local extension storage on this device.
Removing the extension can remove this data.
The extension does not sync views between devices.
When you open a view, GitHub receives its query as part of the search URL.

The extension does not use a GitHub API, token, backend, or analytics.
It keeps legacy lifecycle layouts during migration.
It preserves inactive all-repository view data and does not edit it.
It also preserves unreadable or newer-format data and prevents edits to affected views.
See [PRIVACY.md](PRIVACY.md) for the privacy policy.

## Installation

Signed browser-store builds are the recommended installation route. New releases may appear
there after a short delay while each store completes its review:

- **Chromium:** [Install from the Chrome Web Store](https://chromewebstore.google.com/detail/github-pr-lifecycle-filte/dppkjnbbfnnphkdggclnjigfkdieooee)
- **Firefox:** [Install from Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/github-pr-lifecycle-filter/)

For testing or manual installation, each [GitHub release](https://github.com/tstejl/github-pr-filter/releases/latest)
contains separate unsigned packages for Chromium and Firefox, plus SHA-256 checksums.

- **Chromium:** download and extract the Chromium ZIP. Open
  `chrome://extensions`, enable developer mode, choose **Load unpacked**, and select the
  extracted folder.
- **Firefox:** extract the Firefox ZIP, open `about:debugging#/runtime/this-firefox`, choose
  **Load Temporary Add-on**, and select its `manifest.json`. Firefox removes temporary add-ons
  after restart; use the signed Firefox Add-ons build for permanent installation.

## Supported browsers and pages

The extension supports current desktop Chromium browsers and Firefox 140 or newer on `github.com`.
It modifies the refreshed repository pull-request list at `github.com/owner/repository/pulls`.
Legacy repository controls remain native.
Firefox for Android and custom GitHub domains are not supported.

<details>
<summary><strong>Development and testing</strong></summary>

The packaged extension has no runtime dependencies. Bun 1.4.4 compiles the TypeScript source
into readable, non-minified browser bundles for Chromium and Firefox. The build runs
formatting, lint, and type checks before it creates the bundles.

```sh
bun install --frozen-lockfile
bun run check
bun run test:coverage
bun run coverage:check
bun run test:e2e:check
bun run test:e2e:chromium
bun run test:e2e:firefox
bun run storybook
bun run test:visual
```

Tests run against controlled local fixtures rather than live GitHub data. The suite includes
unit and storage tests, packaged-extension E2E coverage in Chromium and Firefox, and Storybook
visual contracts across light, dark, and high-contrast themes.

Use `bun run coverage:update` after an intentional coverage change. CI verifies that the
checked-in coverage badge matches the generated LCOV report.

To build or package the extension manually:

```sh
bun run build
bun run lint:firefox
bun run build:firefox
bun run release:package
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete local validation workflow.

</details>

## Contributing

Bug reports and focused pull requests are welcome. Please open an
[issue](https://github.com/tstejl/github-pr-filter/issues) when GitHub changes its pull-request
layout or query behavior.

## License

[MIT](LICENSE)
