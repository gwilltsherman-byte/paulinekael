import unittest

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

    def test_the_apps_own_page_has_the_marker_and_the_files_exist_in_the_app(self):
        html = open("web/index.html").read()
        self.assertEqual(html.count(MARKER), 1)
        # every preloaded file is one the app really requests as name?v=<build>
        app = open("web/engine.js").read() + open("web/app.js").read()
        for name in NEEDED + LATER:
            self.assertIn(f'"{name}"', app)


if __name__ == "__main__":
    unittest.main()
