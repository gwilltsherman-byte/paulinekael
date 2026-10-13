"""Write the Python engine's answers for a scripted session, for scripts/parity.mjs."""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from taste.quiz import Model, Session  # noqa: E402
from taste.web import MIN_VOTES  # noqa: E402

m = Model("k64")
it = m.items
keep = np.flatnonzero((it.source == "ratings").to_numpy() | (it.votes.to_numpy() >= MIN_VOTES))
answers = [("Mulholland Drive", 2001, "loved"), ("Transformers", 2007, "disliked"),
           ("Moonlight", 2016, "loved"), ("Avatar", 2009, "meh"), ("Forrest Gump", 1994, None),
           ("There Will Be Blood", 2007, "liked"), ("Titanic", 1997, None), ("Pulp Fiction", 1994, 4.5)]
s = Session(m)
imdb_answers = []
for t, y, a in answers:
    i = int(it.index[(it.title == t) & (it.year == y)][0])
    s.answer(i, a)
    imdb_answers.append([int(it.imdbId[i]), a])
mean, sd = s.predict(keep)
top = np.argsort(-mean)[:10]
from taste.quiz import pick_info_gain_ps  # noqa: E402
nxt = pick_info_gain_ps(s, np.arange(1000))
rated = [j for j, a in s.answers.items() if a is not None]
t = np.array([s.stars(s.answers[j]) for j in rated]) - m.mu - m.b[rated]
push = np.clip((m.X[keep[top]][:, :-1] @ (s.cov @ m.X[rated].T)[:-1]) * t / s.noise, 0, None).max(1)
json.dump({
    "top_push": [float(v) for v in push],
    "answers": imdb_answers,
    "top_imdb": [int(it.imdbId[keep[j]]) for j in top],
    "top_mean": [float(mean[j]) for j in top],
    "top_sd": [float(sd[j]) for j in top],
    "next_imdb": int(it.imdbId[nxt]),
    "explain_top1": [int(it.imdbId[j]) for j, _ in s.explain(int(keep[top[0]]), top=2)],
}, open("data/processed/parity_expected.json", "w"))
print("fixture written")
