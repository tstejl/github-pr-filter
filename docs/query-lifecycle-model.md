# Query and lifecycle model

GitHub's repository pull-request search is the source of truth. The extension explains and
changes only the lifecycle portion of that search; it does not own labels, authors, assignees,
milestones, review status, sorting, or free text.

## Product contract

- A missing or empty query is **Open**, matching the repository Pull requests page's implicit
  default.
- A non-empty query with no lifecycle constraint is **All**. For example, `is:pr`, `label:bug`,
  and `review:approved` do not imply Open.
- **Ready** means open and not a draft. **Needs review** is the narrower Ready query with the
  extension's complete negative-review signature.
- A query is **Custom** when its lifecycle mask is valid but does not exactly equal a preset,
  contains contradictory or order-sensitive constraints, correlates lifecycle and unrelated
  filters through Boolean syntax, contains unsupported lifecycle-shaped syntax, or is malformed.
- Flat Custom queries whose lifecycle terms are separable can be safely changed. Boolean,
  parenthesized, unsupported, and malformed lifecycle queries remain visible but preset actions
  are disabled rather than risking a semantic change.

The model treats a pull request as one of five mutually exclusive states:

1. open draft;
2. open ready;
3. closed, unmerged draft;
4. closed, unmerged ready; or
5. merged.

Every built-in lifecycle is an exact set of those states. The algebra evaluates only flat,
supported constraints from different lifecycle dimensions. Equivalent duplicates are harmless;
conflicting terms in the same dimension are Custom because GitHub resolves them with
qualifier-specific, order-sensitive rules rather than ordinary Boolean conjunction.

The repository Pull requests route does not support qualifier `AND`/`OR` and parentheses like
the advanced Issues filter does. A lifecycle term inside that syntax is therefore Custom and
not rewritten. The syntax layer still parses it losslessly so unrelated text and filters remain
untouched.

## Rewrite rules

1. Selecting the already displayed preset is a byte-for-byte no-op.
2. A safe rewrite removes only globally separable lifecycle predicates and preserves every
   unrelated expression.
3. Canonical lifecycle predicates are appended for the selected target.
4. Selecting **All** adds `is:pr` only when removing lifecycle predicates would otherwise leave
   an empty query. An existing item-type expression is never replaced or contradicted.
5. Selecting **Ready** intentionally removes the exact negative-review pair used by **Needs
   review**; retaining it would make the result resolve back to Needs review.
6. Lifecycle predicates inside explicit Boolean syntax or parentheses are never rewritten.
7. Parentheses attached directly to outer text, such as `foo(bar)`, are preserved as opaque
   input because normalizing their spacing could change an unknown search term.
8. GitHub currently ignores `-is:open` and `-is:closed`; they are preserved as opaque input.
   Their supported complements are `-state:open` and `-state:closed`.

GitHub documents lifecycle qualifiers and quoted values in its
[issue and pull-request search syntax](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests).
Its [advanced Boolean filtering documentation](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests)
specifically scopes those expressions to Issues views, which is why this extension does not
project that grammar onto repository Pull requests.

## Code boundaries

- `github-query.ts` owns syntax only: tokenization, parsing, diagnostics, and serialization. It
  knows nothing about pull-request states or UI.
- `lifecycle-query.ts` owns product semantics: the finite lifecycle algebra, exact selection,
  physical open/closed partition, review-signature ownership, and guarded rewrites.
- `lifecycle-navigation.ts` turns one immutable page/query context into the complete action URL
  map and exposes the same plan's analysis, so displayed state and navigation cannot come from
  different parses or DOM moments.
- `lifecycle.ts` owns stable domain identifiers and selection types.
- `lifecycle-options.ts` owns labels, descriptions, icons, and menu ordering metadata.
- `content.ts` adapts the current GitHub URL and DOM to the pure query API.
- `lifecycle-control.ts` renders the supplied selection and disables actions whose rewrite is
  unsafe.
- layout and storage modules own repository preferences independently of query state.

## Required invariants

Tests should preserve these properties whenever GitHub syntax support changes:

- analysis never throws for arbitrary text;
- a successful rewrite analyzes back to the selected preset;
- reselecting that preset changes no bytes;
- unrelated filters survive a rewrite;
- unsafe input remains untouched;
- All never collapses to GitHub's implicit Open view; and
- the selected native GitHub count is preferred, with Open plus Closed summation only for All.
