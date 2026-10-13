"""Place any film in taste space from its content, so every IMDb film can be recommended.

Films with enough MovieLens ratings keep the taste vectors learned from ratings.
For every other film, a ridge regression predicts its vector [q, b] from
director / writers / cast / composer / cinematographer, genres, decade, runtime,
and its IMDb score and vote count. It is trained on the films we know both ways.

    .venv/bin/python -m taste.content --experiment   # how good is content placement?
    .venv/bin/python -m taste.content                # build the full catalog model
"""
import argparse

import numpy as np
import pandas as pd
import scipy.sparse as sp

from .data import OUT
from .quiz import Model, Session, bucket_of

VOTE_EDGES = [100, 1_000, 10_000, 100_000]
BAYES_M = 10_000  # votes of prior weight on the average rating
RUNTIME_EDGES = [80, 95, 110, 130, 160]


def genre_vocab(df):
    return sorted({g for gs in df.genres.dropna() for g in gs.split(",")})


def dense_features(df, genres):
    """Genres, decade, runtime, vote-count range, Bayesian-averaged IMDb score."""
    cols = {}
    for g in genres:
        cols[f"genre:{g}"] = df.genres.fillna("").str.contains(g, regex=False).astype(float)
    decade = (df.year.fillna(0) // 10 * 10).clip(1910, 2020)
    for d in range(1910, 2030, 10):
        cols[f"decade:{d}"] = (decade == d).astype(float)
    rt = np.digitize(df.runtime.fillna(-1), RUNTIME_EDGES)
    for k in range(len(RUNTIME_EDGES) + 1):
        cols[f"runtime:{k}"] = ((rt == k) & df.runtime.notna()).astype(float)
    vb = np.digitize(df.votes, VOTE_EDGES)
    # Bayesian average (as IMDb's Top 250 does): a 9.9 from 4,000 votes is mostly
    # noise or fan campaigns, while a 9.3 from 3 million votes is not.
    centered = df.votes * (df.rating - 6.5) / (df.votes + BAYES_M)
    # One slope for every vote range: per-range slopes learned to undo the
    # shrinkage and put 9.9-from-4,000-votes films at the top of every list.
    cols["rating"] = centered
    # ...but let each language group have its own trust in IMDb scores: large home
    # audiences push some markets' scores well above how outsiders rate the films.
    langs = df.langs.fillna("").str.split()
    groups = langs.map(lambda ls: {LANG_GROUP.get(x, "english" if x == "Q1860" else "other") for x in ls} or {"unknown"})
    for g in [*LANG_GROUPS, "english", "other", "unknown"]:
        cols[f"rating_x_{g}"] = centered * groups.map(lambda gs: g in gs).astype(float)
    for k in range(len(VOTE_EDGES) + 1):
        cols[f"votes:{k}"] = (vb == k).astype(float)
    cols["log_votes"] = np.log10(df.votes) - 3
    return np.column_stack(list(cols.values())), list(cols)


def people_vocab(people, min_films=2):
    counts = pd.Series([t for s in people for t in set(s.split())]).value_counts()
    return {t: k for k, t in enumerate(counts.index[counts >= min_films])}


def people_matrix(people, vocab):
    rows, cols = [], []
    for r, s in enumerate(people):
        for t in set(s.split()):
            k = vocab.get(t)
            if k is not None:
                rows.append(r)
                cols.append(k)
    return sp.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(people), len(vocab)))


# Wikidata language ids -> broader groups, so rare languages (e.g. Punjabi, with
# few MovieLens films) share what is learned from related ones (e.g. Hindi).
LANG_GROUPS = {
    "south_asian": "Q1568 Q5885 Q8097 Q36236 Q33673 Q58635 Q9610 Q1571 Q5580 Q33902 Q1617 Q11051 Q13267",
    "east_asian": "Q5287 Q9176 Q7850 Q727694 Q9186 Q13325 Q9199",
    "romance": "Q150 Q1321 Q652 Q5146 Q750553 Q7913 Q7026",
    "germanic_nordic": "Q188 Q7411 Q9027 Q9035 Q9043 Q294",
    "slavic_eastern": "Q7737 Q809 Q9056 Q8798 Q9058 Q9063 Q9067",
    "middle_eastern": "Q256 Q9288 Q13955 Q9168 Q56356",
}
LANG_GROUP = {q: g for g, qs in LANG_GROUPS.items() for q in qs.split()}


