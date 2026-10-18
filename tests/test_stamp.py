import re
import unittest
from pathlib import Path

from taste.stamp import LATER, MARKER, NEEDED, preload_links, stamp_index


class Stamp(unittest.TestCase):
    def test_links_use_the_builds_name_and_version(self):
        links = preload_links("20260101000000")
        for name in NEEDED + LATER:
            self.assertIn(f'href="data/{name}?v=20260101000000"', links)
        self.assertEqual(links.count('as="fetch" crossorigin'), len(NEEDED) + len(LATER))
        self.assertEqual(links.count("fetchpriority=low"), len(LATER))

    def test_marker_is_replaced_once(self):
        out = stamp_index(f"<head>{MARKER}</head>", "b1")
        self.assertNotIn(MARKER, out)
        self.assertIn("data/quick.json?v=b1", out)

    def test_a_page_without_the_marker_is_an_error(self):
        with self.assertRaises(ValueError):
            stamp_index("<head></head>", "b1")

    def test_shell_entrypoints_share_the_build_version(self):
        html = Path("web/index.html").read_text()
        out = stamp_index(html, "20261018000500")
        # An old HTTP cache or service worker must not pair a new page with
        # the previous release's unversioned entry script or stylesheet.
        scripts = re.findall(r'<script\b[^>]*\bsrc="([^"]+)"', html)
        styles = re.findall(r'<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"', html)
        self.assertTrue(scripts)
        self.assertTrue(styles)
        for name in scripts + styles:
            self.assertIn(f'"{name}?v=20261018000500"', out)
        self.assertIn('href="manifest.webmanifest?v=20261018000500"', out)
        # Imports in app.js remain unversioned; keep matching module preloads.
        modules = re.findall(r'<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"', html)
        for name in modules:
            self.assertIn(f'href="{name}"', out)

    def test_stamping_preserves_external_and_navigation_urls(self):
        html = (f'<head>{MARKER}'
                '<link rel="canonical" href="https://example.org/kael/">'
                '<link rel="preconnect" href="https://image.tmdb.org">'
                '</head><a href="#rate">Rate</a>')
        out = stamp_index(html, "b1")
        self.assertIn('href="https://example.org/kael/"', out)
        self.assertIn('href="https://image.tmdb.org"', out)
        self.assertIn('href="#rate"', out)

    def test_the_apps_own_page_has_the_marker_and_the_files_exist_in_the_app(self):
        html = Path("web/index.html").read_text()
        self.assertEqual(html.count(MARKER), 1)
        # every preloaded file is one the app really requests as name?v=<build>
        app = Path("web/engine.js").read_text() + Path("web/app.js").read_text()
        for name in NEEDED + LATER:
            self.assertIn(f'"{name}"', app)


if __name__ == "__main__":
    unittest.main()
