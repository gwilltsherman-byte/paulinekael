"""Calibrate the app's "% match": the chance you'd rate a film 4 stars or more.

    match = Phi((predicted + shift - 3.75) / sqrt(sd^2 + tau^2))

sd is the model's uncertainty about the prediction; tau is how much a person's
actual rating scatters around even a perfectly known prediction; shift corrects
for people rating films they chose to watch a little higher than predicted. Both
are fitted by maximum likelihood on held-out ratings of validation people (after
a 20-rating quiz, and with their full history), then checked bucket by bucket.

    .venv/bin/python scripts/calibrate_match.py
"""
import sys
from pathlib import Path

import numpy as np
from scipy.stats import norm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from taste.evaluate import load_users  # noqa: E402
from taste.quiz import Model, Session, bucket_of, pick_info_gain_ps  # noqa: E402

THRESHOLD = 3.75  # ratings of 4, 4.5 and 5 count as "liked"


def collect(n_users=1000, target=20):
    m = Model("k64", catalog=False)
    rng, pool = np.random.default_rng(0), np.arange(1000)
    rows = {"quiz": [], "history": []}
    for uid, items, ratings in load_users("val", n_users):
        perm = rng.permutation(len(items))
        hold = perm[: max(10, len(items) * 3 // 10)]
        rest = perm[len(hold):]
        known = dict(zip(items[rest].tolist(), ratings[rest].tolist()))
        h_items, liked = items[hold], ratings[hold] >= 4

        s, rated, asked = Session(m), 0, 0
        while rated < target and asked < 400:
            i = pick_info_gain_ps(s, np.setdiff1d(pool, h_items))
            r = known.get(i)
            s.answer(i, None if r is None else bucket_of(r))
            rated, asked = rated + (r is not None), asked + 1
        mu, sd = s.predict(h_items)
        rows["quiz"].append(np.column_stack([mu, sd, liked]))

        s = Session(m)
        s.answer_many(known.keys(), [bucket_of(r) for r in known.values()])
        mu, sd = s.predict(h_items)
        rows["history"].append(np.column_stack([mu, sd, liked]))
    return {k: np.vstack(v) for k, v in rows.items()}


def prob(mu, sd, tau, shift=0.0):
    return norm.cdf((mu + shift - THRESHOLD) / np.sqrt(sd ** 2 + tau ** 2))


def main():
    data = collect()
    both = np.vstack(list(data.values()))
    y = both[:, 2] == 1

    def ll(tau, shift):
        p = np.clip(prob(both[:, 0], both[:, 1], tau, shift), 1e-9, 1 - 1e-9)
        return np.mean(np.where(y, np.log(p), np.log(1 - p)))

    grid = [(t, b) for t in np.arange(0.3, 1.31, 0.02) for b in np.arange(-0.2, 0.61, 0.02)]
    tau, shift = max(grid, key=lambda g: ll(*g))
    tau, shift = round(float(tau), 2), round(float(shift), 2)
    print(f"fitted tau = {tau:.2f} stars, shift = {shift:+.2f} stars\n")
    edges = [0, .2, .4, .6, .7, .8, .9, 1.01]
    for name, d in data.items():
        p = prob(d[:, 0], d[:, 1], tau, shift)
        print(f"{name}: {len(d):,} hidden ratings")
        print("   match shown   films   actually rated 4+")
        for lo, hi in zip(edges[:-1], edges[1:]):
            sel = (p >= lo) & (p < hi)
            if sel.sum() >= 50:
                print(f"   {lo:>4.0%}-{min(hi, 1):<4.0%} {sel.sum():>9,}   {d[sel, 2].mean():>6.0%}  (avg shown {p[sel].mean():.0%})")
        print()
    return tau, shift


if __name__ == "__main__":
    main()
