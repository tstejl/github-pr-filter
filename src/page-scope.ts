const REPOSITORY_PULLS_PATH = /^\/[^/]+\/[^/]+\/pulls\/?$/;

export function isRepositoryPullListPath(pathname: string): boolean {
  return REPOSITORY_PULLS_PATH.test(pathname);
}
