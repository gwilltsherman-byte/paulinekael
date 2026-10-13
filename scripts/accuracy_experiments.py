"""Two candidate accuracy upgrades, tested on held-out validation people.

A. "Haven't seen" as a weak taste signal: each unseen answer nudges your profile
   as if you'd rate that film `delta` stars below its prediction, with the noise
   multiplied by `noise` (so it counts much less than a real rating).
B. Content blend for rarely-rated films: mix each MovieLens film's taste vector
   with its content-based one (cast, crew, genre...), trusting ratings more the
   more a film has: w = n / (n + n0).

    TASTE_QUESTION_POOL=1000 .venv/bin/python scripts/accuracy_experiments.py [A|B]
"""
import json
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from taste.content import ContentModel, matched  # noqa: E402
from taste.data import OUT  # noqa: E402
from taste.evaluate import run  # noqa: E402

BASE = "k64"
USERS = 500


def variant(name, meta_extra=None, arrays=None):
    """Write data/processed/<name>.npz/.json: the base model with some fields replaced."""
    z = dict(np.load(OUT / f"{BASE}.npz"))
    z.update(arrays or {})
    np.savez(OUT / f"{name}.npz", **z)
    meta = json.loads((OUT / f"{BASE}.json").read_text()) | (meta_extra or {})
    (OUT / f"{name}.json").write_text(json.dumps(meta))
    return name


def cleanup(names):
    for n in names:
        for ext in ("npz", "json"):
            (OUT / f"{n}.{ext}").unlink(missing_ok=True)


def report(label, summary, qs):
    s = summary[summary.strategy == "info_gain_ps"].set_index("q")
    row = "  ".join(f"@{q}: liked {s.loc[q, 'liked']:.3f} order {s.loc[q, 'order']:.3f}" for q in qs)
    ceil = summary[summary.strategy == "all_known"]
    if len(ceil):
        row += f"  | all ratings: liked {ceil.liked.iloc[0]:.3f} order {ceil.order.iloc[0]:.3f}"
    print(f"{label:<28} {row}", flush=True)


def experiment_a():
    print("A. unseen answers as a weak signal (questions asked; hidden films never asked)")
    names = []
    for delta, noise in [(None, None), (0.25, 4), (0.25, 16), (0.5, 4), (0.5, 16)]:
        extra = {} if delta is None else {"unseen_delta": delta, "unseen_noise": noise}
        name = variant(f"{BASE}_u{delta}_{noise}", extra)
        names.append(name)
        _, s = run(name, "val", USERS, ["info_gain_ps"], ceiling=False, fair_pool=True, verbose=False)
        report("off" if delta is None else f"delta {delta}, noise x{noise}", s, [10, 20, 40])
    cleanup(names)


def experiment_b():
    print("B. content blend for rarely-rated films (films rated; all ratings = ceiling)")
    z = np.load(OUT / f"{BASE}.npz")
    Q, b, n = z["Q"], z["b"], z["n_ratings"]
    _, idx, df, Y = matched(BASE)
    fold = np.random.default_rng(1).integers(0, 5, len(idx))
    pred = np.zeros_like(Y)
    for f in range(5):  # out-of-fold, so no film's own ratings leak into its content vector
        pred[fold == f] = ContentModel().fit(df[fold != f], Y[fold != f]).predict(df[fold == f])
    names = []
    for n0 in [0, 10, 30, 100]:
        Qb, bb = Q.copy(), b.copy()
        if n0:
            w = (n[idx] / (n[idx] + n0))[:, None]
            Qb[idx] = w * Q[idx] + (1 - w) * pred[:, :-1]
            bb[idx] = w[:, 0] * b[idx] + (1 - w[:, 0]) * pred[:, -1]
        name = variant(f"{BASE}_b{n0}", arrays={"Q": Qb.astype(np.float32), "b": bb.astype(np.float32)})
        names.append(name)
        _, s = run(name, "val", USERS, ["info_gain_ps"], by_rated=True, fair_pool=True, verbose=False)
        report("off" if not n0 else f"n0 = {n0}", s, [10, 20, 40])
    cleanup(names)


if __name__ == "__main__":
    os.environ.setdefault("TASTE_QUESTION_POOL", "1000")
    which = sys.argv[1] if len(sys.argv) > 1 else "AB"
    if "A" in which:
        experiment_a()
    if "B" in which:
        experiment_b()
