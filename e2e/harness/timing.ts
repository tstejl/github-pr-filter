import type { BrowserName } from "./contracts";

export async function measuredStep<T>(
  browserName: BrowserName,
  label: string,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();
  console.info(`[e2e:${browserName}] ${label} started`);
  try {
    const result = await operation();
    console.info(
      `[e2e:${browserName}] ${label} finished in ${Math.round(performance.now() - startedAt)}ms`
    );
    return result;
  } catch (error: unknown) {
    console.error(
      `[e2e:${browserName}] ${label} failed after ${Math.round(performance.now() - startedAt)}ms`
    );
    throw error;
  }
}
