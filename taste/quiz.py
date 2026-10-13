"""The quiz engine: place a new person in taste space, one answer at a time.

A person is a vector w = [p, c] (taste + rating generosity). Before any answers
we only know the population distribution w ~ N(m, S). Each rated film is a noisy
linear observation  rating - mu - b_i = x_i . w + noise,  so the posterior stays
Gaussian and updates in closed form (Bayesian linear regression).

That gives two things for free:
  * uncertainty: how sure we are about every prediction
  * the value of a question: rating film i shrinks our uncertainty by
    0.5 * log(1 + x_i' S x_i / noise) nats, so we can ask the most useful one.
"""
import json

import numpy as np
import pandas as pd

from .data import OUT
from .seen import SeenModel

ANSWERS = ["disliked", "meh", "liked", "loved"]


def bucket_of(stars):
    """Map a 0.5-5 star rating to the quiz's answer buttons."""
    return ANSWERS[int(np.digitize(stars, [2.5, 3.5, 4.5]))]


class Model:
    def __init__(self, name="model", catalog=True):
        z = np.load(OUT / f"{name}.npz")
        self.mu = float(z["mu"])
        self.b = z["b"].astype(np.float64)
        Q = z["Q"].astype(np.float64)
        self.X = np.hstack([Q, np.ones((len(Q), 1))])
        self.prior_mean = z["prior_mean"].astype(np.float64)
        self.prior_cov = z["prior_cov"].astype(np.float64)
        self.sigma2 = float(z["sigma2"])
        self.value = dict(zip(ANSWERS, z["bucket_values"].astype(float)))
        self.popularity = z["popularity"].astype(np.float64)
        self.n_ratings = z["n_ratings"].astype(np.float64)
        self.entropy = z["entropy"].astype(np.float64)
        self.item_var = np.zeros(len(Q))
        self.n_items = len(Q)
        self._items = None
        # Full catalog: every IMDb film. MovieLens films keep their indices; the
        # rest were placed in taste space from their content (see content.py).
        cat = OUT / f"{name}_catalog.npz"
        if catalog and cat.exists():
            c = np.load(cat)
            self.X = np.hstack([c["Q"].astype(np.float64), np.ones((len(c["Q"]), 1))])
            self.b = c["b"].astype(np.float64)
            self.item_var = c["item_var"].astype(np.float64)
            self._items = pd.read_parquet(OUT / f"{name}_catalog.parquet")
        self.seen = SeenModel() if (OUT / "seen.npz").exists() else None
        # How much to trust the population prior vs. each answer (tuned on validation users).
        meta = OUT / f"{name}.json"
        meta = json.loads(meta.read_text()) if meta.exists() else {}
        self.prior_scale = meta.get("prior_scale", 1.0)
        self.noise_scale = meta.get("noise_scale", 1.0)
        # Optional: treat "haven't seen" as weak evidence you'd like it a bit less
        # than predicted (delta stars lower, with noise_scale x unseen_noise).
        self.unseen_delta = meta.get("unseen_delta")
        self.unseen_noise = meta.get("unseen_noise", 8.0)

    @property
    def items(self):
        if self._items is None:
            self._items = pd.read_parquet(OUT / "items.parquet")
        return self._items


