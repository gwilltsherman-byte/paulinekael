"""How much should an all-time favourite count? Test it on people whose ratings we know.

A favourite is one of your top few films of everything you've seen. The scale stops at
5 stars, so "Loved it" (4.5 or 5) lumps the very top in with films that were merely great.
Three ways to use one are compared (taste.quiz.Session.observation has the one the app uses):

  abs   a rating of S stars, past the 5-star cap, in place of "Loved it"
  rel   "Delta stars above your average film", in place of "Loved it". Taste only: your
        average film's generosity part cancels, so favourites can't make you look like a
        generous rater (with abs, every predicted score goes up).
  rel+  "Loved it" as well as rel's statement

Each person names their top FAVS films as favourites, then rates other films they've seen
(in random order). We rank 30% of their remaining films, held back, and score the ranking
as taste.evaluate does. Every setting is compared with giving the same films as plain
"Loved it" ratings, on the same people and films, so the differences are paired.

  sim   People drawn from the model itself: taste from the population prior, films seen by
        popularity, and each rating = the model's score plus noise, rounded to half stars
        and kept within 0.5-5. Favourites are the top FAVS by uncapped score. This shows what
        the cap on the scale hides, under the model's own assumptions. Needs only the files
        in model/.
  real  MovieLens validation people (data/processed/val.npz: scripts/download.sh, then
        python -m taste.data). Favourites are each person's FAVS highest-rated films, ties
        broken at random. Many people give 5 stars to dozens of films, so these are a
        weaker signal than a real top-5 list: a lower bound.

    .venv/bin/python scripts/favorites_experiment.py sim [people]
    .venv/bin/python scripts/favorites_experiment.py real [people]
"""
import os
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from taste.data import OUT  # noqa: E402
from taste.evaluate import HOLDOUT_FRAC, ROOT, load_users, score  # noqa: E402
from taste.quiz import Model, Session, bucket_of  # noqa: E402

MODEL = "k64"
FAVS = 5                          # favourites per person (the app's limit)
CHECKPOINTS = [0, 5, 10, 20, 40]  # films rated besides the favourites
LIFT = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5]   # Delta: stars above your average film
NOISE = [0.25, 0.5, 1.0, 2.0]           # times the noise of an ordinary rating
# How many films a simulated person has seen: log-normal, median SEEN_MEDIAN.
SEEN_MEDIAN = int(os.environ.get("TASTE_SEEN_MEDIAN", 120))
SEEN_SPREAD, SEEN_MIN, SEEN_MAX = 0.8, 75, 1500
WORKERS = int(os.environ.get("TASTE_WORKERS", os.cpu_count() or 4))

VARIANTS = [("none", "none", None, None), ("loved", "loved", None, None)] + [
    (f"abs {s:g}/{n:g}", "abs", s, n) for s in [5.5, 6.0] for n in [1.0]] + [
    (f"{f} {d:g}/{n:g}", f, d, n) for f in ["rel", "rel+"] for d in LIFT for n in NOISE]

_M, _L = None, None


def _init():
    global _M, _L
    _M = Model(MODEL, catalog=False)
    _L = np.linalg.cholesky(_M.prior_cov * _M.prior_scale)


def simulated(seed):
    """A made-up person: (films seen, their ratings, uncapped scores)."""
    m, rng = _M, np.random.default_rng(seed)
    w = m.prior_mean + _L @ rng.standard_normal(len(m.prior_mean))
    n = int(np.clip(np.exp(rng.normal(np.log(SEEN_MEDIAN), SEEN_SPREAD)), SEEN_MIN, SEEN_MAX))
    keys = np.log(m.n_ratings) + rng.gumbel(size=m.n_items)   # n films, chosen by popularity
    items = np.argpartition(-keys, n)[:n]
    y = m.mu + m.b[items] + m.X[items] @ w + rng.normal(0, np.sqrt(m.sigma2), n)
    return items, np.clip(np.round(y * 2) / 2, 0.5, 5.0), y


