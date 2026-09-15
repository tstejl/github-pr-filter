const REPOSITORY_PULLS_PATH = /^\/([^/]+)\/([^/]+)\/pulls\/?$/;
const REPOSITORY_ISSUES_PATH = /^\/([^/]+)\/([^/]+)\/issues\/?$/;

export function isRepositoryPullListPath(pathname: string): boolean {
  return REPOSITORY_PULLS_PATH.test(pathname);
}

export function isRepositoryIssueListPath(pathname: string): boolean {
  return REPOSITORY_ISSUES_PATH.test(pathname);
}

export function repositoryKeyFromPullListPath(pathname: string): string | null {
  return repositoryKeyFromPath(REPOSITORY_PULLS_PATH, pathname);
}

export function repositoryKeyFromIssueListPath(pathname: string): string | null {
  return repositoryKeyFromPath(REPOSITORY_ISSUES_PATH, pathname);
}

export function repositoryKeyFromListPath(pathname: string): string | null {
  return repositoryKeyFromPullListPath(pathname) ?? repositoryKeyFromIssueListPath(pathname);
}

function repositoryKeyFromPath(path: RegExp, pathname: string): string | null {
  const match = path.exec(pathname);
  const owner = match?.[1];
  const repository = match?.[2];
  return owner && repository ? `${owner.toLowerCase()}/${repository.toLowerCase()}` : null;
}
