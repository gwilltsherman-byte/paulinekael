"""Where to watch (US), trailers, runtimes and film-page details (summary, tagline,
director, top cast, backdrop) from TMDB, for films with 1,000+ IMDb votes.

    TMDB_TOKEN=... .venv/bin/python -m taste.extras

TMDB ids come from Wikidata and MovieLens (no lookup needed for ~96% of films).
Results are cached in data/processed/extras-cache.json (restored from the build-cache branch
each week). Streaming availability changes, so the 10,000 most-voted films are
refreshed weekly and the rest every four weeks; trailers and runtimes are kept. Films
cached before film-page details were fetched are refetched first.

Streaming data is provided by JustWatch via TMDB. This product uses the TMDB API
but is not endorsed or certified by TMDB.
"""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pandas as pd

from .catalog import IMDB, WIKIDATA
from .data import OUT
from .posters import RATE, Limiter, clean_token

CACHE = OUT / "extras-cache.json"
REGION = "US"
MIN_VOTES = 1000
WEEKLY_TOP = 10_000     # most-voted films refreshed every week, the rest every 4 weeks
MAX_CALLS = 45_000      # per run (~21 minutes)
API = "https://api.themoviedb.org/3"
TMDB_ID_QUERY = ('SELECT ?imdb ?tmdb WHERE { ?film wdt:P345 ?imdb ; wdt:P4947 ?tmdb . '
                 'FILTER(STRSTARTS(?imdb, "tt")) }')
STREAM_KINDS = ("flatrate", "free", "ads")   # included with a subscription, or free
TOP_CAST = 8


def _get(path, token, limiter, params=""):
    url = f"{API}{path}?{params}"
    headers = {"accept": "application/json"}
    if "." in token:
        headers["Authorization"] = f"Bearer {token}"
    else:
        url += f"&api_key={token}"
    for attempt in range(4):
        limiter.wait()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise SystemExit("TMDB rejected the token (401). Check the TMDB_TOKEN secret.")
            if e.code == 404:
                return {}
            time.sleep(2 ** attempt)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            time.sleep(1 + attempt)
    return None


def tmdb_ids():
    """imdb id -> TMDB movie id, from Wikidata (refreshed) and MovieLens links."""
    path = IMDB / "wikidata_tmdb.csv"
    subprocess.run(["curl", "-sS", "--fail", "--max-time", "120", "-G", WIKIDATA,
                    "--data-urlencode", f"query={TMDB_ID_QUERY}", "-H", "Accept: text/csv",
                    "-A", "movie-taste/0.1 (personal non-commercial recommender)", "-o", str(path)])
    ids = {}
    if path.exists():
        # A timed-out query can end in an error message; skip those lines, keep the ids before them.
        w = pd.read_csv(path, dtype=str, on_bad_lines="skip").dropna(subset=["imdb", "tmdb"])
        w = w[w.tmdb.str.fullmatch(r"\d+") & w.imdb.str.fullmatch(r"tt\d+")]
        ids.update(zip(w.imdb.str[2:].astype(int), w.tmdb.astype(int)))
    ml = pd.read_parquet(OUT / "items.parquet")[["imdbId", "tmdbId"]].dropna()
    ids.update(zip(ml.imdbId.astype(int), ml.tmdbId.astype(int)))
    return ids


def details(tmdb_id, token, limiter):
    """{"k": trailer, "p": [provider ids], "b": rent/buy, "r": runtime, "o": summary,
    "g": tagline, "d": [directors], "c": [[name, character, photo], ...], "bd": backdrop,
    "pp": poster, "at": date}, or None on failure."""
    d = _get(f"/movie/{tmdb_id}", token, limiter, "append_to_response=videos,watch/providers,credits")
    if d is None:
        return None
    vids = [v for v in (d.get("videos") or {}).get("results", [])
            if v.get("site") == "YouTube" and v.get("type") == "Trailer"]
    vids.sort(key=lambda v: (not v.get("official"), v.get("iso_639_1") != "en", -(v.get("size") or 0)))
    here = ((d.get("watch/providers") or {}).get("results") or {}).get(REGION) or {}
    providers = sorted({p["provider_id"] for kind in STREAM_KINDS for p in here.get(kind, [])})
    credits = d.get("credits") or {}
    directors = [c["name"] for c in credits.get("crew", []) if c.get("job") == "Director"][:2]
    cast = [[c.get("name", ""), c.get("character") or "", c.get("profile_path") or ""]
            for c in sorted(credits.get("cast", []), key=lambda c: c.get("order", 999))[:TOP_CAST]]
    return {"k": vids[0]["key"] if vids else "", "p": providers,
            "b": int(bool(here.get("rent") or here.get("buy"))),
            "r": d.get("runtime") or 0, "o": (d.get("overview") or "").strip(),
            "g": (d.get("tagline") or "").strip(), "d": directors, "c": cast,
            "bd": d.get("backdrop_path") or "", "pp": d.get("poster_path") or "",
            "at": date.today().isoformat()}


def update(films):
    """films: DataFrame with imdbId and votes (the app's films)."""
    token = clean_token(os.environ.get("TMDB_TOKEN", ""))
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    if not token:
        print(f"extras: no TMDB_TOKEN set, keeping existing cache ({len(cache):,} films)")
        return cache
    ids = tmdb_ids()
    want = films[films.votes >= MIN_VOTES].sort_values("votes", ascending=False).imdbId.astype(int)
    today = date.today()

    def stale(imdb, rank):
        c = cache.get(str(imdb))
        if not c or "at" not in c or "o" not in c:
            return True
        age = (today - date.fromisoformat(c["at"])).days
        return age >= (7 if rank < WEEKLY_TOP else 28)

    todo = [(i, ids[i]) for rank, i in enumerate(want) if i in ids and stale(i, rank)][:MAX_CALLS]
    limiter, t0 = Limiter(RATE), time.time()
    providers = _get("/watch/providers/movie", token, limiter, f"watch_region={REGION}") or {}
    with ThreadPoolExecutor(16) as pool:
        for (imdb, tid), got in zip(todo, pool.map(lambda p: details(p[1], token, limiter), todo)):
            if got is not None:
                cache[str(imdb)] = {"t": tid, **got}
    names = {p["provider_id"]: [p["provider_name"], p.get("logo_path", ""), p.get("display_priority", 999)]
             for p in providers.get("results", [])}
    if names:
        cache["_providers"] = names
    tmp = CACHE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, separators=(",", ":")))
    tmp.replace(CACHE)
    have = sum(1 for i in want if str(i) in cache)
    print(f"extras: fetched {len(todo):,} films in {time.time() - t0:.0f}s; {have:,} of {len(want):,} "
          f"films with {MIN_VOTES:,}+ votes have streaming/trailer data ({len(ids):,} TMDB ids known)")
    return cache


if __name__ == "__main__":
    from .web import app_films
    update(app_films())
