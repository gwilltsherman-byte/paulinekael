"""Daily refresh: pull the latest IMDb + Wikidata data and re-place every film.

    .venv/bin/python -m taste.update

New releases enter the catalog as soon as they have IMDb ratings, and every
film's IMDb score and vote count are brought up to date. Scheduled daily by
scripts/install_daily_update.sh.
"""
import time
from datetime import datetime

from . import catalog, content


def main(model="k64"):
    t0 = time.time()
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] updating", flush=True)
    catalog.download()
    catalog.build()
    content.build(model)
    print(f"[{datetime.now():%Y-%m-%d %H:%M}] done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
