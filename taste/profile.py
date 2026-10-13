"""The "Your taste" scales: the main directions in which people's tastes differ.

Found as the top eigenvectors of how people's predicted ratings co-vary across the
3,000 most-rated films (people vary most along these). Each is named from the films
at its two ends; an anchor film fixes which end is which, since eigenvector signs
are arbitrary. A person's position is their taste vector projected on the scale,
as a percentile of the population (from the model's prior).
"""
import numpy as np
import pandas as pd

from .data import OUT
from .quiz import Model

TOP = 3000
# (left label, right label, IMDb id of a film that must sit on the right end)
SCALES = [
    ("Popcorn", "Art-house", 74486),               # Eraserhead
    ("Crude & edgy", "Wholesome & romantic", 59742),  # The Sound of Music
    ("Fun adventure", "Tearjerker", 223897),       # Pay It Forward
    ("Epic & serious", "Camp & quirky", 120185),   # Spice World
]
EXAMPLES = 4


def scales(m=None):
    m = m or Model("k64", catalog=False)
    items = pd.read_parquet(OUT / "items.parquet")
    top = np.arange(TOP)
    Q, S = m.X[top, :-1], m.prior_cov[:-1, :-1]
    vals, vecs = np.linalg.eigh(Q @ S @ Q.T)
    out = []
    for (left, right, anchor), o in zip(SCALES, np.argsort(-vals)):
        v = vecs[:, o]
        a = np.flatnonzero(items.imdbId.to_numpy()[:TOP] == anchor)
        if len(a) and v[a[0]] < 0:
            v = -v
        d = Q.T @ v                                   # direction in taste space
        mean = float(d @ m.prior_mean[:-1])
        sd = float(np.sqrt(d @ S @ d))
        ends = {side: [int(items.imdbId[i]) for i in top[np.argsort(sign * v)[:EXAMPLES]]]
                for side, sign in (("left", 1), ("right", -1))}
        out.append({"left": left, "right": right, "d": np.round(d, 6).tolist(),
                    "mean": mean, "sd": sd, "left_films": ends["left"], "right_films": ends["right"]})
        titles = lambda ids: ", ".join(items.set_index("imdbId").title[ids].str.split(" \\(").str[0])  # noqa: E731
        print(f"scale {left} <-> {right}: {titles(ends['left'])}  |  {titles(ends['right'])}")
    return out


if __name__ == "__main__":
    scales()
