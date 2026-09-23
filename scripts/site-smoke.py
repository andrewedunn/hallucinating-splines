# ABOUTME: Verifies the exact Pages release and its public HTML and crawl files.
# ABOUTME: Uses curl with bounded retries to tolerate deployment propagation.
import argparse
from html.parser import HTMLParser
import json
import subprocess
import time
from urllib.parse import urlparse
import xml.etree.ElementTree as ET


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.headings = 0
        self.canonicals = []
        self.styles = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'h1':
            self.headings += 1
        if tag == 'link' and attrs.get('rel') == 'canonical':
            self.canonicals.append(attrs.get('href'))
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.styles.append(attrs.get('href'))


def verify_html(html, path, version):
    page = Page(html)
    if page.headings != 1:
        raise ValueError(f'{path}: expected one H1, got {page.headings}')
    if page.canonicals != [f'https://hallucinatingsplines.com{path}']:
        raise ValueError(f'{path}: unexpected canonical {page.canonicals}')
    for name in ('global', 'tokens'):
        if f'/styles/{name}.css?v={version}' not in page.styles:
            raise ValueError(f'{path}: missing versioned {name} stylesheet')


def verify_release(body, sha, version):
    release = json.loads(body)
    if release.get('sha') != sha or release.get('version') != version:
        raise ValueError('Production has not reached the expected commit and version')


def verify_sitemap(body):
    root = ET.fromstring(body)
    urls = [node.text for node in root.findall('{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
    if not urls or len(urls) != len(set(urls)):
        raise ValueError('Sitemap is empty or contains duplicate URLs')
    for url in urls:
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc != 'hallucinatingsplines.com':
            raise ValueError('Sitemap contains an unexpected origin')


def fetch(base, path, expected_type):
    result = subprocess.run(
        ['curl', '--silent', '--show-error', '--max-time', '20',
         '--write-out', '\n%{http_code}\n%{content_type}', base + path],
        check=True, capture_output=True, text=True, timeout=25,
    )
    body, status, content_type = result.stdout.rsplit('\n', 2)
    if status != '200' or expected_type not in content_type:
        raise ValueError(f'{path}: HTTP {status}, {content_type}')
    return body


def verify_site(base, sha, version):
    verify_release(fetch(base, f'/release.json?commit={sha}', 'application/json'), sha, version)
    for path in ('/', '/docs', '/cities', '/leaderboard'):
        verify_html(fetch(base, path, 'text/html'), path, version)
    robots = fetch(base, '/robots.txt', 'text/plain')
    if 'Sitemap: https://hallucinatingsplines.com/sitemap.xml' not in robots:
        raise ValueError('robots.txt does not declare the sitemap')
    verify_sitemap(fetch(base, '/sitemap.xml', 'application/xml'))
    for name in ('global', 'tokens'):
        fetch(base, f'/styles/{name}.css?v={version}', 'text/css')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--expected-version', required=True)
    parser.add_argument('--attempts', type=int, default=1)
    args = parser.parse_args()
    if not 1 <= args.attempts <= 12:
        parser.error('--attempts must be between 1 and 12')
    for attempt in range(1, args.attempts + 1):
        try:
            verify_site(args.base_url.rstrip('/'), args.expected_sha, args.expected_version)
            print(f'Production verified: {args.expected_sha} (site {args.expected_version})')
            return
        except (ValueError, ET.ParseError, subprocess.SubprocessError) as error:
            print(f'Attempt {attempt}/{args.attempts}: {error}', flush=True)
            if attempt == args.attempts:
                raise SystemExit(1)
            time.sleep(10)


if __name__ == '__main__':
    main()
