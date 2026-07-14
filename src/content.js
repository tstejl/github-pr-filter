(function initializeGitHubPrFilter() {
  "use strict";

  const queryState = globalThis.GitHubPrFilterQuery;
  const CONTROL_CLASS = "gprf-lifecycle";
  const SUPPORTED_PATH = /^(?:\/pulls(?:\/.*)?|\/[^/]+\/[^/]+\/pulls\/?)$/;
  const LIFECYCLES = [
    {
      value: "all",
      label: "All",
      description: "Open, including drafts",
      icon: "M5.75 2.5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-6a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM2 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
    },
    {
      value: "ready",
      label: "Ready",
      description: "Open and ready for review",
      icon: "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"
    },
    {
      value: "draft",
      label: "Draft",
      description: "Open drafts",
      icon: "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z"
    },
    {
      value: "merged",
      label: "Merged",
      description: "Successfully merged",
      icon: "M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"
    },
    {
      value: "closed",
      label: "Closed",
      description: "Closed without merging",
      icon: "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0 0-1.5ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"
    }
  ];
  const CHECK_ICON = "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z";

  if (!queryState) {
    return;
  }

  let activePreferences = { ...queryState.DEFAULT_PREFERENCES };
  let lastReconciledUrl = null;
  let scheduledTimer = null;

  function isSupportedPage() {
    // The manifest is the host boundary. Keeping this check path-only lets the
    // packaged extension run unchanged against a local origin in browser tests.
    return SUPPORTED_PATH.test(location.pathname);
  }

  function getSearchInput() {
    const selectors = [
      'input[aria-label="Search all issues"]',
      'main input[aria-label*="Search pull requests" i]',
      'main input[placeholder*="Search pull requests" i]',
      'input[name="q"][type="search"]',
      'main input[name="query"][type="search"]',
      'input[name="q"]'
    ];

    for (const selector of selectors) {
      const input = document.querySelector(selector);
      if (input instanceof HTMLInputElement) {
        return input;
      }
    }

    return null;
  }

  function getCurrentQuery() {
    const searchParams = new URL(location.href).searchParams;
    for (const parameter of ["q", "query"]) {
      const urlQuery = searchParams.get(parameter);
      if (urlQuery !== null) {
        return urlQuery.trim();
      }
    }

    return getSearchInput()?.value.trim() || "";
  }

  function urlForQuery(query) {
    const url = new URL(location.href);
    const normalizedQuery = query.trim();
    const inputName = getSearchInput()?.name;
    const queryParameter = url.searchParams.has("query") || inputName === "query" ? "query" : "q";
    const unusedParameter = queryParameter === "q" ? "query" : "q";

    if (normalizedQuery) {
      url.searchParams.set(queryParameter, normalizedQuery);
    } else {
      url.searchParams.delete(queryParameter);
    }

    url.searchParams.delete(unusedParameter);
    url.searchParams.delete("page");
    return url;
  }

  function createIcon(pathData) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.classList.add("octicon", "gprf-lifecycle-icon");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
    return svg;
  }

  function createLifecycleOption(lifecycle, label, description, icon, selected) {
    const link = document.createElement("a");
    link.className = `gprf-lifecycle-option${selected ? " selected" : ""}`;
    link.href = urlForQuery(queryState.queryWithLifecycle(getCurrentQuery(), lifecycle)).href;
    link.dataset.lifecycle = lifecycle;
    link.setAttribute("role", "menuitemradio");
    link.setAttribute("aria-checked", String(selected));

    const copy = document.createElement("span");
    copy.className = "gprf-option-copy";

    const optionLabel = document.createElement("span");
    optionLabel.className = "gprf-option-label";
    optionLabel.textContent = label;

    const optionDescription = document.createElement("span");
    optionDescription.className = "gprf-option-description";
    optionDescription.textContent = description;

    const check = createIcon(CHECK_ICON);
    check.classList.add("gprf-option-check");
    copy.append(optionLabel, optionDescription);
    link.append(createIcon(icon), copy, check);

    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      link.closest("details")?.removeAttribute("open");
    });

    return link;
  }

  function createControl(preferences, standalone = false) {
    const control = document.createElement("details");
    control.className = `${CONTROL_CLASS}${standalone ? " gprf-lifecycle--standalone" : ""}`;
    const selectedLifecycle = LIFECYCLES.find(({ value }) => value === preferences.lifecycle)
      || LIFECYCLES[0];

    const summary = document.createElement("summary");
    summary.className = "gprf-lifecycle-summary";
    summary.dataset.lifecycle = selectedLifecycle.value;
    summary.setAttribute("aria-label", `Pull request state: ${selectedLifecycle.label}`);

    const summaryLabel = document.createElement("span");
    summaryLabel.className = "gprf-summary-label";
    summaryLabel.textContent = selectedLifecycle.label;

    const chevron = document.createElement("span");
    chevron.className = "gprf-chevron";
    chevron.setAttribute("aria-hidden", "true");
    summary.append(createIcon(selectedLifecycle.icon), summaryLabel, chevron);

    const menu = document.createElement("div");
    menu.className = "gprf-lifecycle-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Filter by pull request state");

    const heading = document.createElement("div");
    heading.className = "gprf-menu-heading";
    heading.textContent = "Pull request state";
    menu.append(heading);

    for (const { value, label, description, icon } of LIFECYCLES) {
      if (value === "merged") {
        const divider = document.createElement("div");
        divider.className = "gprf-menu-divider";
        divider.setAttribute("role", "separator");
        menu.append(divider);
      }
      menu.append(createLifecycleOption(
        value,
        label,
        description,
        icon,
        preferences.lifecycle === value
      ));
    }

    control.append(summary, menu);

    control.addEventListener("keydown", (event) => {
      const options = [...control.querySelectorAll(".gprf-lifecycle-option")];
      if (event.key === "Escape" && control.open) {
        event.preventDefault();
        control.open = false;
        summary.focus();
        return;
      }

      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        return;
      }

      event.preventDefault();
      if (!control.open) {
        control.open = true;
      }

      const currentIndex = options.indexOf(document.activeElement);
      let nextIndex = currentIndex;
      if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = options.length - 1;
      } else if (event.key === "ArrowDown") {
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
      } else {
        nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
      }
      options[nextIndex]?.focus();
    });

    control.addEventListener("toggle", () => {
      if (!control.open) {
        return;
      }
      for (const otherControl of document.querySelectorAll(`.${CONTROL_CLASS}[open]`)) {
        if (otherControl !== control) {
          otherControl.removeAttribute("open");
        }
      }
    });

    return control;
  }

  function refreshControl(control, preferences) {
    const selectedLifecycle = LIFECYCLES.find(({ value }) => value === preferences.lifecycle)
      || LIFECYCLES[0];
    const summary = control.querySelector(".gprf-lifecycle-summary");
    summary.dataset.lifecycle = selectedLifecycle.value;
    summary.setAttribute("aria-label", `Pull request state: ${selectedLifecycle.label}`);
    summary.querySelector(".gprf-summary-label").textContent = selectedLifecycle.label;
    summary.querySelector(".gprf-lifecycle-icon path").setAttribute("d", selectedLifecycle.icon);

    for (const link of control.querySelectorAll(".gprf-lifecycle-option")) {
      const lifecycle = link.dataset.lifecycle;
      const selected = lifecycle === preferences.lifecycle;
      link.classList.toggle("selected", selected);
      link.href = urlForQuery(queryState.queryWithLifecycle(getCurrentQuery(), lifecycle)).href;
      link.setAttribute("aria-checked", String(selected));
    }
  }

  function nativeStatusGroups() {
    return [...document.querySelectorAll(".table-list-header-toggle.states")];
  }

  function syncTurboFrame(control, group) {
    const turboFrame = group.querySelector(":scope > a[data-turbo-frame]")
      ?.getAttribute("data-turbo-frame");
    if (!turboFrame) {
      return;
    }

    for (const link of control.querySelectorAll(".gprf-lifecycle-option")) {
      link.setAttribute("data-turbo-frame", turboFrame);
    }
  }

  function mountControls() {
    if (!isSupportedPage()) {
      return;
    }

    const groups = nativeStatusGroups();
    if (groups.length > 0) {
      for (const group of groups) {
        const existingControl = group.querySelector(`:scope > .${CONTROL_CLASS}`);
        if (existingControl) {
          syncTurboFrame(existingControl, group);
          refreshControl(existingControl, activePreferences);
          continue;
        }

        for (const nativeLink of group.querySelectorAll(":scope > a.btn-link")) {
          nativeLink.classList.add("gprf-native-status-hidden");
        }
        const control = createControl(activePreferences);
        syncTurboFrame(control, group);
        group.append(control);
      }
      return;
    }

    const existingControl = document.querySelector(`.${CONTROL_CLASS}`);
    if (existingControl) {
      refreshControl(existingControl, activePreferences);
      return;
    }

    const searchInput = getSearchInput();
    const searchContainer = searchInput?.closest("form, [role='search'], search");
    if (searchContainer) {
      searchContainer.insertAdjacentElement("afterend", createControl(activePreferences, true));
    }
  }

  function removeControls() {
    document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((control) => control.remove());
    document.querySelectorAll(".gprf-native-status-hidden").forEach((link) => {
      link.classList.remove("gprf-native-status-hidden");
    });
  }

  function reconcileAndMount() {
    if (!isSupportedPage()) {
      removeControls();
      lastReconciledUrl = null;
      return;
    }

    const currentUrl = location.href;
    if (lastReconciledUrl !== currentUrl) {
      const currentQuery = getCurrentQuery();
      const reconciliation = queryState.reconcileQuery(currentQuery);
      activePreferences = reconciliation.effective;
      lastReconciledUrl = currentUrl;
    }

    mountControls();
  }

  function scheduleReconcile() {
    if (scheduledTimer !== null) {
      clearTimeout(scheduledTimer);
    }

    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      reconcileAndMount();
    }, 60);
  }

  document.addEventListener("click", (event) => {
    for (const control of document.querySelectorAll(`.${CONTROL_CLASS}[open]`)) {
      if (!control.contains(event.target)) {
        control.removeAttribute("open");
      }
    }
  });

  window.addEventListener("popstate", scheduleReconcile);
  document.addEventListener("turbo:load", scheduleReconcile);

  const observer = new MutationObserver(scheduleReconcile);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  reconcileAndMount();
})();
