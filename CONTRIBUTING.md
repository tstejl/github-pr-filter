# Contributing

Thanks for helping improve GitHub PR Lifecycle Filter.

## Local setup

1. Install the development dependencies with `bun install`.
2. Run `bun run build` and load `dist/extension` in Chromium. Run
   `bunx web-ext run --source-dir dist/extension-firefox` to load the Firefox build.
3. Open a refreshed repository pull-request list and exercise the saved-view menu.
4. Edit a view in place, then save or cancel the staged changes.

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

`bun run check` checks formatting, lint rules, and types without changing files. `bun fmt --check`
checks formatting. Oxlint uses `oxlint-tsgolint` for type-aware promise, unsafe operation,
and exhaustiveness rules. Warnings and unused disable directives fail the lint check.
The `typecheck` script runs `bun check --no-script` across the project. The TypeScript
package remains available for editor support.

Compiler checks cover return completeness, switch fallthrough, overrides, unused declarations, and isolated modules.
The linter requires rejection handling even for promises preceded by `void`.
The compiler owns return analysis, so `typescript/consistent-return` is disabled.
Explicit assertions remain available for DOM and storage boundaries, so `typescript/no-unsafe-type-assertion` is disabled.
Unsafe assignments, calls, member access, arguments, and returns still fail the lint check.

Run `bun run format` and `bun run lint:fix` to apply automatic fixes before a commit.
`bun run build` runs `bun run check` before it creates the browser bundles. Bun also
checks types through `Bun.build` with `check: true`.

`bun run coverage:check` verifies that `assets/coverage.svg` matches the generated LCOV
report. If an intentional test or source change updates coverage, run
`bun run coverage:update` and commit the refreshed badge.

Use Bun 1.4.4 for builds and tests, matching the CI and release workflows. Older Bun
versions can close Chromium's debugging pipes during garbage collection. The E2E suite
uses `bun:test` without retries. To check for intermittent failures, use
`bun run test:e2e:chromium --rerun-each=3`.

## E2E registration and regression contracts

`e2e/spec-catalog.json` drives E2E registration. The runner imports each active module and calls its declared registrar.
`bun run test:e2e:check` compares the catalog with every code module under `e2e/specs`, including nested directories.
The audit runs in `bun run check`, before each browser suite, and in CI before browser installation.
It rejects orphaned files, stale entries, duplicate declarations, missing exports, and retirement records without reasons.
It also rejects replacement coverage that does not exist or points to a retired E2E module.

Add each new spec to the catalog with `status: "active"` and its registrar export name.
Keep helpers under `e2e/harness`. Do not replace catalog execution with manual imports in the E2E entrypoint.

Before retiring a module, review each behavioral guarantee and its replacement coverage.
Use `status: "retired"`, a specific reason, and paths to active E2E, unit, or visual tests.
Use an empty replacement list only for behavior that the product no longer supports.
The four retired classic suites document intentional contract changes, including complete-query replacement and native legacy controls.

During a controller refactor, carry forward the transition contracts as well as the final-state assertions.
`e2e/specs/anti-flicker.ts` samples frames during native-header replacement and retained-header updates.
The catalog audit and a unit contract keep this suite active.
Metadata variants, delayed hydration, cross-tab storage updates, and native Issues behavior have separate active modules.
Static screenshots do not replace frame-level transition checks.
Extension view links point to GitHub. Local fixtures assert their destination URLs without following those links to the live site.

The Firefox E2E command expects Firefox and geckodriver to be available. GitHub-hosted Linux
runners include both. Playwright installs its pinned Chromium build with
`bunx playwright install chromium`.

The Firefox harness enables `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS` only in its disposable test session.
Marionette requires this environment variable to inspect extension pages.
See the [Mozilla remote-agent documentation](https://firefox-source-docs.mozilla.org/remote/Prefs.html).

`bun run release:package` verifies that `manifest.json` and `package.json` have the same
version and writes unsigned, browser-specific ZIP files plus `SHA256SUMS` to
`dist/releases`. Browser stores sign their respective packages; GitHub Releases do not
publish CRX or XPI files.

Use `bun run storybook` to inspect the in-place views editor and historical lifecycle controls.
Storybook uses local sample data and does not navigate to GitHub.
Its visual tests run in a controlled local Chromium instance.

Keep changes focused. The extension has no runtime UI framework, backend, analytics, or GitHub API.
Bun checks the source and emits readable browser bundles.
Changes to saved queries or matching must preserve [docs/query-lifecycle-model.md](docs/query-lifecycle-model.md).

The source manifest is a shared template. The build emits a Chromium manifest with only a service
worker and a Firefox manifest with only background scripts. Firefox for Android is not a supported
target.