def tokens(df):
    """People plus original language(s) and language group, as space-separated tokens."""
    langs = df.langs.fillna("").str.split().map(
        lambda ls: " ".join([f"l:{x}" for x in ls] + sorted({f"g:{LANG_GROUP[x]}" for x in ls if x in LANG_GROUP})))
    return (df.people.fillna("") + " " + langs).to_numpy()


def design(df, genres, vocab, people_weight):
    D, _ = dense_features(df, genres)
    return sp.hstack([sp.csr_matrix(D), people_weight * people_matrix(tokens(df), vocab)]).tocsr()


def ridge(A, Y, lam, iters=500, tol=1e-6):
    """Solve (A'A + lam I) W = A'Y for all columns of Y at once with conjugate gradients."""
    At = A.T.tocsr()
    B = At @ Y
    W = np.zeros_like(B)
    R = B.copy()
    P = R.copy()
    rs = (R * R).sum(0)
    stop = tol * np.sqrt((B * B).sum(0)).max()
    for _ in range(iters):
        AP = At @ (A @ P) + lam * P
        alpha = rs / (P * AP).sum(0)
        W += P * alpha
        R -= AP * alpha
        new = (R * R).sum(0)
        if np.sqrt(new.max()) < stop:
            break
        P = R + P * (new / rs)
        rs = new
    return W


class ContentModel:
    def __init__(self, lam=10.0, people_weight=1.0):
        self.lam, self.people_weight = lam, people_weight

    def fit(self, df, Y):
        self.genres = genre_vocab(df)
        self.vocab = people_vocab(tokens(df))
        self.mean = Y.mean(0)
        A = design(df, self.genres, self.vocab, self.people_weight)
        self.W = ridge(A, Y - self.mean, self.lam)
        return self

    def predict(self, df):
        return self.mean + design(df, self.genres, self.vocab, self.people_weight) @ self.W


def matched(model_name):
    """MovieLens films joined to their IMDb catalog rows, with their learned vectors."""
    m = Model(model_name, catalog=False)
    items = pd.read_parquet(OUT / "items.parquet")
    cat = pd.read_parquet(OUT / "catalog.parquet").set_index("imdbId")
    ok = items.imdbId.isin(cat.index).to_numpy()
    idx = np.flatnonzero(ok)
    df = cat.loc[items.imdbId[idx]].reset_index()
    Y = np.hstack([m.X[idx, :-1], m.b[idx, None]])
    return m, idx, df, Y


# Extra prediction variance for content-placed films: squared RMSE with content
# vectors minus with rating vectors, measured on held-out films (test users):
# 0.821^2 - 0.766^2 ~= 0.087 (random films), 0.822^2 - 0.780^2 ~= 0.068 (newest).
CONTENT_VAR = 0.08


def build(model_name="k64"):
    """Write <model>_catalog.npz/.parquet: every film, MovieLens films first (same indices)."""
    m, idx, df, Y = matched(model_name)
    cm = ContentModel().fit(df, Y)
    items = pd.read_parquet(OUT / "items.parquet")
    cat = pd.read_parquet(OUT / "catalog.parquet")
    new = cat[~cat.imdbId.isin(items.imdbId)].reset_index(drop=True)
    pred = cm.predict(new)

    by_id = cat.set_index("imdbId")
    ml = items.join(by_id[["title", "year", "genres", "rating", "votes"]], on="imdbId", rsuffix="_imdb")
    ml_meta = pd.DataFrame({
        "title": ml.title_imdb.fillna(ml.title.str.replace(r"\s*\(\d{4}\)\s*$", "", regex=True)),
        "year": ml.year_imdb.fillna(ml.year).astype("Int64"),
        "genres": ml.genres_imdb.fillna(ml.genres.str.replace("|", ",")),
        "imdbId": ml.imdbId, "rating": ml.rating, "votes": ml.votes.fillna(0).astype(np.int64),
        "n_ratings": ml.n_ratings, "source": "ratings",
    })
    new_meta = pd.DataFrame({
        "title": new.title, "year": new.year.astype("Int64"), "genres": new.genres,
        "imdbId": new.imdbId, "rating": new.rating, "votes": new.votes.astype(np.int64),
        "n_ratings": 0, "source": "content",
    })
    meta = pd.concat([ml_meta, new_meta], ignore_index=True)
    Q = np.vstack([m.X[:, :-1], pred[:, :-1]]).astype(np.float32)
    b = np.concatenate([m.b, pred[:, -1]]).astype(np.float32)
    item_var = np.concatenate([np.zeros(m.n_items), np.full(len(new), CONTENT_VAR)]).astype(np.float32)
    # Write under temporary names, then swap in, so a running quiz never reads half a file.
    np.savez(OUT / f"{model_name}_catalog.tmp.npz", Q=Q, b=b, item_var=item_var)
    meta.to_parquet(OUT / f"{model_name}_catalog.tmp.parquet")
    (OUT / f"{model_name}_catalog.tmp.parquet").replace(OUT / f"{model_name}_catalog.parquet")
    (OUT / f"{model_name}_catalog.tmp.npz").replace(OUT / f"{model_name}_catalog.npz")
    print(f"catalog model: {len(meta):,} films ({m.n_items:,} from ratings, "
          f"{len(new):,} placed by content)")


