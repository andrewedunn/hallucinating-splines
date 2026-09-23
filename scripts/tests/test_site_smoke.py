# ABOUTME: Regression tests for release identity and false-positive smoke checks.
# ABOUTME: Exercises incorrect releases, missing metadata and invalid sitemap origins.
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('site_smoke', Path(__file__).parents[1] / 'site-smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SmokeTests(unittest.TestCase):
    def test_previous_release_is_rejected(self):
        with self.assertRaises(ValueError):
            smoke.verify_release('{"sha":"old","version":"0.1.2"}', 'new', '0.1.2')

    def test_exact_release_is_accepted(self):
        smoke.verify_release('{"sha":"new","version":"0.1.2"}', 'new', '0.1.2')

    def test_page_requires_canonical_and_fresh_styles(self):
        html = '<h1>A city</h1><link rel="canonical" href="https://hallucinatingsplines.com/">'
        with self.assertRaises(ValueError):
            smoke.verify_html(html + '<link rel="stylesheet" href="/styles/global.css">', '/', '0.1.2')
        html += '<link rel="stylesheet" href="/styles/global.css?v=0.1.2"><link rel="stylesheet" href="/styles/tokens.css?v=0.1.2">'
        smoke.verify_html(html, '/', '0.1.2')
        with self.assertRaises(ValueError):
            smoke.verify_html(html.replace('rel="canonical"', 'rel="alternate"'), '/', '0.1.2')

    def test_sitemap_rejects_wrong_domain(self):
        with self.assertRaises(ValueError):
            smoke.verify_sitemap('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>')

    def test_sitemap_accepts_current_file(self):
        smoke.verify_sitemap((Path(__file__).parents[2] / 'site/public/sitemap.xml').read_text())


if __name__ == '__main__':
    unittest.main()
