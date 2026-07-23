export type BrowserName = "chromium" | "firefox";

export type FixturePageMode =
  | "decoy-state-group"
  | "default"
  | "duplicate-search-inputs"
  | "partial-status-hydration"
  | "responsive-groups"
  | "open-selected-all"
  | "no-state-groups";

export interface FixturePageOptions {
  mode?: FixturePageMode;
  query?: string | null;
}

export interface FixtureServer {
  url: string;
  urlFor: (options?: FixturePageOptions) => string;
  close: () => Promise<void>;
}

export interface PreparedExtension {
  root: string;
  extensionDir: string;
  xpiPath: string | null;
}

export interface BrowserSession {
  open: (url: string) => Promise<void>;
  wait: (duration: number) => Promise<void>;
  openNewTab: (url: string) => Promise<void>;
  switchToTab: (index: number) => Promise<void>;
  waitForControl: () => Promise<void>;
  waitForElementCount: (selector: string, count: number) => Promise<void>;
  waitForNumericAttributeGreaterThan: (
    selector: string,
    name: string,
    value: number
  ) => Promise<void>;
  waitForText: (selector: string, text: string, present: boolean) => Promise<void>;
  text: (selector: string) => Promise<string[]>;
  attribute: (selector: string, name: string) => Promise<string | null>;
  attributes: (selector: string, name: string) => Promise<(string | null)[]>;
  cssValue: (selector: string, name: string) => Promise<string>;
  click: (selector: string) => Promise<void>;
  clickReplacing: (selector: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  setUnsubmittedSearchQuery: (query: string) => Promise<void>;
  setCommittedSearchQuery: (query: string) => Promise<void>;
  replaceUrlQuery: (query: string) => Promise<void>;
  swapResponsiveSearchFields: () => Promise<void>;
  appendUnrelatedDomMutation: () => Promise<void>;
  url: () => Promise<string>;
  waitForUrl: (predicate: (url: string) => boolean) => Promise<void>;
  duplicateLifecycleControl: () => Promise<void>;
  removeLifecycleControl: () => Promise<void>;
  replaceNativeStatusHeaderWithoutSignal: () => Promise<void>;
  navigateRepository: (pathname: string) => Promise<void>;
  setNativeStatusHeader: (present: boolean) => Promise<void>;
  setEligibleMountTargets: (present: boolean) => Promise<void>;
  mutationCount: (selector: string, duration: number) => Promise<number>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export interface E2ETestContext {
  browserName: BrowserName;
  browser: () => BrowserSession;
  fixture: () => FixtureServer;
}
