"""The "quick start" bundle: just the question pool, so a new visitor can start rating at once.

The question pool is the first `pool` films in every data array (see taste.web), which means
a visitor's first cards, the poster wall and the first answers only need the first `pool`
rows of films, vectors, bias and flags. quick.json holds those (about 200 KB, against about
16 MB for everything); the app starts from it and fetches the rest while the person rates.

Stdlib only, so tests/test_quick.py runs without the data-science packages.
"""
import base64


def quick_bundle(films, vectors, bias, flags, posters, pool, k):
    """films: the columns dict written to films.json; vectors: bytes of the int8 N x k
    matrix; bias: bytes of N float32; flags: bytes of N uint8; posters: list per film.
    Returns a JSON-able dict of the first `pool` rows."""
    n = len(films["imdb"])
    if not (len(vectors) == n * k and len(bias) == n * 4 and len(flags) == n and len(posters) == n):
        raise ValueError("film columns and binary files disagree about how many films there are")
    if not 0 < pool <= n:
        raise ValueError(f"pool of {pool} does not fit {n} films")
    b64 = lambda raw: base64.b64encode(raw).decode("ascii")  # noqa: E731
    return {
        "films": {col: values[:pool] for col, values in films.items()},
        "vec": b64(vectors[:pool * k]),
        "bias": b64(bias[:pool * 4]),
        "flags": b64(flags[:pool]),
        "posters": posters[:pool],
    }
