"""Poster images for the app, looked up on TMDB by IMDb id.

    TMDB_TOKEN=... .venv/bin/python -m taste.posters

Keeps a cache (data/processed/poster-cache.json: imdb id -> poster path, "" when
TMDB has none), so each run only looks up films it hasn't seen before, most-voted
first. The weekly build restores the cache from the build-cache branch. Images are
then loaded straight from TMDB's image CDN by the phone.

This product uses the TMDB API but is not endorsed or certified by TMDB.
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from .data import OUT

CACHE = OUT / "poster-cache.json"
FIND = "https://api.themoviedb.org/3/find/tt{:07d}?external_source=imdb_id"
RATE = 35          # requests per second (TMDB allows roughly 50)
MAX_NEW = 60_000   # lookups per run, so the first run stays under ~30 minutes
RETRY_EMPTY = 5_000  # films TMDB had no poster for last time, asked again each run


class Limiter:
    def __init__(self, rate):
        self.gap, self.next, self.lock = 1 / rate, time.monotonic(), threading.Lock()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            at = max(now, self.next)
            self.next = at + self.gap
        time.sleep(max(0.0, at - now))


def lookup(imdb, token, limiter):
    """Poster path for one film, "" if TMDB has none, None if the lookup failed."""
    url, headers = FIND.format(imdb), {"accept": "application/json"}
    if "." in token:  # API Read Access Token (a JWT)
        headers["Authorization"] = f"Bearer {token}"
    else:             # v3 API key
        url += f"&api_key={token}"
    for attempt in range(4):
        limiter.wait()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as r:
                found = json.load(r)
            hits = found.get("movie_results") or found.get("tv_results") or []
            return (hits[0].get("poster_path") or "") if hits else ""
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise SystemExit("TMDB rejected the token (401). Check the TMDB_TOKEN secret.")
            if e.code == 404:
                return ""
            time.sleep(2 ** attempt)  # 429 rate limit or a server hiccup
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(1 + attempt)
    return None


def clean_token(raw):
    """Pull the credential out of whatever was pasted (line breaks, "Bearer ", labels)."""
    compact = re.sub(r"\s+", "", raw)
    jwt = re.search(r"eyJ[\w-]+\.[\w-]+\.[\w-]+", compact)  # API Read Access Token
    if jwt:
        return jwt.group(0)
    key = re.search(r"\b[0-9a-f]{32}\b", raw)                  # v3 API key
    return key.group(0) if key else compact


def update(imdb_ids):
    """Look up posters for imdb_ids (most important first) that aren't cached yet, and
    ask again about ones TMDB had no poster for (new films often get one later)."""
    token = clean_token(os.environ.get("TMDB_TOKEN", ""))
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    if not token:
        print("posters: no TMDB_TOKEN set, keeping existing cache"
              f" ({sum(1 for v in cache.values() if v):,} posters)")
        return cache
    kind = "read access token" if token.startswith("eyJ") else "API key" if len(token) == 32 else "unrecognised"
    print(f"posters: using a TMDB {kind} ({len(token)} characters)")
    todo = [i for i in imdb_ids if str(i) not in cache][:MAX_NEW]
    todo += [i for i in imdb_ids if cache.get(str(i)) == ""][:RETRY_EMPTY]
    limiter, t0 = Limiter(RATE), time.time()
    with ThreadPoolExecutor(16) as pool:
        for imdb, path in zip(todo, pool.map(lambda i: lookup(i, token, limiter), todo)):
            if path is not None:
                cache[str(imdb)] = path
    tmp = CACHE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, separators=(",", ":")))
    tmp.replace(CACHE)
    have = sum(1 for i in imdb_ids if cache.get(str(i)))
    print(f"posters: looked up {len(todo):,} films in {time.time() - t0:.0f}s; "
          f"{have:,} of {len(imdb_ids):,} app films have a poster")
    return cache


if __name__ == "__main__":
    from .web import app_films
    update(app_films().sort_values("votes", ascending=False).imdbId.astype(int).tolist())
