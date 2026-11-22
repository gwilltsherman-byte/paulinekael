"""Stream rating histories from held-out MovieLens users to the local Node evaluator.

    python scripts/refinement_inputs.py --split val --users 400 | node scripts/compare_picks.mjs --data site/data

Use the matching items.parquet and val.npz/test.npz from taste.data.prepare().
Do not tune on the test split. No ratings are uploaded.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from taste.data import OUT  # noqa: E402
from taste.evaluate import load_users  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", choices=["val", "test"], default="val")
    parser.add_argument("--users", type=int, default=400)
    args = parser.parse_args()
    if args.users < 1:
        parser.error("--users must be positive")
    imdb = pd.read_parquet(OUT / "items.parquet", columns=["imdbId"]).imdbId.fillna(0).to_numpy(dtype=np.int64)
    for uid, items, ratings in load_users(args.split, n=args.users, seed=0):
        # Resolve stable IDs before partitioning so a duplicate cannot enter both sides.
        by_id = {int(imdb[i]): float(stars) for i, stars in zip(items, ratings) if imdb[i] > 0}
        rows = list(by_id.items())
        rng = np.random.default_rng(int(uid))
        rng.shuffle(rows)
        n_hidden = min(1000, max(10, round(len(rows) * 0.3)))
        print(json.dumps(dict(seed=int(uid), known=rows[n_hidden:], hidden=rows[:n_hidden], split=args.split)))


if __name__ == "__main__":
    main()
