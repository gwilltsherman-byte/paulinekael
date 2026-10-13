"""Do recommendations come from the combination of your ratings, or from one film?

For simulated people (test users answering the quiz until N films are rated, default 20):
  * dominance: for their top-20 "Most your taste" picks (ranked by personal boost),
    the share of the boost that comes from the single biggest contributing film
  * accuracy: top-5 liked / flop rate on their hidden films when ranking by the
    usual prediction vs. a leave-one-out prediction that ignores the single
    biggest contributor (so a film only ranks high if several ratings support it)

    .venv/bin/python scripts/combination_check.py [n_users] [films_rated]
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from taste.evaluate import load_users  # noqa: E402
from taste.quiz import Model, Session, bucket_of, pick_info_gain_ps  # noqa: E402


def contributions(s, items):
    """c[i, j] = push of rated film j on film i's prediction, taste dimensions only.

    The generosity dimension is left out: it lifts every film about equally, so it
    says nothing about why *this* film was picked (same split as Session.explain).
    """
    rated = [j for j, a in s.answers.items() if a is not None]
    Xr = s.m.X[rated]
    t = np.array([s.stars(s.answers[j]) for j in rated]) - s.m.mu - s.m.b[rated]
    return (s.m.X[items][:, :-1] @ (s.cov @ Xr.T)[:-1]) * t / s.noise


def main(n_users=500, target=20):
    m = Model("k64", catalog=False)
    rng = np.random.default_rng(0)
    pool = np.arange(1000)
    popular = np.flatnonzero(m.popularity >= np.quantile(m.popularity, 0.5))  # rec candidates
    share, stats = {"usual": [], "leave_one_out": []}, {"usual": [], "leave_one_out": []}
    for uid, items, ratings in load_users("test", n_users):
        perm = rng.permutation(len(items))
        hold = perm[: max(10, len(items) * 3 // 10)]
        known = dict(zip(items[perm[len(hold):]].tolist(), ratings[perm[len(hold):]].tolist()))
        s, rated, asked = Session(m), 0, 0
        while rated < target and asked < 400:
            i = pick_info_gain_ps(s, pool)
            r = known.get(i)
            s.answer(i, None if r is None else bucket_of(r))
            rated += r is not None
            asked += 1

        cand = np.setdiff1d(popular, list(s.answers))
        mean, _ = s.predict(cand)
        cand, mean = cand[mean >= 3.75], mean[mean >= 3.75]   # "Most your taste" candidates
        c_all = contributions(s, cand)
        pos_all = np.clip(c_all, 0, None)
        lift = c_all.sum(1)
        for name, key in [("usual", lift), ("leave_one_out", lift - pos_all.max(1))]:
            pos = pos_all[np.argsort(-key)[:20]]
            share[name].extend(pos.max(1) / np.maximum(pos.sum(1), 1e-9))

        h_items, h_true = items[hold], ratings[hold]
        mean_h, _ = s.predict(h_items)
        loo = mean_h - np.clip(contributions(s, h_items), 0, None).max(1)
        for name, score in [("usual", mean_h), ("leave_one_out", loo)]:
            top5 = h_true[np.argsort(-score)[:5]]
            stats[name].append((np.mean(top5 >= 4), np.mean(top5 <= 2.5)))

    print(f"{n_users} test people, {target} films rated each:")
    for name, v in stats.items():
        v, sh = np.array(v), np.array(share[name])
        print(f"  ranking {name:<14} top-5 liked {v[:, 0].mean():.3f}  flops {v[:, 1].mean():.3f}  | "
              f"top-20 picks mostly from one film: {np.mean(sh > 0.5):.0%} (median share {np.median(sh):.0%})")


if __name__ == "__main__":
    main(*(int(a) for a in sys.argv[1:3]))
