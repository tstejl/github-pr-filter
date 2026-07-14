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
```

Keep changes focused. The extension intentionally avoids a framework, build step, backend,
analytics, and broad permissions.

Firefox lint currently reports one Android-only compatibility warning. Firefox for Android
is not yet a supported target.
