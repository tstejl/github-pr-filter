# Contributing

Thanks for helping improve GitHub PR Lifecycle Filter.

## Local setup

1. Install the development dependency with `npm install`.
2. Load the unpacked project directory in a Chromium browser, or run it in Firefox with
   `npx web-ext run`.
3. Exercise repository pull-request lists and `https://github.com/pulls` when the latter is
   available to your GitHub account.

## Before opening a pull request

Run:

```sh
npm run check
npm run lint:firefox
npm run release:package
npm run test:e2e:chromium
npm run test:e2e:firefox
```

The Firefox E2E command expects Firefox and geckodriver to be available. GitHub-hosted Linux
runners include both. Playwright installs its pinned Chromium build with
`npx playwright install chromium`.

`npm run release:package` verifies that `manifest.json` and `package.json` have the same
version and writes browser-specific ZIP files plus `SHA256SUMS` to `dist/releases`.

Keep changes focused. The extension intentionally avoids a framework, build step, backend,
analytics, and broad permissions.

Firefox lint currently reports one Android-only compatibility warning. Firefox for Android
is not yet a supported target.