# --- Experiment: hide some films' ratings and place them from content only ---

def experiment(model_name="k64", split="val", lam=10.0, people_weight=1.0, cold_frac=0.2,
               newest=False, verbose=True):
    from .evaluate import load_users
    m, idx, df, Y = matched(model_name)
    rng = np.random.default_rng(0)
    if newest:  # the realistic case: the most recent films are the cold ones
        cold_mask = df.year.to_numpy() >= np.quantile(df.year.dropna(), 1 - cold_frac)
    else:
        cold_mask = rng.random(len(idx)) < cold_frac
    cm = ContentModel(lam, people_weight).fit(df[~cold_mask], Y[~cold_mask])
    pred = cm.predict(df[cold_mask])
    cold = idx[cold_mask]

    true_Q, true_b = m.X[cold, :-1].copy(), m.b[cold].copy()
    content_Q, content_b = pred[:, :-1], pred[:, -1]
    imdb_rating = df.rating.to_numpy()[cold_mask]
    cold_pos = {c: k for k, c in enumerate(cold)}

    stats = {k: [] for k in ["true", "content", "content_no_taste", "imdb_only"]}
    sq = {k: [0.0, 0] for k in stats}
    for uid, items, ratings in load_users(split):
        is_cold = np.array([i in cold_pos for i in items])
        if is_cold.sum() < 5:
            continue
        s = Session(m)
        s.answer_many(items[~is_cold].tolist(), [bucket_of(r) for r in ratings[~is_cold]])
        pos = np.array([cold_pos[i] for i in items[is_cold]])
        truth = ratings[is_cold]
        w, c = s.mean[:-1], s.mean[-1]
        preds = {
            "true": m.mu + true_b[pos] + true_Q[pos] @ w + c,
            "content": m.mu + content_b[pos] + content_Q[pos] @ w + c,
            "content_no_taste": m.mu + content_b[pos] + c,
            "imdb_only": imdb_rating[pos],
        }
        for k, p in preds.items():
            stats[k].append(_score(p, truth, rng))
            if k != "imdb_only":
                sq[k][0] += float(((p - truth) ** 2).sum())
                sq[k][1] += len(truth)

    rows = []
    for k, v in stats.items():
        d = pd.DataFrame(v).mean()
        rows.append(dict(placement=k, users=len(v), liked=d.liked, flop=d.flop, order=d.order,
                         rmse=np.sqrt(sq[k][0] / sq[k][1]) if sq[k][1] else np.nan))
    out = pd.DataFrame(rows)
    if verbose:
        print(f"cold films: {cold_mask.sum():,} of {len(idx):,} ({'newest' if newest else 'random'})")
        print(out.round(3).to_string(index=False))
    return out


def _score(pred, true, rng):
    top = true[np.lexsort((rng.random(len(pred)), -pred))[:5]]
    dt = true[:, None] - true[None, :]
    dp = pred[:, None] - pred[None, :]
    pairs = dt > 0
    order = np.mean((dp[pairs] > 0) + 0.5 * (dp[pairs] == 0)) if pairs.any() else np.nan
    return dict(liked=np.mean(top >= 4), flop=np.mean(top <= 2.5), order=order)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="k64")
    ap.add_argument("--experiment", action="store_true")
    ap.add_argument("--newest", action="store_true")
    ap.add_argument("--split", default="val")
    ap.add_argument("--lam", type=float, default=10.0)
    ap.add_argument("--people-weight", type=float, default=1.0)
    a = ap.parse_args()
    if a.experiment:
        experiment(a.model, a.split, a.lam, a.people_weight, newest=a.newest)
    else:
        build(a.model)
