"""Biased matrix factorization trained with alternating least squares.

    rating(u, i) ~ mu + b_i + c_u + p_u . q_i

Every film gets a taste vector q_i and a bias b_i ("how much people like it in
general"); every training user gets p_u and c_u ("how generous a rater they
are"). Users are only needed to learn the film vectors; new people are placed
in the same space later by the quiz (see quiz.py).
"""
import argparse
import json
import time

import numpy as np
import scipy.sparse as sp

from .data import OUT

BYTES_BUDGET = 5e8  # max bytes for one dense block of Gram rows or outer products


def _half_step(M, F, reg, alpha):
    """Ridge-solve one side: for each row r, argmin_w sum_c (M_rc - F_c.w)^2 + reg*n_r^alpha*|w|^2.

    M: CSR (rows x cols) holding targets; F: (cols x d) features of the other side.
    The per-row Gram matrices sum_c F_c F_c^T are built with one sparse-dense
    product against the flattened outer products of F.
    """
    n, d = M.shape[0], F.shape[1]
    ind = M.copy()
    ind.data = np.ones_like(ind.data)
    B = np.asarray(M @ F)
    counts = np.diff(M.indptr).astype(np.float32)
    ridge = reg[None, :] * np.maximum(counts, 1)[:, None] ** alpha

    # Block over columns too, so the flattened outer products never exceed the
    # memory budget (with 64 dims and ~200k users they'd be 3+ GB at once).
    per = int(BYTES_BUDGET // (4 * d * d))
    csc = ind.tocsc()
    blocks = [(csc[:, c:c + per].tocsr(), c) for c in range(0, len(F), per)]

    W = np.empty((n, d), np.float32)
    idx = np.arange(d)
    for s in range(0, n, per):
        A = np.zeros((min(per, n - s), d * d), np.float32)
        for blk, c in blocks:
            Fc = F[c:c + per]
            A += blk[s:s + per] @ (Fc[:, :, None] * Fc[:, None, :]).reshape(len(Fc), d * d)
        A = A.reshape(-1, d, d)
        A[:, idx, idx] += ridge[s:s + per]
        W[s:s + per] = np.linalg.solve(A, B[s:s + per, :, None])[..., 0]
    return W


def train(k=32, lam=0.05, lam_bias=0.01, alpha=1.0, iters=12, seed=0, verbose=True):
    u = np.load(OUT / "train_u.npy")
    i = np.load(OUT / "train_i.npy")
    r = np.load(OUT / "train_r.npy")
    nu, ni = u.max() + 1, i.max() + 1
    mu = float(r.mean())
    R = sp.csr_matrix((r, (u, i)), shape=(nu, ni), dtype=np.float32)
    Rt = R.T.tocsr()
    reg = np.array([lam] * k + [lam_bias], np.float32)

    rng = np.random.default_rng(seed)
    Q = (rng.standard_normal((ni, k)) * 0.1).astype(np.float32)
    n_i = np.diff(Rt.indptr)
    b = ((np.asarray(Rt.sum(1)).ravel() - mu * n_i) / (n_i + 25)).astype(np.float32)

    ones_i = np.ones((ni, 1), np.float32)
    ones_u = np.ones((nu, 1), np.float32)
    for it in range(iters):
        t0 = time.time()
        M = R.copy()
        M.data = M.data - mu - b[M.indices]
        W = _half_step(M, np.hstack([Q, ones_i]), reg, alpha)
        P, c = W[:, :k], W[:, k]

        Mt = Rt.copy()
        Mt.data = Mt.data - mu - c[Mt.indices]
        V = _half_step(Mt, np.hstack([P, ones_u]), reg, alpha)
        Q, b = V[:, :k], V[:, k]

        if verbose:
            s = rng.choice(len(r), 2_000_000, replace=False)
            pred = mu + b[i[s]] + c[u[s]] + np.einsum("nk,nk->n", P[u[s]], Q[i[s]])
            rmse = float(np.sqrt(np.mean((pred - r[s]) ** 2)))
            print(f"  iter {it + 1:2d}  train RMSE {rmse:.4f}  ({time.time() - t0:.0f}s)", flush=True)

    # Residual noise on training data (used as the observation noise in the quiz).
    s = rng.choice(len(r), 2_000_000, replace=False)
    pred = mu + b[i[s]] + c[u[s]] + np.einsum("nk,nk->n", P[u[s]], Q[i[s]])
    sigma2 = float(np.mean((pred - r[s]) ** 2))

    # Quiz answers are coarse buckets; map each to the average star rating inside it.
    bucket = np.digitize(r, [2.5, 3.5, 4.5])  # 0 disliked, 1 meh, 2 liked, 3 loved
    bucket_values = np.bincount(bucket, weights=r) / np.bincount(bucket)
    # Per-film stats for question pickers: how many people rated it, and how
    # divided their ratings were (entropy over the 10 half-star values).
    hist = np.bincount(i * 10 + (r * 2 - 1).astype(np.int64), minlength=ni * 10).reshape(ni, 10)
    p = hist / hist.sum(1, keepdims=True)
    entropy = -(p * np.log2(np.where(p > 0, p, 1))).sum(1)
    return dict(mu=mu, Q=Q, b=b, P=P, c=c, sigma2=sigma2, bucket_values=bucket_values,
                popularity=n_i / nu, n_ratings=n_i, entropy=entropy,
                params=dict(k=k, lam=lam, lam_bias=lam_bias, alpha=alpha, iters=iters))


def save(model, name="model"):
    W = np.hstack([model["P"], model["c"][:, None]])
    np.savez(OUT / f"{name}.npz", mu=model["mu"], Q=model["Q"], b=model["b"],
             prior_mean=W.mean(0), prior_cov=np.cov(W, rowvar=False), sigma2=model["sigma2"],
             bucket_values=model["bucket_values"], popularity=model["popularity"],
             n_ratings=model["n_ratings"],
             entropy=model["entropy"])
    (OUT / f"{name}.json").write_text(json.dumps(model["params"] | {"sigma2": model["sigma2"]}, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=32)
    ap.add_argument("--lam", type=float, default=0.05)
    ap.add_argument("--lam-bias", type=float, default=0.01)
    ap.add_argument("--alpha", type=float, default=1.0)
    ap.add_argument("--iters", type=int, default=12)
    ap.add_argument("--name", default="model")
    a = ap.parse_args()
    m = train(a.k, a.lam, a.lam_bias, a.alpha, a.iters)
    save(m, a.name)
    print(f"saved data/processed/{a.name}.npz  (sigma^2 = {m['sigma2']:.4f})")
