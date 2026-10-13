"""Sanity check: recommendations for a few scripted tastes.

    .venv/bin/python scripts/personas.py [--min-year 2024] [--min-votes 2000]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from taste.play import recommend  # noqa: E402
from taste.quiz import Model, Session  # noqa: E402

PERSONAS = {
    "art-house": [("Mulholland Drive", 2001, "loved"), ("In the Mood for Love", 2000, "loved"),
                  ("There Will Be Blood", 2007, "loved"), ("Moonlight", 2016, "loved"),
                  ("Lost in Translation", 2003, "liked"), ("Transformers", 2007, "disliked"),
                  ("The Fast and the Furious", 2001, "disliked"), ("Twilight", 2008, "disliked"),
                  ("Avatar", 2009, "meh")],
    "blockbuster": [("Avengers: Endgame", 2019, "loved"), ("Top Gun: Maverick", 2022, "loved"),
                    ("Fast Five", 2011, "loved"), ("Jurassic World", 2015, "liked"),
                    ("The Dark Knight", 2008, "loved"), ("Mulholland Drive", 2001, "disliked"),
                    ("The Tree of Life", 2011, "disliked"), ("Lost in Translation", 2003, "meh")],
    "horror": [("Hereditary", 2018, "loved"), ("The Witch", 2015, "loved"), ("Get Out", 2017, "loved"),
               ("It Follows", 2014, "liked"), ("The Notebook", 2004, "disliked"),
               ("Mamma Mia!", 2008, "disliked")],
}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-year", type=int, default=2024)
    ap.add_argument("--min-votes", type=int, default=2000)
    ap.add_argument("--n", type=int, default=10)
    a = ap.parse_args()
    m = Model("k64")
    it = m.items
    for name, answers in PERSONAS.items():
        s = Session(m)
        for title, year, ans in answers:
            s.answer(int(it.index[(it.title == title) & (it.year == year)][0]), ans)
        print(f"===== {name}, films from {a.min_year} on")
        recommend(s, a.n, a.min_votes, a.min_year)