def person(args):
    mode, key = args
    if mode == "sim":
        uid, (items, r, y) = key, simulated(key)
    else:
        uid, items, r = key
        y = r + 1e-3 * np.random.default_rng(int(uid) + 1).random(len(r))   # ties at random
    rng = np.random.default_rng(int(uid))
    order = np.argsort(-y, kind="stable")
    fav, rest = items[order[:FAVS]], rng.permutation(order[FAVS:])
    n_hold = max(10, round(HOLDOUT_FRAC * len(rest)))
    h_items, h_true = items[rest[:n_hold]], r[rest[:n_hold]]
    rate = [(int(items[j]), bucket_of(r[j])) for j in rest[n_hold:][:max(CHECKPOINTS)]]

    m, rows = _M, []
    base = dict(user=uid, n_seen=len(items), fav_true=float(r[order[:FAVS]].mean()),
                fav_all_5=bool((r[order[:FAVS]] == 5).all()))
    for name, family, a, noise in VARIANTS:
        m.fav_lift, m.fav_noise = (a, noise) if family == "rel" else (None, 1.0)
        s = Session(m, favorites=fav.tolist() if family == "rel" else ())
        for i in fav if family != "none" else []:
            i = int(i)
            if family == "abs":
                s.answers[i] = "loved"
                s.update(m.X[i], a - m.mu - m.b[i], s.noise * noise)
            else:
                s.answer(i, "loved")
            if family == "rel+":
                s.update(m.X[i] - m.fav_ref, a - (m.b[i] - m.fav_ref_b), s.noise * noise)
        done = 0
        for k in CHECKPOINTS:
            for i, label in rate[done:k]:
                s.answer(i, label)
            done = min(k, len(rate))
            pred, _ = s.predict(h_items)
            rows.append(base | dict(variant=name, family=family, a=a, noise=noise, k=k, rated=done,
                                    **score(pred, h_true, np.random.default_rng(int(uid) * 100 + k))))
    return rows


def run(mode, n):
    if mode == "sim":
        keys = range(n)
    else:
        if not (OUT / "val.npz").exists():
            sys.exit("real mode needs data/processed/val.npz: run scripts/download.sh, then python -m taste.data")
        keys = load_users("val", n)
    t0 = time.time()
    with Pool(WORKERS, initializer=_init) as pool:
        rows = [r for rs in pool.imap_unordered(person, [(mode, k) for k in keys], chunksize=4) for r in rs]
    df = pd.DataFrame(rows)
    print(f"{mode}: {df.user.nunique():,} people, {time.time() - t0:.0f}s")
    return df


def report(df, mode):
    people = df[(df.variant == "loved") & (df.k == 0)]
    print(f"films seen: median {people.n_seen.median():.0f}; favourites' average rating "
          f"{people.fav_true.mean():.2f}; all five rated 5 stars: {people.fav_all_5.mean():.0%}")
    g = df.groupby(["variant", "k"], sort=False)
    summ = g[["rated", "liked", "loved", "flop", "order"]].mean()
    summ["rmse"] = np.sqrt(g.sse.sum() / g.n.sum())
    summ = summ.reset_index()

    # Paired against "favourites as Loved it": per person, then mean and standard error.
    ref = df[df.variant == "loved"].set_index(["user", "k"])
    out = []
    for (name, k), d in df.groupby(["variant", "k"], sort=False):
        d = d.set_index(["user", "k"])
        row = dict(variant=name, k=k)
        for c in ["order", "loved", "liked"]:
            diff = (d[c] - ref[c]).dropna()
            row[f"d_{c}"], row[f"se_{c}"] = diff.mean(), diff.std() / np.sqrt(len(diff))
        out.append(row)
    paired = pd.DataFrame(out).merge(summ[["variant", "k", "rmse"]], on=["variant", "k"])
    overall = paired.groupby("variant", sort=False)[["d_order", "d_loved", "d_liked"]].mean()
    overall["rmse"] = summ.groupby("variant", sort=False).rmse.mean()
    overall = overall.sort_values("d_order", ascending=False)

    pd.options.display.width = 200
    print("\nAverage over checkpoints (0-40 films rated), change vs favourites given as \"Loved it\":")
    print(overall.head(10).round(4).to_string())
    family = overall.index.str.split(" ").str[0]
    print("\nbest of each kind:")
    print(overall.groupby(family, sort=False).head(1).round(4).to_string())
    best = overall.index[0]
    best_rel = overall.index[family == "rel"][0]
    for name in dict.fromkeys([best, best_rel, "none"]):
        print(f"\n{name} by films rated (paired change ± standard error):")
        p = paired[paired.variant == name]
        for _, row in p.iterrows():
            print(f"  {row.k:>2} rated: order {row.d_order:+.4f} ± {row.se_order:.4f}   "
                  f"top-5 loved {row.d_loved:+.4f} ± {row.se_loved:.4f}   "
                  f"top-5 liked {row.d_liked:+.4f} ± {row.se_liked:.4f}   rmse {row.rmse:.3f}")
    res = ROOT / "results"
    res.mkdir(exist_ok=True)
    tag = f"{mode}{SEEN_MEDIAN}" if mode == "sim" and SEEN_MEDIAN != 120 else mode
    summ.to_csv(res / f"favorites_{tag}_summary.csv", index=False)
    paired.to_csv(res / f"favorites_{tag}_paired.csv", index=False)
    return overall


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "sim"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else (3000 if mode == "sim" else 2000)
    report(run(mode, n), mode)
