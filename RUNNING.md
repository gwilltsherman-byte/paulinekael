# Use Kael on Mac and iPhone

[Open Kael](https://gwilltsherman-byte.github.io/paulinekael/) in Safari. You can use it on an iPhone even while your Mac is off.

## Install the app

1. Open [Kael](https://gwilltsherman-byte.github.io/paulinekael/) in Safari.
2. **iPhone:** choose **Share > Add to Home Screen**, then **Add**.
   If offered, leave **Open as Web App** enabled.
3. **Mac with macOS Sonoma 14 or later:** choose **File > Add to Dock**, then **Add**.
4. Open the new app icon and rate at least three films to get recommendations.

After the app and catalogue load, saved recommendations can open offline.
Posters, trailers and streaming links may still need the internet.

## Shape your recommendations

Choose **Not seen** to move past a quiz card. Kael remembers the answer and can still recommend the film on Home or in Tonight. Use the separate Home skip control to put a recommendation aside.

When a lesser-known film scores close to the usual third pick, Kael can try it in that spot. **Settings > Home discoveries** shows how many displayed picks you watched and rated four stars or higher within 30 days, along with follow-up coverage. Diary entries and optional follow-up answers stay on your device.

In **Settings**, **Try the quiz comparison** assigns this device to the usual quiz or to questions chosen for their effect on the top three picks. The comparison starts after three ratings. Turn it off to return to the usual quiz.

## Saved ratings and backups

Ratings, favourites, your watchlist, diary and settings stay saved on this device when
you close and reopen Kael. They do not sync automatically between devices.
In **Settings > Backup**, save a backup before clearing app data or moving to
another device, then restore that file in the installed copy there.

If you have ratings saved in an older Kael installation, export a backup from that copy if it still opens. Restore the backup in the new app to bring those ratings across.

## One repository

The private `gwilltsherman-byte/paulinekael` repository contains the source on
`main`, the built app on `site`, and film lookup caches on `build-cache`.
GitHub Pages serves the built app when Pages is enabled for the repository.

The **Refresh films and publish app** workflow updates the catalogue weekly
and can be run from Actions. It uses the existing model files. An optional
`TMDB_TOKEN` secret supplies posters and streaming details. New builds publish
to this repository's `site` branch and deploy to Pages when enabled.

For the first deployment, select **GitHub Actions** under **Settings → Pages → Build and deployment → Source**. Then run **Refresh films and publish app** from the Actions tab on `main`.

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
