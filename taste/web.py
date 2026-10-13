"""Export everything the phone app needs into compact static files.

    .venv/bin/python -m taste.web --out site

Writes <out>/ = the app (copied from web/) plus <out>/data/:
  meta.json     model constants, prior, genre names, data date
  films.json    columnar metadata (title, year, genres bitmask, imdb id, votes, score)
  vectors.bin   int8 taste vectors, N x K, row-major (per-dimension scales in meta)
  bias.bin      float32 general-appeal b per film
  flags.bin     uint8 per film: 1 = placed from content (no MovieLens ratings)
  seen.bin      int8 P x P covariance of seen/not-seen for the question pool
  posters.json  TMDB poster path per film ("" if none), same order as films.json
  extras.json   US streaming services, trailers and runtimes (films with 1,000+ votes)
  poster-cache.json, extras-cache.json  lookup caches, kept so the next build reuses them
The first P films are the question pool (most-rated MovieLens films).
"""
import argparse
import json
import shutil
from datetime import date

import numpy as np

from .content import CONTENT_VAR
from .data import OUT, ROOT
from .extras import CACHE as EXTRAS_CACHE
from .extras import REGION
from .posters import CACHE as POSTER_CACHE
from .profile import scales
from .quiz import ANSWERS, Model

MIN_VOTES = 100  # below this there is too little to go on
POOL = 1000      # question pool (as accurate as 2,000 in simulation)


def app_films(m=None, model_name="k64"):
    """The films the app ships: every MovieLens film plus IMDb films with MIN_VOTES+ votes.
    MovieLens films come first, in model order (the question pool is the first POOL)."""
    m = m or Model(model_name)
    items = m.items
    keep = np.flatnonzero((items.source == "ratings").to_numpy() | (items.votes.to_numpy() >= MIN_VOTES))
    return items.iloc[keep].assign(model_index=keep).reset_index(drop=True)


def export(out, model_name="k64"):
    out = ROOT / out
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "web", out)
    data = out / "data"
    data.mkdir()

    m = Model(model_name)
    it = app_films(m)
    keep = it.model_index.to_numpy()
    Q = m.X[keep, :-1]
    K = Q.shape[1]

    scale = np.abs(Q).max(0) + 1e-9
    q8 = np.clip(np.round(Q / scale * 127), -127, 127).astype(np.int8)
    q8.tofile(data / "vectors.bin")
    m.b[keep].astype(np.float32).tofile(data / "bias.bin")
    (it.source == "content").to_numpy().astype(np.uint8).tofile(data / "flags.bin")

    seen = m.seen
    P = min(POOL, len(seen.p))
    C = seen.C[:P, :P]
    c_scale = float(np.abs(C).max())
    np.clip(np.round(C / c_scale * 127), -127, 127).astype(np.int8).tofile(data / "seen.bin")

    genres = sorted({g for gs in it.genres.dropna() for g in gs.split(",") if g})
    bit = {g: 1 << k for k, g in enumerate(genres)}
    gmask = it.genres.fillna("").map(lambda gs: sum(bit.get(g, 0) for g in gs.split(",")))
    films = {
        "title": it.title.fillna("").tolist(),
        "year": it.year.fillna(0).astype(int).tolist(),
        "genres": gmask.astype(int).tolist(),
        "imdb": it.imdbId.fillna(0).astype(np.int64).tolist(),
        "votes": it.votes.fillna(0).astype(np.int64).tolist(),
        "score": (it.rating.fillna(0) * 10).round().astype(int).tolist(),
    }
    (data / "films.json").write_text(json.dumps(films, separators=(",", ":"), ensure_ascii=False))

    cache = json.loads(POSTER_CACHE.read_text()) if POSTER_CACHE.exists() else {}
    posters = [cache.get(str(i), "").lstrip("/") for i in films["imdb"]]
    (data / "posters.json").write_text(json.dumps(posters, separators=(",", ":")))
    if cache:
        shutil.copy(POSTER_CACHE, data / "poster-cache.json")

    # Where to watch + trailers + runtimes, keyed by the film's index in films.json.
    ex = json.loads(EXTRAS_CACHE.read_text()) if EXTRAS_CACHE.exists() else {}
    per_film = {}
    for k, imdb in enumerate(films["imdb"]):
        e = ex.get(str(imdb))
        if e:
            per_film[k] = [e.get("k", ""), e.get("p", []), e.get("b", 0), e.get("r", 0)]
    used = {p for v in per_film.values() for p in v[1]}
    providers = {pid: v for pid, v in ex.get("_providers", {}).items() if int(pid) in used}
    (data / "extras.json").write_text(json.dumps(
        {"region": REGION, "providers": providers, "films": per_film}, separators=(",", ":")))
    if ex:
        shutil.copy(EXTRAS_CACHE, data / "extras-cache.json")

    meta = {
        "updated": date.today().isoformat(),
        "n": len(it), "k": K, "pool": P,
        "scale": (scale / 127).round(8).tolist(),
        "mu": m.mu,
        "noise": m.sigma2 * m.noise_scale,
        "prior_mean": m.prior_mean.tolist(),
        "prior_cov": (m.prior_cov * m.prior_scale).tolist(),
        "answers": ANSWERS,
        "values": [m.value[a] for a in ANSWERS],
        "content_var": CONTENT_VAR,
        "seen_p": seen.p[:P].round(6).tolist(),
        "seen_scale": c_scale / 127,
        "seen_ridge": seen.ridge,
        "genres": genres,
        "scales": scales(m),
        # "% match" = Phi((pred + shift - threshold) / sqrt(sd^2 + tau^2)), fitted by
        # scripts/calibrate_match.py on held-out ratings.
        "match": {"threshold": 3.75, "tau": 0.68, "shift": 0.16},
    }
    (data / "meta.json").write_text(json.dumps(meta))
    sizes = {f.name: f.stat().st_size for f in data.iterdir()}
    print(f"web export: {len(it):,} films ({sum(map(bool, posters)):,} with posters) -> {out}  "
          + "  ".join(f"{k} {v / 1e6:.1f}MB" for k, v in sorted(sizes.items())))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site")
    ap.add_argument("--model", default="k64")
    a = ap.parse_args()
    export(a.out, a.model)
