# Run Kael on Mac and iPhone

## GitHub Pages

Open [Kael](https://gwilltsherman-byte.github.io/kael-pages/) in your Mac's
browser or iPhone Safari. On iPhone choose Share, Add to Home Screen, then Add.
If offered, leave Open as Web App enabled. Start rating films from that icon.
Ratings are stored on the device. Use Settings, Backup and Restore to move
them between devices.

The public `gwilltsherman-byte/kael-pages` repository contains only the built
app and its film data. This source repository remains private. Free Pages
hosting uses the public repository's `site` branch and `/(root)`.

The Refresh films and publish app workflow refreshes this private repository's
`site` branch weekly and can be run from Actions. It needs the existing model
files; `TMDB_TOKEN` supplies posters and streaming details. Updates to the
private built branch do not automatically update the public repository.
To publish a refreshed build, copy only the contents of that branch into
`kael-pages`'s `site` branch and commit there. Do not copy the private source,
other branches, credentials, or personal rating backups.

## Run the built app locally on Mac

You do not need to retrain the recommender to use the published build:

```sh
git clone --single-branch --branch site https://github.com/gwilltsherman-byte/kael-pages.git kael-site
cd kael-site
python3 -m http.server 8765 --bind 127.0.0.1
```

Open
`http://localhost:8765`. Keep Terminal open; Control-C stops the server.

For your iPhone, stop the server and run:

```sh
python3 -m http.server 8765 --bind 0.0.0.0
```

Connect both devices to the same Wi-Fi. Find the Mac's IP address in System
Settings, Wi-Fi, Details, TCP/IP, then open `http://MAC_IP:8765` in Safari.
The Mac must stay awake. Use HTTPS on GitHub Pages for offline installation.

## Build from source

The main branch's `web/` folder is source and does not include exported film
data. Serving that folder alone is not enough. The workflow copies the trained
files in `model/` into `data/processed/`, refreshes the catalog, restores
poster caches and runs `python -m taste.web --out site`. Use the existing
`site` branch for the simplest local setup.