class Session:
    def __init__(self, model, prior_scale=None, noise_scale=None):
        self.m = model
        prior_scale = model.prior_scale if prior_scale is None else prior_scale
        noise_scale = model.noise_scale if noise_scale is None else noise_scale
        self.noise = model.sigma2 * noise_scale
        self.cov = model.prior_cov * prior_scale
        self.h = np.linalg.solve(self.cov, model.prior_mean)
        self.mean = model.prior_mean.copy()
        self.answers = {}  # item -> answer label, or None for "haven't seen"

    def stars(self, label):
        """Answer button -> star value. Exact star ratings (floats) pass through."""
        return self.m.value[label] if isinstance(label, str) else float(label)

    def answer(self, item, label):
        """Record an answer: a button label, an exact star rating, or None (haven't seen)."""
        self.answers[item] = label
        x = self.m.X[item]
        if label is None:
            if self.m.unseen_delta is None:
                return
            t, noise = x @ self.mean - self.m.unseen_delta, self.noise * self.m.unseen_noise
        else:
            t, noise = self.stars(label) - self.m.mu - self.m.b[item], self.noise
        Sx = self.cov @ x
        self.cov -= np.outer(Sx, Sx) / (noise + x @ Sx)
        self.h += x * t / noise
        self.mean = self.cov @ self.h

    def answer_many(self, items, labels):
        """Batch version of answer() for rated films (e.g. an imported history)."""
        items = list(items)
        self.answers.update(zip(items, labels))
        X = self.m.X[items]
        t = np.array([self.stars(a) for a in labels]) - self.m.mu - self.m.b[items]
        prec = np.linalg.inv(self.cov) + X.T @ X / self.noise
        self.cov = np.linalg.inv(prec)
        self.h += X.T @ t / self.noise
        self.mean = self.cov @ self.h

    def predict(self, items=None):
        """Predicted star rating and its standard deviation for each film."""
        X = self.m.X if items is None else self.m.X[items]
        b = self.m.b if items is None else self.m.b[items]
        mean = self.m.mu + b + X @ self.mean
        v = self.m.item_var if items is None else self.m.item_var[items]
        sd = np.sqrt(((X @ self.cov) * X).sum(1) + v)
        return mean, sd

    def lift(self, items=None):
        """How much your answers raise each film above a typical person's prediction."""
        X = self.m.X if items is None else self.m.X[items]
        return X @ (self.mean - self.m.prior_mean)

    def info_gain(self, items):
        X = self.m.X[items]
        return 0.5 * np.log1p(((X @ self.cov) * X).sum(1) / self.noise)

    def explain(self, item, top=3):
        """Which films you liked pushed this film's prediction up the most.

        The personal part of a prediction is x_i' S (S0^-1 m0 + sum_j x_j t_j / noise),
        so each rated film j contributes exactly x_i' S x_j t_j / noise.
        """
        rated = [j for j, a in self.answers.items() if a is not None and self.stars(a) >= 3.5]
        if not rated:
            return []
        Xj = self.m.X[rated]
        t = np.array([self.stars(self.answers[j]) for j in rated]) - self.m.mu - self.m.b[rated]
        # Taste dimensions only: the last one is rating generosity, which lifts
        # every film equally and so explains nothing about this one.
        contrib = (Xj[:, :-1] @ (self.cov @ self.m.X[item])[:-1]) * t / self.noise
        order = np.argsort(-contrib)[:top]
        return [(rated[o], float(contrib[o])) for o in order if contrib[o] > 0]


# --- Question pickers -------------------------------------------------------
# Each takes a session and a candidate pool (item indices) and returns the next
# film to ask about.

def _unasked(session, pool):
    return np.array([i not in session.answers for i in pool])


def pick_popular(session, pool, rng=None):
    """Baseline: ask the most-rated films first."""
    return next(i for i in pool if i not in session.answers)


def pick_random(session, pool, rng):
    """Baseline: random well-known film."""
    free = pool[_unasked(session, pool)]
    return int(rng.choice(free))


def pick_pop_entropy(session, pool, rng=None):
    """Classic MovieLens heuristic (Rashid et al. 2002): log(popularity) x rating entropy."""
    score = np.log(session.m.n_ratings[pool]) * session.m.entropy[pool]
    score[~_unasked(session, pool)] = -np.inf
    return int(pool[np.argmax(score)])


def pick_info_gain(session, pool, rng=None):
    """Ours: expected information gain = P(seen) x information if rated."""
    score = session.m.popularity[pool] * session.info_gain(pool)
    score[~_unasked(session, pool)] = -np.inf
    return int(pool[np.argmax(score)])


def pick_info_gain_ps(session, pool, rng=None):
    """Info gain with personalised P(seen) (see seen.py)."""
    p = session.m.seen.prob(session.answers)[pool]
    score = p * session.info_gain(pool)
    score[~_unasked(session, pool)] = -np.inf
    return int(pool[np.argmax(score)])


def pick_targeted(session, pool, rng=None, n_cand=200):
    """Ask what best separates the films we're about to recommend.

    Candidates are the top films by optimistic score (mean + 1 sd). Rating film i
    cuts the total variance of the candidates' predictions by
    sum_c (x_c' S x_i)^2 / (noise + x_i' S x_i); weight that by P(seen).
    """
    m = session.m
    mean, sd = session.predict()
    ucb = mean + sd
    ucb[list(session.answers)] = -np.inf
    cand = np.argpartition(-ucb, n_cand)[:n_cand]
    SXp = session.cov @ m.X[pool].T
    cross = m.X[cand] @ SXp
    v = (m.X[pool] * SXp.T).sum(1)
    score = m.seen.prob(session.answers)[pool] * (cross ** 2).sum(0) / (session.noise + v)
    score[~_unasked(session, pool)] = -np.inf
    return int(pool[np.argmax(score)])


PICKERS = {
    "popular": pick_popular,
    "random": pick_random,
    "pop_entropy": pick_pop_entropy,
    "info_gain": pick_info_gain,
    "info_gain_ps": pick_info_gain_ps,
    "targeted": pick_targeted,
}
