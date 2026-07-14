# GitHub PR Lifecycle Filter

A small Chromium and Firefox extension that makes GitHub's pull-request lifecycle views faster to use.

## What it does

- Filters repository pull-request lists and the global GitHub pull-request page.
- Replaces GitHub's **Open / Closed** links with a compact lifecycle menu for **All / Ready / Draft / Merged / Closed**.
- Defines **All** as GitHub's normal open view, including drafts.
- Separates merged pull requests from pull requests closed without merging.
- Preserves GitHub's existing search terms and native review filters.
- Remembers the lifecycle selection globally in local browser extension storage.
- Uses GitHub search qualifiers, so filtered views remain visible in the URL.
- Uses GitHub's native Turbo navigation to update results without a full-page refresh.

The extension does not call the GitHub API, collect analytics, use a backend, or require a GitHub token.

## Install in Chromium for development

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project directory. Dia and other Chromium-based browsers support the same unpacked-extension flow.
5. Open a repository's **Pull requests** page or `https://github.com/pulls`.

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
preference persistence, Turbo navigation, and GitHub theme integration.

## Development

The extension intentionally has no runtime or build dependencies.

```sh
npm test
npm run check
npm run lint:firefox
npm run build:firefox
npm run test:e2e:chromium
npm run test:e2e:firefox
```

The end-to-end suite loads the real extension into each browser and exercises it against a
local GitHub-shaped fixture. Chromium uses Playwright; Firefox packages the same source as a
temporary add-on and installs it through WebDriver.

## Permissions

- `storage`: remembers the global filter selection locally.
- `https://github.com/*`: injects the filter only on GitHub. The script exits immediately outside supported pull-request list pages.

## Browser releases

The repository intentionally keeps a single manifest and source tree for Chromium and
Firefox. GitHub Actions runs unit, manifest, packaging, Chromium E2E, and Firefox E2E checks
for pull requests and `main`. Automated store publishing remains a later phase.

## Privacy

The extension operates entirely in the browser and does not transmit data. See
[PRIVACY.md](PRIVACY.md) for the complete policy.

## Contributing

Bug reports and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the local validation workflow.

## License

[MIT](LICENSE)
