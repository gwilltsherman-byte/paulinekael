# Kael

**[Open Kael](https://gwilltsherman-byte.github.io/paulinekael/)** · [Use on Mac or iPhone](RUNNING.md) · [Report a problem](https://github.com/gwilltsherman-byte/paulinekael/issues/new)

Kael is my movie recommender. Rate films you’ve seen to get suggestions that learn from your taste. Find something for tonight, keep a watchlist and record what you watch. Your ratings and lists stay on your device, with backups for moving to another browser or phone.

<img src="docs/screenshots/redesign-desktop.jpg" alt="Kael’s personal film recommendations, with film art and the reason behind each pick" width="100%">

## Start finding a film

1. Choose **Rate** and answer for films you’ve seen; skip the ones you haven’t.
2. Open **For you** for your picks, or **Tonight** for suggestions that fit your evening.
3. Save films to your watchlist, or log a viewing in your diary.

Named after Pauline Kael (1919–2001), the film critic. The source is on `main` and the published app is on `site`.

The product context and durable design rules are in [PRODUCT.md](PRODUCT.md) and
[DESIGN.md](DESIGN.md). See [the redesign verification record](docs/REDESIGN.md) for
preview instructions, exercised workflows, and remaining browser checks.

## Behind the recommendations

A movie recommender that asks you to rate films. Its model uses 30 million
MovieLens ratings to compare film preferences, updates your profile after each
answer, and chooses questions using estimated information gain.

The catalog holds every non-adult feature film with IMDb ratings (~347,000), and the
app ships the ~149,000 of them with 100 or more votes (`MIN_VOTES` in `taste/web.py`).
About 23,000 are placed from MovieLens ratings. The rest, including new releases, are
placed from their cast, crew, genre, language and IMDb score, refreshed from IMDb and
Wikidata every week.

## The app

`web/` is a responsive desktop and phone web app (installable from Safari: Share → Add to Home Screen)
with five tabs:

- **For you**: your top pick, then shelves: top picks, "Because you loved…", new
  releases, what's on your services, favourite genres, hidden gems, films for you and
  a friend, and more. **Tonight** asks your mood, how long you've got and who's
  watching, and gives three picks.
- **Rate**: the quiz, one poster card at a time: Not seen, Save (haven't seen it, want
  to: onto the Watchlist), Nope, OK, Liked, Loved (tap the card for the film's page);
  or the faster poster wall. The button at the top names your last answer (say
  "↶ Liked"): tap it to bring that film back and answer again. With a keyboard:
  `1` loved, `2` liked, `3` OK, `4` nope, `s` not seen, `w` save, `z` undo (the same
  numbers as the terminal quiz), and Enter on the card opens the film.
- **Search**: find any film (a title that is what you typed, or has each word starting a
  word, ranks above one that merely contains it, then the more famous the better;
  "wall-e" and "spiderman" work); with nothing typed, browse by mood (the Tonight
  moods), genre or decade, best for you first (most popular before you've rated 3
  films). Logic in `web/search.js`.
- **Library**: *Watchlist* (sorted by match, length or year, or only what's on your
  services), *Diary* (Seen it on a film page can log the date you watched it) and
  *Ratings* (filter by Loved / Liked / OK / Nope). Each film in Ratings shows the
  four choices with yours lit up: tap another to change it in one go (with Undo), or
  the lit one to remove it. In Search, tap the rating; on a film page, "You liked it".
- **Film pages** (tap any film): backdrop, summary and tagline, director and cast,
  your match and why, where to watch, trailer, Save / Seen it / Not for me, "More
  from <director>", "More like this" (nearest films in taste space, nudged toward
  ones you'd enjoy), and Share, whose link (`#f=<IMDb id>`) opens the film in the
  app. Summaries, cast and backdrops come from TMDB with the streaming data and load
  per film from `data/about/` (256 small files); directors from `data/directors.json`.
- **Your taste**: your taste scales; **your film life** (genres you watch most, films by
  decade with your best decade highlighted, directors you keep coming back to, films
  you loved); a shareable **taste card** image; watch together.
  **Settings** (the gear): streaming services; **import** from a Letterboxd export
  (.zip, including watched films, watchlist and diary dates) or an IMDb ratings
  export (.csv), keeping imported ratings' exact stars; **Backup**, which saves
  everything (ratings, watchlist, diary, friends, settings) to one
  `kael-backup-<date>.json` file (via the share sheet on phones, so it can go to
  Files), and **Restore**, which merges it with what's on the phone (ratings made
  there win) or replaces it. Everything else stays on the device, so this is how to
  move phones or reinstall the Home Screen app without losing anything.

Titles are set in [Fraunces](https://github.com/undercasetype/Fraunces) (SIL Open
Font License, `web/fonts/OFL.txt`).

**Quick start.** A new visitor needs only the question pool to begin: the pool is the
first 1,000 films in every data array, so `taste/quick.py` writes them as `quick.json`
(173 KB) and the app starts from that plus `seen.bin` (1 MB) instead of 16 MB. In a test
(120 ms latency, 10 Mbps) a new visitor sees the app after 1.0 s instead of 13 s. The rest
downloads while they rate (`Engine.upgrade` swaps it in; indices and answers stay valid);
Search and picks say "loading" until it arrives, and retry if the connection drops.
Returning users, and anyone arriving on a film link, load everything as before (from the
phone's cache). `taste/stamp.py` also puts `<link rel="preload">` tags for the quick files
into `index.html` at build time, and the streaming data waits until someone has 3 ratings.
`scripts/smoke.mjs` checks `quick.json` is exactly the first rows of the full files.

Data files are requested as `name?v=<build>` (the build is stamped in `meta.json`),
and the service worker (`web/sw.js`) keeps each one until a new build, so launches
after the first read them from the phone instead of the network.

All the maths runs on the phone (`web/engine.js`, checked against the Python
engine by `scripts/parity.mjs`), and everything you do is saved on the device. What is
read back from storage or from a backup file is validated first, so one bad entry can't
stop the app opening. Links between phones (`web/share.js`) are parsed the same way: a
cut-off or edited link is ignored with a message, never an error. A friend's link also
works when the app is already open.

**Accessibility.** The film page and sheets move focus into themselves, make the screen
behind them inert, close on Escape and return focus. Result titles and the Rate card are
reachable by keyboard, inputs have names, and animations stop under "reduce motion".
Browser zoom is supported. Dialogs contain keyboard focus, Library tabs support arrow
keys, and diary dates reject invalid or future viewings with a visible explanation.

**Browser security.** The page's Content-Security-Policy limits scripts to this
site, images to this site and TMDB, and trailers to YouTube's privacy-friendly
player. The service worker keeps versioned film data for offline use.

**Offline and weak signals.** The service worker answers from the copy kept on the phone
when offline, and when the network hasn't replied within 3.5 seconds (0.5 once one request
has timed out), while still saving the fresh files for the next launch.

**Posters** come from TMDB. Add a TMDB API Read Access Token as the `TMDB_TOKEN`
repository secret (`gh secret set TMDB_TOKEN`); the build then looks up posters
(`taste/posters.py`), 60,000 films per run, most-voted first, caching results in
the `build-cache` branch (gzipped, so the 50 MB of caches isn't served to visitors) so later runs only look up new films. Films TMDB had no poster
for are asked about again each run (5,000 a run), and a film's own TMDB page
(fetched with the streaming data) fills in any still missing. The app only ever
shows posters: each one stays invisible until it has downloaded, then fades in, and
films without one are left out of picks, rows and the quiz. On Rate, the next card
waits hidden behind the current one, so answering fades straight to its poster; a
card whose poster isn't ready yet is never shown. Without the secret there are no
posters at all.

**Publishing:** `.github/workflows/publish.yml` runs every Monday, on every
push to `main` that changes the app (not docs, `scripts/` or `results/`), and
when run by hand. It downloads the latest IMDb + Wikidata data, re-places every
film, builds the app into `site/`, and force-pushes that to the `site` branch.
Between the build and the push, `scripts/smoke.mjs` loads the built data through the
phone engine and runs a quiz on it (all files present and the right size, no NaN, enough
films; with a TMDB token, posters and streaming data too). If it fails the workflow stops
and the live site is left as it was. The built `site` branch can be published with GitHub Pages. `model/` holds
the trained MovieLens model files the build needs.

```bash
.venv/bin/python -m taste.web --out site     # build the app locally
.venv/bin/python -m http.server 8765 --directory site
```

## Tests

```bash
npm test                                                  # node --test: no install, no data download
python -m unittest discover -s tests -p 'test_*.py' -t .  # build helpers (stdlib only)
```

`tests/` covers the engine (the incremental update against a closed-form solve, question
picks against the full computation, `similar`), search ranking, share links (round trips,
`~` in names, malformed links), the Letterboxd and IMDb importer (including real `.zip`
files), and the invariants between the app's files that nothing else would notice: every
module is in the service worker's offline list, data is only fetched with `?v=`, the
policy allows what the app uses. `.github/workflows/ci.yml` runs them on every pull
request, plus a syntax check of the app and the Python.

## Terminal quiz

```bash
.venv/bin/python -m taste.play
```

Answer `1` loved, `2` liked, `3` meh, `4` disliked, `s` haven't seen,
`r` for recommendations, `q` to quit. You get two lists: **Best bets**
(highest predicted rating) and **Most your taste** (films your answers lift the
most above a typical person's prediction). ◆ marks films placed from content.
Options: `--min-year 2024`, `--min-votes 500` (allow less-known films; default
2,000 IMDb votes), `--recs 15`.

## Set up from scratch

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
scripts/download.sh                          # MovieLens 32M, ~240 MB
.venv/bin/python -m taste.data               # filter + hold out 7,000 people
.venv/bin/python -m taste.als --k 64 --name k64   # train the taste model (~12 min)
.venv/bin/python -m taste.seen               # "have you seen it?" model
.venv/bin/python -m taste.update             # IMDb + Wikidata catalog (~1.1 GB download)
```

## How it works

| File | What it does |
|---|---|
| `taste/data.py` | Keeps films with 20+ ratings; holds 2,000 validation and 5,000 test people out of training entirely |
| `taste/als.py` | Matrix factorisation: every film gets a taste vector and a general-appeal score |
| `taste/quiz.py` | Your profile is a probability distribution over the taste space that narrows with each answer (Bayesian linear regression). Question pickers live here |
| `taste/seen.py` | Estimates which films you've probably seen from your answers so far, so fewer questions are wasted |
| `taste/evaluate.py` | The accuracy simulator |
| `taste/catalog.py` | Every IMDb film with ratings, plus cast/crew (IMDb datasets) and original language (Wikidata) |
| `taste/content.py` | Places films without MovieLens ratings in taste space from their content; the held-out test for it |
| `taste/update.py` | Daily refresh: download, rebuild catalog, re-place every film |
| `taste/play.py` | Terminal quiz |
| `web/engine.js` | The quiz and predictions on the phone. Each question's uncertainty is kept up to date as you answer, rather than recomputed |
| `web/search.js`, `web/share.js`, `web/importer.js` | Title search, links between phones, Letterboxd and IMDb import |
| `scripts/smoke.mjs` | Checks a build before it is published |

**Picking the next question.** Rating film *i* shrinks uncertainty about you by
`0.5·log(1 + xᵢᵀΣxᵢ / σ²)`; the quiz asks the film with the highest
*P(you've seen it) × that gain*. Everyone starts from the same prior, so on its own
that would open with the same films for everybody. The app multiplies each score by
a per-device random `uᵢ²` (`Session.weights` in `web/engine.js`), which fades out
over your first 20 ratings. Two people's first poster walls then share about 2.5 of
12 films instead of all 12, and a wall teaches about 80% as much.

**"Because you liked…"** The personal part of each prediction splits exactly
into one contribution per film you rated, so the reasons shown are the films that
actually pushed that prediction up.

## How accuracy is measured

For each held-out person, 30% of their ratings are hidden. The quiz runs, and a
simulated person answers from their real ratings (or "haven't seen"). Then the hidden
films are ranked and scored:

- **liked / loved**: of the top 5 hidden films, the share they rated 4+ / 4.5+ stars
- **flop**: the share of the top 5 they rated 2.5 stars or less
- **order**: for two hidden films they rated differently, how often the one they preferred ranks higher

```bash
.venv/bin/python -m taste.evaluate --model k32 --split val --users 500 \
    --strategies popular,info_gain,info_gain_ps,targeted
.venv/bin/python -m taste.evaluate ... --by-rated   # checkpoint on films rated, not asked
.venv/bin/python scripts/tune_scales.py k32         # tune prior/noise trust
```

MovieLens only records films people chose to rate, so simulated people say
"haven't seen" far more often than real ones would. The numbers are therefore
pessimistic about how quickly the quiz learns.

## Results (5,000 held-out test people, `k64` model)

| After… | Top-5 liked (4★+) | Top-5 loved (4.5★+) | Top-5 flops (≤2.5★) | Right one of two |
|---|---|---|---|---|
| Random film they've seen | 56% | 28% | 15% | 50% |
| No quiz (acclaimed ranking) | 76% | 48% | 6.4% | 66.6% |
| 10 films rated | 79% | 51% | 5.0% | 68.4% |
| 20 films rated | 81% | 53% | 4.0% | 69.7% |
| 40 films rated | 82% | 55% | 3.6% | 71.0% |
| Full history (~161 ratings) | 85% | 58% | 2.5% | 73.4% |

Validation findings that shaped the final setup:
- 64 dimensions beat 32 slightly; regularisation 0.05 beat 0.025 and 0.1.
- Four answer buttons are as accurate as exact star ratings.
- Prior/noise trust: 1:1 was already the best ratio.
- Per film rated, smart question picking ≈ asking the most popular films. Its win is
  fewer wasted questions: 82 vs 141 questions to collect 20 ratings in simulation.

Full tables: `results/final_test_by_rated_summary.csv`, `results/final_test_by_asked_summary.csv`.

## Model experiments tried since (none adopted)

All on the 2,000 validation people with the app's 1,000-film question pool (`TASTE_QUESTION_POOL=1000`), top-5 liked after 20 films rated unless noted. Baseline `k64`: 79.3% liked, 4.3% flops.

| Change | Result |
|---|---|
| 96 dimensions (`--k 96`) | 79.3%: no gain (and 50% bigger data), same shape as 32 to 64 |
| 96 dimensions, `--lam 0.08` | Worse (residual noise 0.549 vs 0.430) |
| 128 dimensions | Not run: 96 gave nothing and it takes hours |
| Content blend for rarely-rated films (`accuracy_experiments.py B`, n0 10 to 100) | No effect (within 0.1 points) |
| "Haven't seen" as a weak hint (`accuracy_experiments.py A`, delta 1.0, noise x2) | +0.4 points at 20 rated on 5,000 held-out test people (95% interval +/-0.5), flops 4.8% to 4.7% |

The last one was **not adopted**. It moves absolute predictions down (every skip says "a star below prediction"), so the "% match" needs a much larger correction (`calibrate_match.py`: tau 0.70 to 1.24, shift +0.16 to +0.36) and the buckets stay miscalibrated, for a ranking gain inside the noise. Simulated people also skip far more films than real ones, so a calibration fitted here wouldn't carry over. The phone engine still supports it (`unseen_delta` and `unseen_noise` in the model json, off by default; `tests/engine.test.mjs`). With the same code and signal off, `calibrate_match.py` reproduces the shipped calibration (0.70 / +0.16).

Result files are in `results/` (`base_k64`, `k96`, `testA_off`, `testA_on`). Evaluating needs `OMP_NUM_THREADS=1` per worker, and about 16 GB is enough for 3 workers.

## Picks come from the combination of your ratings

Every prediction adds up the pull of all your ratings. With only a few ratings, one
loved film could still carry a pick on its own, so the app scores each pick without its
single biggest supporter (`maxPush` in `web/engine.js`), then spreads the list so one
cluster (say, twelve Marvel films) can't fill it. Explanations name the combination:
"Because you loved A and B, and didn't like C."

`scripts/combination_check.py` (500 test people; "Most your taste" top 20):

| Films rated | Picks mostly from one film: before → after | Top-5 liked: before → after |
|---|---|---|
| 8 | 38% → 13% | 80.6% → 80.3% |
| 20 | 4% → 1% | 81.6% → 81.4% |

## Films without MovieLens ratings (new releases and the long tail)

Tested by hiding the MovieLens ratings of films we do know, placing them from
content only, and ranking them for the 5,000 test people (`python -m taste.content --experiment [--newest] --split test`):

| Films held out | Placed from ratings | Placed from content | IMDb score only |
|---|---|---|---|
| Random 20% | 83% liked, 3.0% flops | 79% liked, 4.5% flops | 73.5% liked, 7.5% flops |
| Newest 20% | 76% liked, 5.4% flops | 72% liked, 7.0% flops | 68% liked, 9.7% flops |

IMDb scores are shrunk by vote count (a Bayesian average, like IMDb's Top 250),
and each language group gets its own trust in IMDb scores. Before this, films with a
9.9 from 4,000 votes, and South Asian films that IMDb rates far above how MovieLens
users rate them, topped every list.

## Limits

- Films placed from content carry about half the taste signal of rating-placed
  films, so their ranking leans more on IMDb score. "Most your taste" is the better
  list for new releases.
- Fan-driven franchise films (e.g. anime sequels) can rank high in "Best bets";
  the free data has no franchise information to correct for this.
- MovieLens and IMDb datasets are licensed for personal, non-commercial use only.
  Wikidata is CC0.
- Each weekly build downloads ~1.1 GB from IMDb (on GitHub's machines, not yours).
