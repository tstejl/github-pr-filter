import { test } from "bun:test";
import * as assert from "node:assert/strict";
import {
  createCommittedQueryContext,
  hasRecognizableNativeStatusLinks,
  resolveNativeStatusCount,
  selectSearchField,
  selectStatusGroups,
  type NativeStatusLink
} from "../src/github-pull-list-contract";

const pageUrl = "https://github.com/octocat/hello-world/pulls";

test("URL query parameters are the committed source of truth", () => {
  const context = createCommittedQueryContext(
    `${pageUrl}?q=is%3Apr+is%3Aclosed&query=state%3Aopen`,
    { name: "query", committedValue: "is:pr is:open" }
  );

  assert.deepEqual(context, {
    pageUrl: `${pageUrl}?q=is%3Apr+is%3Aclosed&query=state%3Aopen`,
    input: { source: "is:pr is:closed" },
    queryParameter: "q"
  });
});

test("the server-rendered field supplies a committed query when the URL is neutral", () => {
  const context = createCommittedQueryContext(pageUrl, {
    name: "query",
    committedValue: "  state:open label:bug  "
  });

  assert.deepEqual(context, {
    pageUrl,
    input: { source: "state:open label:bug" },
    queryParameter: "query"
  });
});

test("an explicitly blank URL query overrides server-rendered search text", () => {
  assert.deepEqual(
    createCommittedQueryContext(`${pageUrl}?q=`, {
      name: "query",
      committedValue: "state:open label:bug"
    }),
    {
      pageUrl: `${pageUrl}?q=`,
      input: { source: "" },
      queryParameter: "q"
    }
  );
  assert.deepEqual(createCommittedQueryContext(pageUrl, null), {
    pageUrl,
    input: { source: "" },
    queryParameter: "q"
  });
});

test("responsive state groups within main are retained in deterministic DOM order", () => {
  const selected = selectStatusGroups([
    { value: "unrelated-header", connected: true, withinMain: false, capable: true },
    { value: "wide", connected: true, withinMain: true, capable: true },
    { value: "detached", connected: false, withinMain: true, capable: true },
    { value: "narrow", connected: true, withinMain: true, capable: true }
  ]);

  assert.deepEqual(selected, ["wide", "narrow"]);
});

test("state-group discovery falls back outside main only when needed", () => {
  assert.deepEqual(
    selectStatusGroups([
      { value: "detached-main", connected: false, withinMain: true, capable: true },
      { value: "legacy-header", connected: true, withinMain: false, capable: true }
    ]),
    ["legacy-header"]
  );
});

test("state-group discovery rejects matching markup without recognizable lifecycle links", () => {
  assert.deepEqual(
    selectStatusGroups([
      { value: "decoy", connected: true, withinMain: true, capable: false },
      { value: "legacy-header", connected: true, withinMain: false, capable: true }
    ]),
    ["legacy-header"]
  );
  assert.deepEqual(
    selectStatusGroups([{ value: "decoy", connected: true, withinMain: true, capable: false }]),
    []
  );
});

test("search-field discovery prefers a visible pull-list field within main", () => {
  assert.equal(
    selectSearchField([
      {
        value: "stale-hidden",
        connected: true,
        withinMain: true,
        visible: false,
        pullListForm: true
      },
      {
        value: "visible-unrelated",
        connected: true,
        withinMain: true,
        visible: true,
        pullListForm: false
      },
      {
        value: "committed",
        connected: true,
        withinMain: true,
        visible: true,
        pullListForm: true
      },
      {
        value: "global",
        connected: true,
        withinMain: false,
        visible: true,
        pullListForm: true
      }
    ]),
    "committed"
  );
});

test("search-field discovery falls back conservatively for legacy markup", () => {
  assert.equal(
    selectSearchField([
      {
        value: "detached",
        connected: false,
        withinMain: true,
        visible: true,
        pullListForm: true
      },
      {
        value: "legacy",
        connected: true,
        withinMain: false,
        visible: true,
        pullListForm: false
      }
    ]),
    "legacy"
  );
  assert.equal(selectSearchField([]), null);
});

test("a visible pull-list field outside main beats a hidden stale field inside main", () => {
  assert.equal(
    selectSearchField([
      {
        value: "stale-hidden-main",
        connected: true,
        withinMain: true,
        visible: false,
        pullListForm: true
      },
      {
        value: "visible-committed-outside",
        connected: true,
        withinMain: false,
        visible: true,
        pullListForm: true
      }
    ]),
    "visible-committed-outside"
  );
});

const nativeLinks: readonly NativeStatusLink[] = [
  {
    href: `${pageUrl}?q=${encodeURIComponent("is:pr is:open label:bug")}`,
    text: "1,200 Open",
    selected: true
  },
  {
    href: `${pageUrl}?q=${encodeURIComponent("is:pr is:closed label:bug")}`,
    text: "345 Closed",
    selected: false
  }
];

test("native counts follow the lifecycle partition while preserving GitHub's label", () => {
  assert.equal(resolveNativeStatusCount(nativeLinks, "open", pageUrl, "en-US"), "1,200");
  assert.equal(resolveNativeStatusCount(nativeLinks, "closed", pageUrl, "en-US"), "345");
  assert.equal(resolveNativeStatusCount(nativeLinks, "none", pageUrl, "en-US"), null);
});

test("All sums Open and Closed even when GitHub visually selects Open", () => {
  assert.equal(resolveNativeStatusCount(nativeLinks, "both", pageUrl, "en-US"), "1,545");
});

test("a selected merged link contributes GitHub's filtered Closed count", () => {
  const links: readonly NativeStatusLink[] = [
    nativeLinks[0] as NativeStatusLink,
    {
      href: `${pageUrl}?query=${encodeURIComponent("is:pr is:merged label:bug")}`,
      text: "17 Closed",
      selected: true
    }
  ];

  assert.equal(resolveNativeStatusCount(links, "closed", pageUrl, "en-US"), "17");
});

test("a selected Total link is trusted when its query matches the active partition", () => {
  const links: readonly NativeStatusLink[] = [
    {
      href: `${pageUrl}?q=${encodeURIComponent("is:pr is:unmerged")}`,
      text: "4 Total",
      selected: true
    }
  ];

  assert.equal(resolveNativeStatusCount(links, "both", pageUrl, "en-US"), "4");
});

test("All omits a count when either native partition cannot be interpreted", () => {
  assert.equal(resolveNativeStatusCount(nativeLinks.slice(0, 1), "both", pageUrl, "en-US"), null);
});

test("native status capability requires an interpretable partition and count", () => {
  assert.equal(hasRecognizableNativeStatusLinks(nativeLinks, pageUrl), true);
  assert.equal(
    hasRecognizableNativeStatusLinks(
      [
        {
          href: `${pageUrl}?q=${encodeURIComponent("label:bug")}`,
          text: "9 Tagged",
          selected: false
        },
        {
          href: `https://github.com/octocat/hello-world/issues?q=${encodeURIComponent("is:open")}`,
          text: "7 Open issues",
          selected: false
        }
      ],
      pageUrl
    ),
    false
  );
  assert.equal(
    hasRecognizableNativeStatusLinks(
      [
        {
          href: `${pageUrl}?q=${encodeURIComponent("is:pr is:open")}`,
          text: "Open",
          selected: true
        }
      ],
      pageUrl
    ),
    false
  );
});
