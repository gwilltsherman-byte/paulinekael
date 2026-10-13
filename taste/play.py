"""Take the quiz in your terminal.

    .venv/bin/python -m taste.play

Answer each film with a number (or s = haven't seen). Type r for
recommendations at any point, q to quit.
"""
import argparse
import re

import numpy as np

from .quiz import Model, Session, pick_info_gain_ps

KEYS = {"1": "loved", "2": "liked", "3": "meh", "4": "disliked", "s": None}


def pretty(title):
    """'Matrix, The (1999)' -> 'The Matrix (1999)' (MovieLens-style titles)."""
    m = re.match(r"^(.*?), (The|A|An|Les|Le|La|L'|Il|Das|Der|Die|El)\s+(\(.*)$", title)
    return f"{m.group(2)} {m.group(1)} {m.group(3)}" if m else title


def label(items, i):
    row = items.iloc[i]
    if "source" not in items:  # model without the IMDb catalog
        return pretty(row.title)
    return f"{row.title} ({row.year})" if row.year is not None and row.year > 0 else row.title


def recommend(s, n, min_votes, min_year, min_stars=3.75):
    """Two lists: best bets (highest predicted rating) and most-your-taste (biggest
    lift over what a typical person would get, among films you'd still rate well)."""
    items = s.m.items
    mean, sd = s.predict()
    lift = s.lift()
    if "votes" in items:
        known = items.votes.to_numpy() >= min_votes
    else:
        known = items.n_ratings.to_numpy() >= 200
    ok = known & (items.year.fillna(0).to_numpy() >= min_year)
    ok[list(s.answers)] = False
    cand = np.flatnonzero(ok)
    best = cand[np.argsort(-mean[cand])][:n]
    good = cand[mean[cand] >= min_stars]
    taste = [i for i in good[np.argsort(-lift[good])] if i not in set(best)][:n]
    content = items.source.to_numpy() == "content" if "source" in items else np.zeros(len(items), bool)

    for title, order in [("Best bets", best), ("Most your taste", taste)]:
        print(f"\n  {title} (predicted stars ± uncertainty):\n")
        for rank, i in enumerate(order, 1):
            why = [label(items, j) for j, _ in s.explain(i, top=2)]
            because = f"   ← {', '.join(why)}" if why else ""
            mark = "◆" if content[i] else " "
            print(f"  {rank:2d}. {mark} {label(items, i):<55} {mean[i]:.1f} ± {sd[i]:.1f}{because}")
    if content[np.concatenate([best, taste]).astype(int)].any():
        print("\n  ◆ placed from cast, crew, genre and language (no MovieLens ratings yet), so less certain")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="k64")
    ap.add_argument("--recs", type=int, default=10, help="films per list")
    ap.add_argument("--min-votes", type=int, default=2000, help="IMDb votes; lower to see obscure films")
    ap.add_argument("--min-year", type=int, default=0)
    a = ap.parse_args()

    m = Model(a.model)
    s = Session(m)
    pool = np.arange(2000)
    rated = 0
    print(f"\n  {m.n_items:,} films.  1 loved   2 liked   3 meh   4 disliked   "
          "s haven't seen   r recommend   q quit\n")
    while True:
        i = pick_info_gain_ps(s, pool)
        ans = input(f"  [{rated} rated] {label(m.items, i)}  > ").strip().lower()
        if ans == "q":
            break
        if ans == "r":
            recommend(s, a.recs, a.min_votes, a.min_year)
            continue
        if ans not in KEYS:
            print("  (use 1-4, s, r or q)")
            continue
        s.answer(i, KEYS[ans])
        rated += KEYS[ans] is not None
        if rated and rated % 15 == 0 and KEYS[ans] is not None:
            recommend(s, a.recs, a.min_votes, a.min_year)
            print("  Keep going to sharpen these, or q to quit.\n")


if __name__ == "__main__":
    main()
