# Privacy

GitHub PR Lifecycle Filter stores repository views and their queries in browser-local extension storage.
Each view uses a repository identifier, such as `owner/name`.
The editor reads and writes views for the current repository only.
Older all-repository view data stays in storage and remains inactive.
Removing the extension can remove this data.

The extension reads the current search query and rendered pull-request information on supported GitHub pages.
When you open a view, the browser sends its saved query to GitHub in the search URL.
GitHub processes the search under its own privacy policy.

The extension has no GitHub API integration, token, backend, or analytics.
It does not collect or transmit browsing activity to a separate service.
It declares `none` for Firefox data collection and transmission.
