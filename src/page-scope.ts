const REPOSITORY_PULLS_PATH = /^\/([^/]+)\/([^/]+)\/pulls\/?$/;

export function isRepositoryPullListPath(pathname: string): boolean {
  return REPOSITORY_PULLS_PATH.test(pathname);
}

export function repositoryKeyFromPullListPath(pathname: string): string | null {
  const match = REPOSITORY_PULLS_PATH.exec(pathname);
  const owner = match?.[1];
  const repository = match?.[2];
  return owner && repository ? `${owner.toLowerCase()}/${repository.toLowerCase()}` : null;
}
