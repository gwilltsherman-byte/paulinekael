// Offline support and fast launches.
// - App files: fetched fresh when online (so updates show up on the next launch), from
//   the cache when offline, or when the network hasn't answered within SLOW ms (a weak
//   signal looks like a connection that never replies; the copy on the phone opens the
//   app at once, and the fresh one is kept for next time).
// - data/meta.json: the same, and it names the current build.
// - Other data files are requested as name?v=<build>. That exact URL never changes, so
//   it's served from the cache once fetched, and older builds' copies are dropped.
const PREFIX = "kael-";
const BASE = new URL("./", self.registration.scope);
const SHELL = PREFIX + "shell-v24";
const SLOW = 3500;
const SLOW_AFTER_SLOW = 500;   // once one request has timed out, the next ones don't wait as long
let slowUntil = 0;           // until when (ms since 1970) the network counts as unresponsive
const DATA = PREFIX + "data-v3";
const SHELL_FILES = ["install-persistence.js", "./", "index.html", "app.css", "app.js", "engine.js", "importer.js", "search.js", "share.js", "brand.js", "manifest.webmanifest",
  "brand/kael-wordmark.svg", "brand/kael-mark.svg",
  "icons/kael-192.png", "icons/kael-512.png", "icons/kael-apple-touch.png", "icons/kael-favicon.svg", "icons/kael-favicon.png",
  "fonts/fraunces-latin.woff2", "fonts/fraunces-latin-ext.woff2"];

self.addEventListener("install", (e) => {
  // A new worker must not seed its cache from the previous release's HTTP cache.
  const files = SHELL_FILES.map((file) => new Request(new URL(file, BASE), { cache: "reload" }));
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(files)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
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
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (url.pathname.includes("/data/") && url.searchParams.has("v")) {
    e.respondWith(versioned(e, url));
    return;
  }
  e.respondWith(networkFirst(e, url.pathname.includes("/data/") ? DATA : SHELL));
});

/** The network's answer (kept for later), or the kept copy if the network fails or is slow. */
function networkFirst(e, cacheName) {
  const req = e.request;
  // Revalidate the HTTP cache as well as updating our offline cache. Default fetch
  // can return old CSS/JS for minutes after Pages has published new HTML.
  const fresh = fetch(req, { cache: "no-cache" }).then((res) => {
    slowUntil = 0;
    if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(cacheName).then((c) => c.put(req, copy))); }
    return res;
  });
  e.waitUntil(fresh.catch(() => {}));   // keeps the worker alive to finish saving if we answered from the copy
  const kept = () => caches.open(cacheName).then(async (c) =>
    (await c.match(req)) || c.match(req, { ignoreSearch: true }));
  let timer;
  const wait = Date.now() < slowUntil ? SLOW_AFTER_SLOW : SLOW;
  const slow = new Promise((resolve) => { timer = setTimeout(resolve, wait); }).then(kept).then((hit) => {
    if (hit) slowUntil = Date.now() + 30000;
    return hit || fresh;
  });
  fresh.then(() => clearTimeout(timer), () => clearTimeout(timer));   // the network answered (or failed): no longer slow
  return Promise.race([fresh.catch(kept), slow]);
}

