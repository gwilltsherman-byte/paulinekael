// Offline support and fast launches.
// - App files: fetched fresh when online (so updates show up on the next launch),
//   from the cache when offline.
// - data/meta.json: the same, and it names the current build.
// - Other data files are requested as name?v=<build>. That exact URL never changes, so
//   it's served from the cache once fetched, and older builds' copies are dropped.
const SHELL = "shell-v11";
const DATA = "data-v2";
const SHELL_FILES = ["./", "index.html", "app.css", "app.js", "engine.js", "importer.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "fonts/fraunces-latin.woff2", "fonts/fraunces-latin-ext.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function versioned(e, url) {
  const c = await caches.open(DATA);
  const hit = await c.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.ok) {
    await c.put(e.request, res.clone());
    e.waitUntil(c.keys().then((keys) => Promise.all(keys.filter((k) => {
      const u = new URL(k.url);
      return u.pathname === url.pathname && u.search !== url.search;
    }).map((k) => c.delete(k)))));
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/") && url.searchParams.has("v")) {
    e.respondWith(versioned(e, url));
    return;
  }
  const cache = url.pathname.includes("/data/") ? DATA : SHELL;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(cache).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
