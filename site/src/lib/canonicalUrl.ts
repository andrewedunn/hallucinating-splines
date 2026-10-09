// ABOUTME: Production canonical URLs use the pathname only.
// ABOUTME: Sort, filter, page, tracking, and hash fragments never become canonical.

const SITE_ORIGIN = 'https://hallucinatingsplines.com';

export function canonicalHref(pathWithQuery: string): string {
  const pathOnly = pathWithQuery.split(/[?#]/, 1)[0] || '/';
  const pathname = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  const url = new URL(pathname, SITE_ORIGIN);
  url.search = '';
  url.hash = '';
  return url.href;
}
