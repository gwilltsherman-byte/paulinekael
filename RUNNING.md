# Use Kael on Mac and iPhone

[Open Kael](https://gwilltsherman-byte.github.io/paulinekael/) in Safari. The app runs on GitHub Pages and works with
cellular data or any Wi-Fi. Your Mac does not need to stay on.

## Install the app

1. Open [Kael](https://gwilltsherman-byte.github.io/paulinekael/) in Safari.
2. **iPhone:** choose **Share > Add to Home Screen**, then **Add**.
   If offered, leave **Open as Web App** enabled.
3. **Mac with macOS Sonoma 14 or later:** choose **File > Add to Dock**, then **Add**.
4. Open the new app icon and rate at least three films to get recommendations.

After the app and catalogue load, saved recommendations can open offline.
Posters, trailers and streaming links may still need the internet.

## Saved ratings and backups

Ratings, your watchlist, diary and settings stay saved on this device when
you close and reopen Kael. They do not sync automatically between devices.
In **Settings > Backup**, save a backup before clearing app data or moving to
another device, then restore that file in the installed copy there.

If you used the former `kael-pages` app, save a backup from that copy before
switching installed apps. Open the new Kael app and restore the backup.

## One repository

The public `gwilltsherman-byte/paulinekael` repository contains the source on
`main`, the built app on `site`, and film lookup caches on `build-cache`.
GitHub Pages serves `site` from `/(root)`. A separate publishing repository
is not needed.

The **Refresh films and publish app** workflow updates the catalogue weekly
and can be run from Actions. It uses the existing model files; the optional
`TMDB_TOKEN` secret supplies posters and streaming details. New builds publish
to this repository's `site` branch using ordinary commits.

## Optional local development

You do not need a local server to use the hosted app. To inspect the built
copy locally:

```sh
git clone --single-branch --branch site https://github.com/gwilltsherman-byte/paulinekael.git kael-site
cd kael-site
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://localhost:8765`. Keep Terminal open while testing; Control-C stops
the server. This local copy has its own saved ratings.

## Build from source

The `main` branch's `web/` folder does not include exported film data. Serving
that folder alone is not enough. The workflow copies the trained files in
`model/` into `data/processed/`, refreshes the catalogue, restores poster
caches and runs `python -m taste.web --out site`. Use the existing `site`
branch for the simplest local setup.
