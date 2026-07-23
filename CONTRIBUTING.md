# Contributing

Thanks for helping improve GitHub PR Lifecycle Filter.

## Local setup

1. Install the development dependencies with `bun install`.
2. Run `bun run build` and load `dist/extension` in a Chromium browser, or run it in Firefox
   with `bunx web-ext run` after building.
3. Exercise a repository pull-request list with both `is:open` and `state:open` query forms.

## Before opening a pull request

Run:

```sh
bun run check
bun run test:coverage
bun run coverage:check
bun run lint:firefox
bun run release:package
bun run test:e2e:chromium
bun run test:e2e:firefox
bun run storybook:build
bun run test:visual
```

`bun run check` verifies Oxfmt formatting, Oxlint rules, and TypeScript types. It does not
modify files. Run `bun run format` and `bun run lint:fix` before committing to apply safe
automatic fixes.

`bun run coverage:check` verifies that `assets/coverage.svg` matches the generated LCOV
report. If an intentional test or source change updates coverage, run
`bun run coverage:update` and commit the refreshed badge.

The Firefox E2E command expects Firefox and geckodriver to be available. GitHub-hosted Linux
runners include both. Playwright installs its pinned Chromium build with
`bunx playwright install chromium`.

`bun run release:package` verifies that `manifest.json` and `package.json` have the same
version and writes unsigned, browser-specific ZIP files plus `SHA256SUMS` to
`dist/releases`. Browser stores sign their respective packages; GitHub Releases do not
publish CRX or XPI files.

Use `bun run storybook` to inspect every lifecycle-control state without loading the
extension. Storybook imports the same typed renderer and CSS as the browser bundle; its
visual-contract tests run in a controlled local Chromium instance.

Keep changes focused. The extension intentionally avoids a runtime UI framework, backend,
analytics, and broad permissions. TypeScript 7 checks the source and Bun emits readable
browser bundles.

Changes to query interpretation or lifecycle behavior must preserve the product contract and
rewrite invariants in [docs/query-lifecycle-model.md](docs/query-lifecycle-model.md).

Firefox lint currently reports one Android-only compatibility warning. Firefox for Android
is not yet a supported target.
