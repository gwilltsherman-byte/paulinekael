"""Check whether Kael's match estimates predict a held-out rating of 4+ stars.

    python scripts/calibrate_match.py --users 1000
    python scripts/calibrate_match.py --refit --users 1000

Requires the prepared MovieLens train model and val/test splits (taste.data).
By default this tests the shipped curve on unseen test users. --refit additionally
fits a candidate curve on validation users, and evaluates it on the same test
users as the shipped curve. This script does not change the app's calibration.
These are films people chose to rate, not outcomes from a live recommendation.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

CHECKPOINTS = (0, 3, 5, 10, 20)
THRESHOLD = 3.75
SHIPPED = (0.68, 0.16)  # (tau, shift), from taste.web.export
EDGES = (0, .2, .4, .6, .7, .8, .9, 1)


def quiz_checkpoints(session, pool, known, pick, bucket, checkpoints=CHECKPOINTS, max_asks=400):
    """Yield a session at its actual number of ratings. Never label skips as ratings."""
    rated = asked = 0
    for target in checkpoints:
        while rated < target and asked < min(max_asks, len(pool)):
            item = pick(session, pool)
            rating = known.get(item)
            session.answer(item, None if rating is None else bucket(rating))
            asked += 1
            rated += rating is not None
        if rated != target:
            break
        yield target, session


def collect(model, split, n_users, checkpoints=CHECKPOINTS):
    import numpy as np
    from taste.evaluate import load_users
    from taste.quiz import Session, bucket_of, pick_info_gain_ps

    pool = np.arange(min(1000, model.n_items))
    stages = {k: [] for k in (*checkpoints, "history")}
    people = load_users(split, n_users)
    for uid, items, ratings in people:
        perm = np.random.default_rng(int(uid)).permutation(len(items))
        n_hold = min(1000, max(10, len(items) * 3 // 10))
        hold, rest = perm[:n_hold], perm[n_hold:]
        if not len(hold) or not len(rest):
            continue
        known = dict(zip(items[rest].tolist(), ratings[rest].tolist()))
        hidden, liked = items[hold], ratings[hold] >= 4
        available = np.setdiff1d(pool, hidden)
        for target, session in quiz_checkpoints(Session(model), available, known, pick_info_gain_ps,
                                                bucket_of, checkpoints):
            mu, sd = session.predict(hidden)
            stages[target].append(np.column_stack([mu, sd, liked]))
        imported = Session(model)
        imported.answer_many(list(known), list(known.values()))  # same exact stars as the web importer
        mu, sd = imported.predict(hidden)
        stages["history"].append(np.column_stack([mu, sd, liked]))
    return stages, len(people)


def prob(mu, sd, tau, shift):
    import numpy as np
    from scipy.special import ndtr

    return ndtr((mu + shift - THRESHOLD) / np.sqrt(sd ** 2 + tau ** 2))


def fit(rows):
    import numpy as np
    from scipy.optimize import minimize

    mu, sd, liked = np.vstack(rows).T

    def loss(params):
        p = np.clip(prob(mu, sd, *params), 1e-9, 1 - 1e-9)
        return -np.mean(np.where(liked, np.log(p), np.log1p(-p)))

    result = minimize(loss, SHIPPED, bounds=((.3, 1.3), (-.2, .6)))
    if not result.success:
        raise RuntimeError(f"Could not fit calibration: {result.message}")
    return tuple(result.x)


def reliability(predicted, observed):
    """Return forecast/observed counts and Brier score, weighted per hidden film."""
    from bisect import bisect_right

    bins = [[0, 0.0, 0] for _ in EDGES[1:]]
    squared_error = 0.0
    for p, actual in zip(predicted, observed):
        index = min(len(bins) - 1, bisect_right(EDGES, p) - 1)
        count, forecast, liked = bins[index]
        bins[index] = [count + 1, forecast + p, liked + int(actual)]
        squared_error += (p - actual) ** 2
    n = sum(b[0] for b in bins)
    return bins, squared_error / n if n else None


def report(stages, n_users, tau, shift):
    import numpy as np

    for stage, rows in stages.items():
        name = "Imported history" if stage == "history" else f"{stage} ratings"
        if not rows:
            print(f"\n{name}: 0/{n_users} users reached this stage")
            continue
        mu, sd, liked = np.vstack(rows).T
        bins, brier = reliability(prob(mu, sd, tau, shift), liked)
        error = sum(abs(forecast - actual) for _, forecast, actual in bins) / len(liked)
        print(f"\n{name}: {len(rows)}/{n_users} users, {len(liked):,} hidden ratings; "
              f"Brier {brier:.4f}, weighted calibration gap {error:.1%}")
        print("   predicted band    films     avg predicted    actually rated 4+")
        for lo, hi, (n, forecast, actual) in zip(EDGES, EDGES[1:], bins):
            if n:
                print(f"   {lo:>4.0%}–{hi:<4.0%} {n:>10,} {forecast/n:>16.1%} {actual/n:>18.1%}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--users", type=int, default=1000, help="held-out users per split")
    ap.add_argument("--refit", action="store_true", help="also fit a candidate on validation profiles")
    args = ap.parse_args()
    if args.users < 1:
        ap.error("--users must be positive")
    processed = Path(__file__).resolve().parent.parent / "data" / "processed"
    required = ["k64.npz", "k64.json", "seen.npz", "test.npz"] + (["val.npz"] if args.refit else [])
    missing = [name for name in required if not (processed / name).is_file()]
    if missing:
        ap.error("Missing data/processed files: " + ", ".join(missing) +
                 ". Prepare MovieLens with python -m taste.data and copy the matching model files from model/.")
    from taste.quiz import Model

    model = Model("k64", catalog=False)
    curves = {"Shipped": SHIPPED}
    if args.refit:
        validation, _ = collect(model, "val", args.users, (20,))
        curves["Candidate"] = fit(validation[20] + validation["history"])
        del validation
    test, n_test = collect(model, "test", args.users)
    for label, (tau, shift) in curves.items():
        print(f"{label} curve on test users (tau={tau:.3f}, shift={shift:+.3f})")
        report(test, n_test, tau, shift)


if __name__ == "__main__":
    main()
