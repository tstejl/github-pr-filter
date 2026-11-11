import { commitViewScopes } from "./views-storage";

interface SaveViewsRequest {
  type: "gprf:save-views";
  updates: unknown;
}

interface RuntimeSender {
  id?: string;
  url?: string;
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

/** Return the normalized repository only for a message from this extension's GitHub PR list. */
export function repositoryForAuthorizedSender(
  sender: RuntimeSender,
  extensionId: string | undefined
): string | null {
  if (!extensionId || sender.id !== extensionId || typeof sender.url !== "string") return null;
  try {
    const url = new URL(sender.url);
    if (url.origin !== "https://github.com" || url.username || url.password) return null;
    const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pulls\/?$/.exec(url.pathname);
    return match ? `${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}` : null;
  } catch {
    return null;
  }
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
