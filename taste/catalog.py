"""Every film on IMDb, rebuilt from IMDb's public datasets (refreshed daily).

Source: https://developer.imdb.com/non-commercial-datasets/ (personal,
non-commercial use). Keeps every non-adult feature film that has at least one
IMDb rating, with its director(s), writers, top-billed cast, composer and
cinematographer.
"""
import subprocess

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pv

from .data import OUT, ROOT

IMDB = ROOT / "data" / "imdb"
BASE = "https://datasets.imdbws.com/"
FILES = ["title.ratings", "title.crew", "title.basics", "title.principals"]
WIKIDATA = "https://query.wikidata.org/sparql"
# Original language of every film Wikidata knows (CC0). IMDb scores run high for
# films with large home audiences, so the content model needs to know language.
LANG_QUERY = ('SELECT ?imdb ?lang WHERE { ?film wdt:P345 ?imdb ; wdt:P364 ?lang . '
              'FILTER(STRSTARTS(?imdb, "tt")) }')
LANG_SNAPSHOT = ROOT / "model" / "wikidata_lang.csv.gz"  # fallback if Wikidata is unreachable
TOP_CAST = 6
KEEP_ROLES = {"actor": "a", "actress": "a", "composer": "m", "cinematographer": "c"}


def download():
    """Fetch each file only if IMDb has a newer copy (curl -z)."""
    IMDB.mkdir(parents=True, exist_ok=True)
    for f in FILES:
        path = IMDB / f"{f}.tsv.gz"
        subprocess.run(["curl", "-sS", "--fail", "-z", str(path), "-o", str(path),
                        BASE + f"{f}.tsv.gz"], check=True)
    tmp = IMDB / "wikidata_lang.csv.tmp"
    got = subprocess.run(["curl", "-sS", "--fail", "--max-time", "120", "-G", WIKIDATA,
                          "--data-urlencode", f"query={LANG_QUERY}", "-H", "Accept: text/csv",
                          "-A", "movie-taste/0.1 (personal non-commercial recommender)", "-o", str(tmp)])
    if got.returncode == 0 and _full_lang_list(tmp):
        tmp.replace(IMDB / "wikidata_lang.csv")
    else:
        print("warning: Wikidata query failed or came back cut off; using the last saved language list")


def _full_lang_list(path):
    """When a query times out, Wikidata can still answer HTTP 200 with a cut-off list and
    an error message on the end, so check the answer parses and is about as long as the
    snapshot."""
    try:
        n = len(pd.read_csv(path, dtype=str))
    except ValueError:  # unparseable, empty or not text
        return False
    return n >= 0.9 * len(pd.read_csv(LANG_SNAPSHOT, dtype=str))


def _stream(name, columns, keep, types=None):
    """Read an IMDb TSV in blocks, keeping only rows where keep(table) is true."""
    reader = pv.open_csv(
        IMDB / f"{name}.tsv.gz",
        read_options=pv.ReadOptions(block_size=1 << 26),
        parse_options=pv.ParseOptions(delimiter="\t", quote_char=False),
        convert_options=pv.ConvertOptions(include_columns=columns, null_values=["\\N"],
                                          column_types=types or {}),
    )
    parts = []
    for batch in reader:
        t = pa.Table.from_batches([batch])
        t = t.filter(keep(t))
        if t.num_rows:
            parts.append(t)
    return pa.concat_tables(parts).to_pandas()


def build():
    films = _stream("title.basics", ["tconst", "titleType", "primaryTitle", "isAdult", "startYear",
                                     "runtimeMinutes", "genres"],
                    lambda t: pc.and_(pc.equal(t["titleType"], "movie"), pc.equal(t["isAdult"], "0")),
                    {"isAdult": pa.string(), "startYear": pa.int32(), "runtimeMinutes": pa.string()})
    films = films.drop(columns=["titleType", "isAdult"])
    ratings = _stream("title.ratings", ["tconst", "averageRating", "numVotes"], lambda t: pc.is_valid(t["tconst"]))
    films = films.merge(ratings, on="tconst")
    films["runtime"] = pd.to_numeric(films.pop("runtimeMinutes"), errors="coerce")
    films = films.rename(columns={"primaryTitle": "title", "startYear": "year",
                                  "averageRating": "rating", "numVotes": "votes"})
    tset = pa.array(films.tconst.to_numpy())
    in_films = lambda t: pc.is_in(t["tconst"], value_set=tset)  # noqa: E731

    crew = _stream("title.crew", ["tconst", "directors", "writers"], in_films).set_index("tconst")
    roles = pa.array(list(KEEP_ROLES))
    p = _stream("title.principals", ["tconst", "ordering", "nconst", "category"],
                lambda t: pc.and_(in_films(t), pc.is_in(t["category"], value_set=roles)))
    p = p[~p.category.isin(["actor", "actress"]) | (p.ordering <= TOP_CAST)]
    p["tok"] = p.category.map(KEEP_ROLES) + ":" + p.nconst
    p = p.groupby("tconst").tok.agg(" ".join)

    def toks(col, prefix):
        s = crew[col].reindex(films.tconst).fillna("")
        return s.map(lambda v: " ".join(f"{prefix}:{x}" for x in v.split(",") if x))

    films["people"] = (toks("directors", "d").to_numpy() + " " + toks("writers", "w").to_numpy()
                       + " " + p.reindex(films.tconst).fillna("").to_numpy())
    films["people"] = films.people.str.split().str.join(" ")
    films["imdbId"] = films.tconst.str[2:].astype(np.int64)
    fresh = IMDB / "wikidata_lang.csv"
    lang = pd.read_csv(fresh if fresh.exists() else LANG_SNAPSHOT, dtype=str).dropna(subset=["imdb", "lang"])
    lang["lang"] = lang.lang.str.rsplit("/", n=1).str[-1]
    films["langs"] = films.tconst.map(lang.drop_duplicates().groupby("imdb").lang.agg(" ".join)).fillna("")
    films = films.sort_values("votes", ascending=False).reset_index(drop=True)
    tmp = OUT / "catalog.tmp.parquet"
    films.to_parquet(tmp)
    tmp.replace(OUT / "catalog.parquet")
    print(f"catalog: {len(films):,} films with IMDb ratings "
          f"({(films.votes >= 1000).sum():,} with 1,000+ votes; newest year {films.year.max():.0f}; "
          f"language known for {(films.langs != '').mean():.0%}, "
          f"{(films.langs[films.votes >= 1000] != '').mean():.0%} of those with 1,000+ votes)")
    return films


if __name__ == "__main__":
    download()
    build()
