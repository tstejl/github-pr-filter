import { commitViewScopes } from "./views-storage";
import { repositoryKeyFromPullListPath } from "./page-scope";
import { normalizeViewRepository } from "./saved-views";

interface SaveViewsRequest {
  type: "gprf:save-views";
  updates: unknown;
}

interface RuntimeSender {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { url?: string };
}

interface ExtensionApi {
  runtime: {
    id?: string;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: RuntimeSender,
          sendResponse: (response: { ok: boolean; error?: string }) => void
        ) => boolean | void
      ): void;
    };
  };
}

const extensionApi = (globalThis as typeof globalThis & { chrome?: ExtensionApi }).chrome;
let writeQueue: Promise<void> = Promise.resolve();

function isSaveViewsRequest(value: unknown): value is SaveViewsRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type?: unknown }).type === "gprf:save-views"
  );
}

function githubPageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.origin !== "https://github.com" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** Authorize the sender's origin and the current top-level repository separately. */
export function repositoryForAuthorizedSender(
  sender: RuntimeSender,
  extensionId: string | undefined
): string | null {
  if (!extensionId || sender.id !== extensionId || typeof sender.url !== "string") return null;
  if (sender.frameId !== undefined && sender.frameId !== 0) return null;
  if (!githubPageUrl(sender.url)) return null;
  // Chromium retains the document's original URL in sender.url after pushState.
  // The browser-provided tab URL follows GitHub's in-page navigation.
  const current = githubPageUrl(sender.tab?.url ?? sender.url);
  if (!current) return null;
  const repository = repositoryKeyFromPullListPath(current.pathname);
  return repository ? normalizeViewRepository(repository) : null;
}

export function isRepositoryScopedSave(updates: unknown, repository: string): boolean {
  if (!Array.isArray(updates) || updates.length !== 1) return false;
  const update: unknown = (updates as unknown[])[0];
  return (
    typeof update === "object" &&
    update !== null &&
    "scope" in update &&
    (update as { scope?: unknown }).scope === repository
  );
}

function reject(sendResponse: (response: { ok: boolean; error?: string }) => void, error: string) {
  sendResponse({ ok: false, error });
}

extensionApi?.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isSaveViewsRequest(message)) return undefined;

  const repository = repositoryForAuthorizedSender(sender, extensionApi.runtime.id);
  if (!repository) {
    reject(
      sendResponse,
      "Only this extension's GitHub repository pull request page can save views."
    );
    return undefined;
  }
  if (!isRepositoryScopedSave(message.updates, repository)) {
    reject(sendResponse, "A save must contain exactly one update for the current repository.");
    return undefined;
  }

  writeQueue = writeQueue.catch(() => undefined).then(() => commitViewScopes(message.updates));
  void writeQueue.then(
    () => sendResponse({ ok: true }),
    (error: unknown) =>
      reject(sendResponse, error instanceof Error ? error.message : "Could not save views.")
  );
  return true;
});
