"""Simulate the quiz on held-out MovieLens users and measure how accurate it is.

For each held-out person we hide 30% of their ratings (the answer key) and let
the quiz ask about any film. If it asks about one of their other rated films,
they answer with the button matching their real rating; otherwise they answer
"haven't seen". After N questions we rank the hidden films and score:

  liked   of the 5 hidden films we'd put first, the share they rated 4+ stars
  loved   ... the share they rated 4.5+ stars
  flop    ... the share they rated 2.5 stars or less
  order   given two hidden films they rated differently, how often we rank
          the one they preferred higher (0.5 = coin flip)
  rmse/mae  error of the predicted star rating

"random_pick" is the base rate (a random film from their hidden set);
"all_known" is the ceiling where every non-hidden rating is used, which is
what importing a full Letterboxd/IMDb history would give.

Because MovieLens only records films people chose to rate, the simulated person
answers "haven't seen" more often than a real one would, so these numbers are
conservative about how fast the quiz learns.
"""
import argparse
import json
import os
import time
from multiprocessing import Pool

import numpy as np
import pandas as pd

from .data import OUT, ROOT
from .quiz import PICKERS, Model, Session, bucket_of

CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60]  # questions asked
RATED_CHECKPOINTS = [0, 5, 10, 15, 20, 30, 40]        # ... or films rated (--by-rated)
MAX_ASKS = 400
HOLDOUT_FRAC = 0.3
MAX_HOLDOUT = 1000
QUESTION_POOL = int(os.environ.get("TASTE_QUESTION_POOL", 2000))  # quiz asks about the N most-rated films

_M, _CFG = None, None


def _init(model_name, cfg):
    global _M, _CFG
    _M, _CFG = Model(model_name, catalog=False), cfg
    _CFG["answer"] = float if cfg["exact"] else bucket_of


def score(pred, true, rng):
    top = true[np.lexsort((rng.random(len(pred)), -pred))[:5]]
    dt = true[:, None] - true[None, :]
    dp = pred[:, None] - pred[None, :]
    pairs = dt > 0
    order = np.mean((dp[pairs] > 0) + 0.5 * (dp[pairs] == 0)) if pairs.any() else np.nan
    err = pred - true
    return dict(liked=np.mean(top >= 4), loved=np.mean(top >= 4.5), flop=np.mean(top <= 2.5),
                order=order, sse=float(err @ err), ae=float(np.abs(err).sum()), n=len(true))


def eval_user(args):
    uid, items, ratings = args
    rng = np.random.default_rng(int(uid))
    perm = rng.permutation(len(items))
    n_hold = min(MAX_HOLDOUT, max(10, round(HOLDOUT_FRAC * len(items))))
    hold, rest = perm[:n_hold], perm[n_hold:]
    h_items, h_true = items[hold], ratings[hold]
    known = dict(zip(items[rest].tolist(), ratings[rest].tolist()))
    qpool = np.arange(min(QUESTION_POOL, _M.n_items))
    if _CFG.get("fair_pool"):  # never ask about the hidden films being scored
        qpool = np.setdiff1d(qpool, h_items)
    n_total = len(items)
    kw = (_CFG["prior_scale"], _CFG["noise_scale"])

    rows = [dict(user=uid, n_total=n_total, strategy="random_pick", q=0, rated=0,
                 liked=np.mean(h_true >= 4), loved=np.mean(h_true >= 4.5),
                 flop=np.mean(h_true <= 2.5), order=0.5)]
    by_rated = _CFG["by_rated"]
    for name in _CFG["strategies"]:
        s, pick, asked, rated = Session(_M, *kw), PICKERS[name], 0, 0
        for target in (RATED_CHECKPOINTS if by_rated else CHECKPOINTS):
            while (rated if by_rated else asked) < target and asked < MAX_ASKS:
                i = pick(s, qpool, rng)
                r = known.get(i)
                s.answer(i, None if r is None else _CFG["answer"](r))
                asked += 1
                rated += r is not None
            pred, _ = s.predict(h_items)
            rows.append(dict(user=uid, n_total=n_total, strategy=name, q=target, asked=asked,
                             rated=rated, **score(pred, h_true, rng)))

    if _CFG["ceiling"]:
        s = Session(_M, *kw)
        s.answer_many(known.keys(), [_CFG["answer"](r) for r in known.values()])
        pred, _ = s.predict(h_items)
        rows.append(dict(user=uid, n_total=n_total, strategy="all_known", q=-1,
                         rated=len(known), **score(pred, h_true, rng)))
    return rows


def load_users(split, n=None, seed=0):
    z = np.load(OUT / f"{split}.npz")
    ptr = z["indptr"]
    users = [(u, z["items"][ptr[k]:ptr[k + 1]], z["ratings"][ptr[k]:ptr[k + 1]])
             for k, u in enumerate(z["user_ids"])]
    if n and n < len(users):
        idx = np.random.default_rng(seed).choice(len(users), n, replace=False)
        users = [users[k] for k in sorted(idx)]
    return users


def summarize(df):
    g = df.groupby(["strategy", "q"], sort=False)
    out = g[[c for c in ["asked", "rated", "liked", "loved", "flop", "order"] if c in df]].mean()
    if "sse" in df:
        out["rmse"] = np.sqrt(g.sse.sum() / g.n.sum())
        out["mae"] = g.ae.sum() / g.n.sum()
    return out.reset_index()


def run(model="model", split="val", n_users=None, strategies=("info_gain",), prior_scale=None,
        noise_scale=None, ceiling=True, exact=False, by_rated=False, workers=8, tag=None,
        verbose=True, fair_pool=False):
    users = load_users(split, n_users)
    cfg = dict(strategies=list(strategies), prior_scale=prior_scale,
               noise_scale=noise_scale, ceiling=ceiling, exact=exact, by_rated=by_rated,
               fair_pool=fair_pool)
    t0 = time.time()
    with Pool(workers, initializer=_init, initargs=(model, cfg)) as pool:
        rows = [r for rs in pool.imap_unordered(eval_user, users, chunksize=8) for r in rs]
    df = pd.DataFrame(rows)
    summary = summarize(df)
    if tag:
        res = ROOT / "results"
        res.mkdir(exist_ok=True)
        df.to_parquet(res / f"{tag}_rows.parquet")
        summary.to_csv(res / f"{tag}_summary.csv", index=False)
        (res / f"{tag}_config.json").write_text(json.dumps(
            dict(model=model, split=split, n_users=len(users)) | cfg, indent=2))
    if verbose:
        print(f"{len(users)} {split} users, {time.time() - t0:.0f}s")
        with pd.option_context("display.width", 200, "display.max_rows", 200):
            print(summary.round(3).to_string(index=False))
    return df, summary


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="model")
    ap.add_argument("--split", default="val")
    ap.add_argument("--users", type=int, default=None)
    ap.add_argument("--strategies", default="info_gain")
    ap.add_argument("--prior-scale", type=float, default=None, help="default: tuned value in model json")
    ap.add_argument("--noise-scale", type=float, default=None)
    ap.add_argument("--no-ceiling", action="store_true")
    ap.add_argument("--exact", action="store_true", help="answer with exact stars, not buttons")
    ap.add_argument("--by-rated", action="store_true", help="checkpoint on films rated, not asked")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--tag", default=None)
    a = ap.parse_args()
    run(a.model, a.split, a.users, a.strategies.split(","), a.prior_scale, a.noise_scale,
        not a.no_ceiling, a.exact, a.by_rated, a.workers, a.tag)
