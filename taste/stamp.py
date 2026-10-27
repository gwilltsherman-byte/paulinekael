"""Stamp the app's index.html with the build it ships with.

The app asks for every data file as name?v=<build>, but it only learns the build by
fetching meta.json, which it can't do until app.js has loaded. So the first visit used to
go page -> script -> meta.json -> data files, one round trip after another. The build
already knows the stamp, so it puts <link rel="preload"> tags for the big files in the
page itself and they download alongside the script. (Browsers match a preload to the
later fetch() by URL, so the tags and the app must use the same name?v=<build>.)

The entry script and stylesheet also need build-specific URLs. Otherwise a browser
can combine newly published HTML with a still-fresh HTTP-cache copy of the old app.
Module preloads retain the same URLs as the imports in app.js.

Stdlib only, so tests/test_stamp.py runs without the data-science packages.
"""

from urllib.parse import quote

MARKER = "<!--preload-->"
# What a new visitor needs to start rating (see taste.quick). The big files are not
# preloaded: they would compete with these for bandwidth, and the app fetches them once the
# first card is up.
NEEDED = ["quick.json", "seen.bin"]
LATER = []
SHELL_ASSETS = ["app.css", "app.js", "install-persistence.js", "manifest.webmanifest"]


def preload_links(build):
    def link(name, low=False):
        return (f'<link rel="preload" as="fetch" crossorigin href="data/{name}?v={build}"'
                f'{" fetchpriority=low" if low else ""}>')
    return "\n  ".join([link(n) for n in NEEDED] + [link(n, True) for n in LATER])


def stamp_index(html, build):
    """html with the preload tags in place of MARKER. Raises if the marker is gone, so a
    build never quietly ships without them."""
    if MARKER not in html:
        raise ValueError(f"index.html has no {MARKER} to stamp")
    html = html.replace(MARKER, preload_links(build), 1)
    for name in SHELL_ASSETS:
        for attr in ("href", "src"):
            html = html.replace(f'{attr}="{name}"', f'{attr}="{name}?v={quote(str(build), safe="")}"')
    return html
