"""Load MovieLens 32M, filter it, and split users into train / validation / test.

Validation and test users are held out of training entirely, so evaluating on
them is a true cold start: the model has never seen them, exactly like a new
person opening the app.
"""
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "ml-32m"
OUT = ROOT / "data" / "processed"

MIN_ITEM_RATINGS = 20  # films with fewer ratings get unreliable taste vectors
MIN_EVAL_RATINGS = 50  # eval users need enough ratings for a quiz pool + holdout
N_VAL, N_TEST = 2000, 5000
SEED = 7


def _year(title):
    m = re.search(r"\((\d{4})\)\s*$", title.strip())
    return int(m.group(1)) if m else -1


def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    print("reading ratings.csv ...")
    r = pd.read_csv(
        RAW / "ratings.csv",
        usecols=["userId", "movieId", "rating"],
        dtype={"userId": "int32", "movieId": "int32", "rating": "float32"},
        engine="pyarrow",
    )
    print(f"  {len(r):,} ratings, {r.userId.nunique():,} users, {r.movieId.nunique():,} films")

    counts = r.movieId.value_counts()
    r = r[r.movieId.isin(counts.index[counts >= MIN_ITEM_RATINGS])]
    per_user = r.userId.value_counts()
    r = r[r.userId.isin(per_user.index[per_user >= 20])]

    rng = np.random.default_rng(SEED)
    eligible = np.sort(per_user.index[per_user >= MIN_EVAL_RATINGS].to_numpy())
    held = rng.choice(eligible, N_VAL + N_TEST, replace=False)
    val_users, test_users = set(held[:N_VAL]), set(held[N_VAL:])
    is_val = r.userId.isin(val_users).to_numpy()
    is_test = r.userId.isin(test_users).to_numpy()
    train = r[~is_val & ~is_test]

    # Item index 0 = most-rated film in training (handy for question pools).
    tc = train.movieId.value_counts()
    movie_ids = tc.index.to_numpy()
    item_of = pd.Series(np.arange(len(movie_ids), dtype=np.int32), index=movie_ids)

    train_users = np.sort(train.userId.unique())
    user_of = pd.Series(np.arange(len(train_users), dtype=np.int32), index=train_users)
    np.save(OUT / "train_u.npy", user_of[train.userId].to_numpy())
    np.save(OUT / "train_i.npy", item_of[train.movieId].to_numpy())
    np.save(OUT / "train_r.npy", train.rating.to_numpy(np.float32))

    for name, mask in [("val", is_val), ("test", is_test)]:
        d = r[mask]
        d = d[d.movieId.isin(item_of.index)].sort_values("userId")
        uid, start = np.unique(d.userId.to_numpy(), return_index=True)
        indptr = np.append(start, len(d)).astype(np.int64)
        np.savez(OUT / f"{name}.npz", user_ids=uid, indptr=indptr,
                 items=item_of[d.movieId].to_numpy(), ratings=d.rating.to_numpy(np.float32))

    movies = pd.read_csv(RAW / "movies.csv").set_index("movieId")
    links = pd.read_csv(RAW / "links.csv").set_index("movieId")
    stats = train.groupby("movieId").rating.agg(["count", "mean"])
    items = pd.DataFrame({"movieId": movie_ids})
    items["title"] = movies.title.reindex(movie_ids).to_numpy()
    items["year"] = items.title.map(_year)
    items["genres"] = movies.genres.reindex(movie_ids).to_numpy()
    items["imdbId"] = links.imdbId.reindex(movie_ids).to_numpy()
    items["tmdbId"] = links.tmdbId.reindex(movie_ids).astype("Int64").to_numpy()
    items["n_ratings"] = stats["count"].reindex(movie_ids).to_numpy()
    items["mean_rating"] = stats["mean"].reindex(movie_ids).to_numpy()
    items.to_parquet(OUT / "items.parquet")

    print(f"  kept {len(movie_ids):,} films (>= {MIN_ITEM_RATINGS} ratings)")
    print(f"  train: {len(train):,} ratings from {len(train_users):,} users")
    print(f"  held out: {len(val_users):,} validation + {len(test_users):,} test users")


if __name__ == "__main__":
    prepare()
