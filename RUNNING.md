# Run Kael on Mac and iPhone

## GitHub Pages

The `site` branch contains the built browser app and its film data.
Pages is not enabled for this private repository. GitHub currently requires a
plan upgrade or a public repository to enable it. The local setup below works
without changing visibility or upgrading.

In repository Settings, Pages, choose Deploy from a branch, select `site`
and `/(root)`, then Save. Use the address shown after GitHub publishes it.
The expected project address is
`https://gwilltsherman-byte.github.io/paulinekael-clean/`.

This repository is private. Pages from private repositories requires a
supported GitHub plan. A Pages website can be public even when its source
repository is private; check the Pages settings before publishing. You can
use the local option below without changing repository visibility.

Open the published address in your Mac's browser or iPhone Safari.
On iPhone choose Share, Add to Home Screen, then Add. If offered, leave
Open as Web App enabled. Start rating films from that Home Screen icon.
Ratings are stored on the device. Use Settings, Backup and Restore to move
them between devices.

The Refresh films and publish app workflow refreshes `site` weekly and can
be run from Actions. It needs the existing model files; `TMDB_TOKEN` supplies
posters and streaming details. Without poster data, the app omits films
without posters. Add an empty `.nojekyll` file at the root of the `site` branch
before branch publishing so GitHub serves the built files directly.

The existing workflow pushes `site` using `GITHUB_TOKEN`. Those pushes do not
trigger a Pages build. For automatic weekly Pages publishing, extend that workflow
with GitHub's Pages artifact upload and deploy steps and select GitHub Actions
as the Pages source. The branch setup above is the simpler initial publication;
later automated refreshes need that workflow change. See [GitHub's Pages guide](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Run the built app locally on Mac

You do not need to retrain the recommender to use the published build:

```sh
git clone --single-branch --branch site https://github.com/gwilltsherman-byte/paulinekael-clean.git kael-site
cd kael-site
python3 -m http.server 8765 --bind 127.0.0.1
```

Authenticate to GitHub to clone this private repository. Open
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
