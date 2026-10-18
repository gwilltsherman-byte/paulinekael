import { buildOf, loadEngine, loadMeta, loadQuick, loadRest, phi, Session } from "./engine.js";
import { readImport } from "./importer.js";
import { Titles } from "./search.js";
import { decodeTaste, parseTasteLink, tasteLink } from "./share.js";
import { BRAND, drawWordmark } from "./brand.js";

const $ = (id) => document.getElementById(id);
const K = {
  answers: "mt.answers.v1",  // [[imdbId, label | stars | null], ...] oldest first
  hidden: "mt.hidden.v1",    // [imdbId, ...] "not for me"
  watch: "mt.watch.v1",      // [imdbId, ...] newest first
  seen: "mt.seen.v1",        // [imdbId, ...] watched but not rated (imported)
  friends: "mt.friends.v1",  // [{id, name, rated, code, added}, ...] shared tastes
  queue: "mt.queue.v1",      // [imdbId, ...] poster-wall films still to rate
  diary: "mt.diary.v1",      // [[imdbId, "YYYY-MM-DD", label], ...] films you logged watching
  prefs: "mt.prefs.v1",
};
const LABELS = { loved: "Loved it", liked: "Liked it", meh: "It was OK", disliked: "Didn't like it" };
const SHORT = { loved: "Loved", liked: "Liked", meh: "OK", disliked: "Nope" };
const COLORS = { loved: "var(--love)", liked: "var(--like)", meh: "var(--meh)", disliked: "var(--nope)" };
const YOURS = { loved: "You loved it", liked: "You liked it", meh: "You thought it was OK", disliked: "You didn't like it" };
const SCALE = ["disliked", "meh", "liked", "loved"];   // worst to best, as on the Rate screen
// Keyboard answers on Rate, numbered as in the terminal quiz (taste.play).
const RATE_KEYS = Object.assign(Object.create(null), { 1: "loved", 2: "liked", 3: "meh", 4: "disliked", s: "skip", w: "save" });
const RICON = {
  disliked: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  meh: `<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>`,
  liked: `<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7.2 4.5 4.5 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/></svg>`,
  loved: `<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>`,
};
const IMG = "https://image.tmdb.org/t/p/";
const GOAL = 20;        // ratings for sharp recommendations
const WALL = 12;        // films per poster wall
// "Best bets" ranks by a cautious score: predicted stars minus uncertainty. Films
// with small audiences get extra uncertainty, because their average rating comes
// mostly from devoted fans. Content-placed films get more still.
const AUDIENCE_VAR = 0.5;
const AUDIENCE_VOTES = 50000;
const ESTIMATED_VAR = 0.2;
// Variety: each pick is penalised by how alike it is (in taste) to picks above it.
const VARIETY = 0.3;
const VARIED = 60;
// Home shelves need at least this many films to show, and show at most SHELF_LEN.
const SHELF_MIN = 4;
const SHELF_LEN = 14;
// Genres that make a good "___ for you" shelf.
const SHELF_GENRES = ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family",
  "Fantasy", "Film-Noir", "Horror", "Musical", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western"];
// "Tonight" moods: genres to include or leave out, and/or an end of a taste scale
// (meta.scales), keeping films in the share (frac, default a quarter) of well-known
// films furthest toward it.
const MOODS = [
  { id: "any", label: "Surprise me" },
  { id: "laugh", label: "Make me laugh", genres: ["Comedy"] },
  { id: "feel", label: "Feel-good", end: "Wholesome & romantic", genres: ["Comedy", "Family", "Romance", "Animation", "Musical", "Music"],
    not: ["Horror", "Thriller", "War", "Crime", "Biography"] },
  { id: "edge", label: "Edge of my seat", genres: ["Thriller", "Crime", "Mystery"] },
  { id: "scare", label: "Scare me", genres: ["Horror"] },
  { id: "cry", label: "A good cry", end: "Tearjerker", genres: ["Drama", "Romance"], not: ["Horror", "Thriller", "Crime", "Sci-Fi", "Mystery"] },
  { id: "mind", label: "Mind-bending", genres: ["Sci-Fi", "Mystery"], not: ["Comedy", "Animation", "Family"] },
  { id: "epic", label: "Something epic", end: "Epic & serious", genres: ["Action", "Adventure", "War", "Western", "History"], not: ["Comedy", "Animation"] },
  { id: "art", label: "Something artsy", end: "Art-house", frac: 0.1 },
  { id: "real", label: "True stories", genres: ["Documentary", "Biography"] },
];
const TIMES = [[0, "Any length"], [100, "Under 1h 40m"], [120, "Under 2 hours"], [150, "Under 2h 30m"]];

let saveWarned = false;
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch {
      // Storage is full or blocked (private browsing): say so once, rather than let
      // someone rate films that will be gone next time.
      if (!saveWarned) {
        saveWarned = true;
        toast("Couldn't save on this device, so your changes may be lost. Save a backup in Settings.");
      }
      return false;
    }
  },
};

// Everything read back from storage (or from a backup file) is checked first, so one bad
// entry can't stop the app opening.
const isId = (x) => Number.isInteger(x) && x > 0;
const isDay = (x) => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T12:00:00`);
  return Number.isFinite(d.getTime()) && d.getFullYear() === Number(x.slice(0, 4))
    && d.getMonth() + 1 === Number(x.slice(5, 7)) && d.getDate() === Number(x.slice(8, 10));
};
const isAnswer = (a) => a === null || (typeof a === "string" && Object.hasOwn(LABELS, a))
  || (typeof a === "number" && a >= 0.5 && a <= 5);
const asList = (v) => (Array.isArray(v) ? v : []);
const clean = {
  ids: (v) => asList(v).filter(isId),
  answers: (v) => asList(v).filter((e) => Array.isArray(e) && isId(e[0]) && isAnswer(e[1] ?? null)).map(([id, a]) => [id, a ?? null]),
  diary: (v) => asList(v).filter((e) => Array.isArray(e) && isId(e[0]) && isDay(e[1]) && isAnswer(e[2] ?? null)).map(([id, d, a]) => [id, d, a ?? null]),
  friends: (v) => asList(v).filter((f) => f && typeof f === "object" && typeof f.id === "string" && typeof f.name === "string"
    && typeof f.code === "string" && /^[A-Za-z0-9_-]+$/.test(f.code)).map((f) => ({ ...f, rated: Number(f.rated) || 0 })),
  prefs: (v) => {
    const p = v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {};
    p.services = asList(p.services).filter(isId);
    if (typeof p.name !== "string") p.name = "";
    if (p.seed != null && !Number.isInteger(p.seed)) p.seed = null;
    return p;
  },
};

let E, S;
let fullReady = true;   // false while a new visitor has only the question pool (see start); Search and picks wait for the rest
let posters = [];
let extras = { providers: {}, films: {} };
// Streaming services: TMDB lists plan variants and channels separately ("Netflix
// Standard with Ads", "AMC+ Amazon Channel"), so they're grouped into one service.
let services = new Map();       // service name -> {name, logo, ids: [provider ids], films}
let serviceOf = new Map();      // provider id -> service name
const MAJOR = ["Netflix", "Amazon Prime Video", "HBO Max", "Hulu", "Disney Plus", "Apple TV", "Peacock",
  "Paramount Plus", "Starz", "MGM Plus", "AMC+", "Criterion Channel", "MUBI", "Shudder", "Tubi TV", "Pluto TV",
  "The Roku Channel", "Kanopy", "Hoopla", "Plex", "Crunchyroll", "BritBox", "fuboTV", "Philo"];

function serviceName(name) {
  const n = name.replace(/\s+(Standard |Basic |Free )?with Ads$/i, "")
    .replace(/\s+(Amazon|Apple TV|Roku Premium) Channel$/i, "")
    .replace(/\s+(Premium Plus|Premium|Essential)$/i, "").trim();
  if (/^max$/i.test(n)) return "HBO Max";
  if (/^peacock/i.test(n)) return "Peacock";
  if (/^paramount\+/i.test(n)) return "Paramount Plus";
  if (/^plex/i.test(n)) return "Plex";
  if (/^mgm(\+| plus)/i.test(n)) return "MGM Plus";
  return n;
}

function buildServices() {
  services = new Map(); serviceOf = new Map();
  const count = new Map();
  for (const v of Object.values(extras.films)) for (const p of v[1]) count.set(p, (count.get(p) || 0) + 1);
  for (const [id, [name, logo]] of Object.entries(extras.providers)) {
    const key = serviceName(name), pid = Number(id);
    const g = services.get(key) || { name: key, logo, ids: [], films: 0 };
    if (name === key) g.logo = logo;
    g.ids.push(pid); g.films += count.get(pid) || 0;
    services.set(key, g); serviceOf.set(pid, key);
  }
}

const serviceRank = (key) => {
  const m = MAJOR.indexOf(key);
  return m >= 0 ? m : MAJOR.length + 1 / (1 + (services.get(key)?.films || 0));
};
const myServices = () => new Set(prefs.services.map((p) => serviceOf.get(p)).filter(Boolean));
/** The streaming services carrying film i, yours first, then majors. */
function servicesOf(i) {
  const mine = myServices();
  const keys = [...new Set(providersOf(i).map((p) => serviceOf.get(p)).filter(Boolean))];
  return keys.sort((a, b) => (mine.has(b) - mine.has(a)) || serviceRank(a) - serviceRank(b));
}
let answers = clean.answers(store.get(K.answers, []));
let hidden = new Set(clean.ids(store.get(K.hidden, [])));
let watch = clean.ids(store.get(K.watch, []));
let seenOnly = new Set(clean.ids(store.get(K.seen, [])));
let friends = clean.friends(store.get(K.friends, []));
let diary = clean.diary(store.get(K.diary, []));
let prefs = {
  list: "best", era: "any", genre: -1, deep: false, maxRuntime: 0, streamOnly: false,
  services: [], friend: null, name: "", onboarded: false,
  seed: null,  // varies which films the quiz opens with (Session.weights)
  ...clean.prefs(store.get(K.prefs, {})),
};
const newSeed = () => (Math.random() * 2 ** 32) | 0;
let view = "rate";
let rateQueue = [];     // films picked on the poster wall, rated next (saved as IMDb ids)
let rateStack = [];     // the Rate cards on screen, front first: the one behind is asked next
let wallItems = [], wallSel = new Set();
let homeDirty = true, home = null;   // Home's shelves; rebuilt when ratings change
let homeShown = null;                // the Home on screen: not drawn again unless it changed
let dataV = "";                      // the data build (see buildOf in engine.js)
const markDirty = () => { homeDirty = true; scheduleHome(); };
let homeTimer = 0;
/** Rebuild Home in a quiet moment after a change, so it's ready when you go back to it. */
function scheduleHome() {
  clearTimeout(homeTimer);
  homeTimer = setTimeout(() => {
    if (homeDirty && E && fullReady && S.rated >= 3 && view !== "home") { home = buildHome(); homeDirty = false; }
  }, 1500);
}
let titles = null, mineShown = 30, diaryShown = 12;   // titles: the Search index (search.js)

// ---------------------------------------------------------------- helpers

const idx = (imdb) => E.byImdb.get(imdb);
const imdbOf = (i) => E.films.imdb[i];
const title = (i) => E.films.title[i] || "Untitled";
const year = (i) => (E.films.year[i] > 0 ? E.films.year[i] : "");   // 0 or less: year unknown
const imdbUrl = (i) => `https://www.imdb.com/title/tt${String(imdbOf(i)).padStart(7, "0")}/`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
const savePrefs = () => store.set(K.prefs, prefs);

function labelOf(a) {
  if (typeof a !== "number") return a;
  return a >= 4.5 ? "loved" : a >= 3.5 ? "liked" : a >= 2.5 ? "meh" : "disliked";
}

function genres(i, max = 3) {
  const m = E.films.genres[i], out = [];
  E.meta.genres.forEach((g, b) => { if (m & (1 << b)) out.push(g); });
  return out.slice(0, max);
}

const ext = (i) => extras.films[i];
const runtime = (i) => ext(i)?.[3] || 0;
const trailer = (i) => ext(i)?.[0] || "";
const providersOf = (i) => ext(i)?.[1] || [];
const hm = (min) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : "");

function subline(i, withScore = false) {
  const parts = [year(i), genres(i, 2).join(" · "), hm(runtime(i))];
  const sc = E.films.score[i];
  if (withScore && sc) parts.push(`IMDb ${(sc / 10).toFixed(1)}`);
  return parts.filter(Boolean).join(" · ");
}

const posterUrl = (i, size) => (posters[i] ? `${IMG}${size}/${posters[i]}` : "");
const gotPosters = new Set();   // poster images already downloaded: drawn again straight away
const early = [];               // posters fetched before they're on screen (see preload)
const noArt = new Set();        // films with no poster (or one that won't download): not shown in picks or asked

/** A poster: TMDB's image, and nothing else. It stays invisible until it has downloaded
 *  and decoded, then fades in (see watchPosters). eager: on screen straight away. */
function poster(i, size, cls = "", eager = false) {
  const url = posterUrl(i, size);
  const state = !url ? " noimg" : gotPosters.has(url) ? "" : " pending";
  return `<div class="poster ${cls}${state}">`
    + (url ? `<img src="${url}" alt=""${eager ? "" : ' loading="lazy"'}>` : "") + "</div>";
}

/** Download film i's poster now (and its thumbnail), before it's on screen. */
function preload(i, size = "w780") {
  for (const url of [posterUrl(i, size), size === "w780" && posterUrl(i, "w92")]) {
    if (!url || gotPosters.has(url)) continue;
    const im = new Image();
    im.onload = () => gotPosters.add(url);
    im.src = url;
    early.push(im);
  }
  early.splice(0, early.length - 8);
}

/** Poster images: once one has downloaded and decoded it fades in. A failed download
 *  is tried once more a moment later; if that fails too, a tile in a row is taken out
 *  and anything else stays empty. The film page's blurred poster fades in the same way. */
function watchPosters() {
  document.addEventListener("load", (ev) => {
    const img = ev.target;
    if (img.classList?.contains("film-blur")) return img.classList.add("in");
    if (img.tagName !== "IMG" || !img.parentElement?.classList.contains("poster")) return;
    gotPosters.add(img.src.split("?")[0]);
    const done = () => img.parentElement?.classList.remove("pending");
    if (img.decode) img.decode().then(done, done);
    else done();
  }, true);
  document.addEventListener("error", (ev) => {
    const img = ev.target;
    if (img.tagName !== "IMG" || !img.parentElement?.classList.contains("poster")) return;
    if (!img.dataset.retried) {
      img.dataset.retried = "1";
      setTimeout(() => { img.src = `${img.src.split("?")[0]}?retry=1`; }, 1500);
    } else {
      const box = img.parentElement, i = Number(box.closest("[data-i]")?.dataset.i);
      if (i >= 0 && navigator.onLine) noArt.add(i);   // offline, every poster fails: keep them
      box.classList.replace("pending", "noimg");
      img.remove();
      box.closest(".stile")?.remove();
    }
  }, true);
}

function setBackdrop(i) {
  const url = i >= 0 && posterUrl(i, "w92");
  $("backdrop").style.setProperty("--bd", url ? `url("${url}")` : "none");
}

function badges(i) {
  return (year(i) >= new Date().getFullYear() - 1 ? `<span class="badge new">New</span>` : "")
    + (E.flags[i] ? `<span class="badge">Rough guess</span>` : "");
}

function matchPill(p, inline = false, label = "match") {
  const color = p >= 0.8 ? "var(--like)" : p >= 0.6 ? "var(--accent)" : "var(--meh)";
  return `<div class="match${inline ? " inline" : ""}" style="--mc:${color}"><strong>${Math.round(p * 100)}%</strong><small>${label}</small></div>`;
}

/** Streaming-service logos for film i (yours first), or a note. */
function logos(i, max = 4) {
  const keys = servicesOf(i), mine = myServices();
  if (!keys.length) return ext(i)?.[2] ? `<div class="logos"><span class="note">Rent or buy</span></div>` : "";
  const shown = keys.slice(0, max).map((k) => {
    const g = services.get(k);
    return `<img src="${IMG}w92${g.logo}" alt="${esc(g.name)}" title="${esc(g.name)}"${mine.has(k) ? ' class="mine"' : ""}>`;
  }).join("");
  return `<div class="logos">${shown}${keys.length > max ? `<span class="more">+${keys.length - max}</span>` : ""}</div>`;
}

function rebuild() {
  const list = answers.map(([id, a]) => [idx(id), a]).filter(([i]) => i !== undefined);
  S = new Session(E, list, [...seenOnly].map(idx).filter((i) => i !== undefined), prefs.seed);
}

let persistAsked = false;
function saveAll() {
  if (!persistAsked && answers.length) {
    // Ask the browser not to clear this site's data when space runs low (or, in Safari,
    // after a week unused). It decides; a Home Screen app is much safer either way.
    persistAsked = true;
    Promise.resolve(navigator.storage?.persist?.()).catch(() => {});
  }
  store.set(K.answers, answers);
  store.set(K.hidden, [...hidden]);
  store.set(K.watch, watch);
  store.set(K.seen, [...seenOnly]);
  markDirty();
  renderWatchCount();
}

/** Record (or change, or clear with label undefined) the answer for film i. A changed
 *  rating keeps its place in the list; anything else goes to the end, as the latest. */
function setAnswer(i, label) {
  const id = imdbOf(i);
  const existed = answers.findIndex(([x]) => x === id);
  if (existed >= 0 && label != null && answers[existed][1] != null) answers[existed] = [id, label];
  else {
    if (existed >= 0) answers.splice(existed, 1);
    if (label !== undefined) answers.push([id, label]);
  }
  if (label != null) {
    watch = watch.filter((x) => x !== id);
    seenOnly.delete(id);
  }
  saveAll();
  if (existed >= 0 || label === undefined) rebuild();
  else S.answer(i, label);
}

function toggleWatch(i) {
  const id = imdbOf(i);
  watch = watch.includes(id) ? watch.filter((x) => x !== id) : [id, ...watch];
  saveAll();
  return watch.includes(id);
}

let toastTimer;
function toast(msg, undo) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? "<button>Undo</button>" : ""}`;
  t.hidden = false;
  t.classList.toggle("high", view === "rate" || view === "wall");
  if (undo) t.querySelector("button").onclick = () => { t.hidden = true; undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3400);
}

// ---------------------------------------------------------------- sheets

const CLOSE = `<button class="sheet-close" data-x="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;

/** While the film page or a sheet is open, the screen behind it can't be reached by
 *  keyboard or screen reader (and a sheet over the film page makes the film inert too). */
function setInert() {
  const sheet = !$("sheet").hidden, film = !$("film").hidden;
  document.querySelectorAll("#app > .view, #app > .tabbar, .masthead").forEach((el) => { el.inert = sheet || film; });
  $("film").inert = sheet;
}

let dismissSheet = null;   // closes the open sheet, if there is one

/** Keep the same control focused when a selected state redraws its group. When the
 *  next step has different controls, focus its container so keyboard users start there. */
function replaceContent(el, html) {
  const active = document.activeElement, hadFocus = el.contains(active);
  const owner = hadFocus && active.closest("[data-i]");
  const ownerId = owner && el.contains(owner) ? owner.dataset.i : null;
  const key = hadFocus && ["id", "data-x", "data-i", "data-set", "data-rf", "data-change", "data-unlog"]
    .find((attr) => active.hasAttribute(attr));
  const value = key && active.getAttribute(key);
  el.innerHTML = html;
  if (el.id === "sheet-card") el.setAttribute("aria-label", el.querySelector("h3")?.textContent || "Options");
  if (!hadFocus) return;
  const scope = ownerId == null ? el : [...el.querySelectorAll("[data-i]")].find((node) => node.dataset.i === ownerId);
  const next = key && scope && [...scope.querySelectorAll(`[${key}]`), scope]
    .find((node) => node.getAttribute(key) === value);
  if (next) next.focus({ preventScroll: true });
  else { el.tabIndex = -1; el.focus({ preventScroll: true }); }
}

/** Inert keeps the rest of the app out of reach; wrapping Tab also keeps focus from
 *  escaping a dialog into the browser's controls. */
function trapDialogFocus(ev) {
  if (ev.key !== "Tab") return;
  const dialog = !$("sheet").hidden ? $("sheet-card") : !$("film").hidden ? $("film") : null;
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll('a[href], button, input, select, textarea, iframe, summary, [tabindex]')]
    .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden], [inert]') && el.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1), active = document.activeElement;
  if (!first) { ev.preventDefault(); dialog.focus({ preventScroll: true }); }
  else if (ev.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    ev.preventDefault(); last.focus({ preventScroll: true });
  } else if (!ev.shiftKey && (active === last || !dialog.contains(active))) {
    ev.preventDefault(); first.focus({ preventScroll: true });
  }
}

/** Open a bottom sheet. onClick(action, event) handles [data-x] buttons; return true to keep it open. */
function openSheet(html, onClick) {
  const sheet = $("sheet"), card = $("sheet-card"), from = document.activeElement;
  card.innerHTML = CLOSE + html;
  card.setAttribute("aria-label", card.querySelector("h3")?.textContent || "Options");
  card.tabIndex = -1;
  sheet.hidden = false;
  setInert();
  card.focus({ preventScroll: true });
  return new Promise((resolve) => {
    const done = (v) => {
      sheet.hidden = true; sheet.onclick = null; card.innerHTML = ""; dismissSheet = null;
      setInert();
      if (from?.isConnected && from !== document.body) from.focus({ preventScroll: true });
      resolve(v);
    };
    dismissSheet = () => done(null);
    sheet.onclick = async (ev) => {
      if (ev.target === sheet) return done(null);
      const b = ev.target.closest("[data-x]");
      if (!b) return;
      if (b.dataset.x === "close") return done(null);
      const keep = await onClick?.(b.dataset.x, ev, b);
      if (!keep) done(b.dataset.x);
    };
  });
}

/** Local date as YYYY-MM-DD, days from today. */
function isoDay(days = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const WHEN = [["today", "Today"], ["yesterday", "Yesterday"], ["other", "Another day"], ["none", "Don't log"]];

/** Ask how film i was, and (optionally) when you watched it, for the diary.
 *  Resolves to {label, date} (date null when not logged), or null if cancelled. */
/** The rating sheet. current: your rating now, marked, with Remove rating. Resolves
 *  { label, date }, { remove: true } or null. */
function askRating(i, { when = "none", current = null } = {}) {
  let w = when, date = null;
  const row = () => WHEN.map(([v, l]) => `<button class="opt" data-x="when:${v}" aria-pressed="${w === v}">${l}</button>`).join("");
  return openSheet(`<div class="detail-head">${poster(i, "w185")}<div><h3>${esc(title(i))}</h3>
      <div class="detail-meta">${esc(subline(i))}</div></div></div>
    <h4 class="opt-h">When did you watch it?</h4>
    <div class="opts" id="when">${row()}</div>
    <input type="date" id="when-date" class="date-in" aria-label="Date you watched it" aria-describedby="when-error" max="${isoDay()}" value="${isoDay(-1)}"${w === "other" ? " required" : " hidden"}>
    <p id="when-error" class="field-error" role="alert" hidden></p>
    <p class="sub">${current ? "Choose a rating to save your changes" : "How was it? Choose a rating to save."}</p>
    <div class="rate-grid">${Object.keys(LABELS).map((k) =>
      `<button data-x="${k}" aria-pressed="${k === current}"${k === current ? ' class="on"' : ""}><span class="dot" style="background:${COLORS[k]}"></span>${LABELS[k]}</button>`).join("")}</div>
    ${current ? `<button class="cancel remove" data-x="remove">Remove rating</button>` : ""}
    <button class="cancel" data-x="close">Cancel</button>`, (x) => {
    if (x.startsWith("when:")) {
      w = x.slice(5);
      replaceContent($("when"), row());
      const input = $("when-date");
      input.hidden = w !== "other";
      input.required = w === "other";
      input.removeAttribute("aria-invalid");
      $("when-error").hidden = true;
      if (w === "other") input.focus({ preventScroll: true });
      return true;
    }
    if (LABELS[x]) {
      const input = $("when-date");
      if (w === "other" && (!isDay(input.value) || input.value > isoDay())) {
        $("when-error").textContent = "Choose a valid date, today or earlier.";
        $("when-error").hidden = false;
        input.setAttribute("aria-invalid", "true");
        input.focus({ preventScroll: true });
        return true;
      }
      date = { today: isoDay(), yesterday: isoDay(-1), other: input.value || null }[w] ?? null;
    }
    return false;
  }).then((x) => (LABELS[x] ? { label: x, date } : x === "remove" ? { remove: true } : null));
}

/** Rate film i, or change or remove your rating, from the rating sheet (logging it in
 *  the diary if dated), with Undo. Resolves true if anything changed. */
async function rateFilm(i) {
  const was = S.answers.get(i), current = was != null ? labelOf(was) : null;
  const r = await askRating(i, { when: current ? "none" : "today", current });
  if (!r || (r.label && r.label === current && !r.date)) return false;
  const logged = diary.length;
  setAnswer(i, r.remove ? undefined : r.label);
  if (r.date) {
    diary.push([imdbOf(i), r.date, r.label]);
    store.set(K.diary, diary);
  }
  toast(r.remove ? `Removed your rating of ${title(i)}`
    : current && r.label !== current ? `Changed to ${SHORT[r.label]}`
    : r.date ? `Added ${title(i)} to your diary` : `Rated ${title(i)}`, () => {
    setAnswer(i, was);
    if (diary.length > logged) { diary.splice(logged); store.set(K.diary, diary); }
    ratingChanged(i);
  });
  ratingChanged(i);
  return true;
}

/** Change your rating of film i to label straight away, with Undo; the one you already
 *  gave opens the rating sheet instead (to remove it, or log a watch). */
function setRating(i, label) {
  const was = S.answers.get(i);
  if (was != null && labelOf(was) === label) return rateFilm(i);
  setAnswer(i, label);
  toast(`Changed to ${SHORT[label]}`, () => { setAnswer(i, was); ratingChanged(i); });
  ratingChanged(i);
}

/** Redraw what shows film i's rating: its film page if open, and the current screen. */
async function ratingChanged(i) {
  refresh();
  if (filmI !== i || $("film").hidden) return;
  const y = $("film").scrollTop;
  renderFilm(i, false);
  fillDirector(i);
  $("film").focus({ preventScroll: true });
  $("film").scrollTop = y;
  const a = await about(i);
  if (filmI === i) { fillAbout(i, a); $("film").scrollTop = y; }
}

// ---------------------------------------------------------------- film page

const ABOUT_SHARDS = 256;   // taste/web.py ABOUT_SHARDS
const aboutShards = new Map();
/** Film-page details for film i, loaded with its shard of films:
 *  [summary, tagline, [directors], [[name, role, photo], ...], backdrop], or null. */
function about(i) {
  const n = i % ABOUT_SHARDS;
  if (!aboutShards.has(n)) {
    aboutShards.set(n, fetch(`data/about/${n}.json?v=${dataV}`).then((r) => (r.ok ? r.json() : {}))
      .catch(() => { aboutShards.delete(n); return {}; }));
  }
  return aboutShards.get(n).then((shard) => shard[i] || null);
}

let filmI = -1, filmDepth = 0;   // film on the film page (-1: closed), and its history entries
let filmSc = null;               // predicted stars when the film page was drawn
let simCands = null;

/** Films most like film i in taste, weighted a little toward ones you'd enjoy. */
function moreLike(i, sc) {
  simCands ??= E.films.votes.reduce((out, v, j) => (v >= 1000 ? (out.push(j), out) : out), []);
  const skip = new Set([...hidden].map(idx));
  const cands = simCands.filter((j) => j !== i && !S.answers.has(j) && !skip.has(j) && !noArt.has(j));
  const near = E.similar(i, cands, 60);
  const score = new Map(near.map(([j, sim]) => [j, sim + 0.4 * (E.match(sc[j], S.sd(j)) - 0.5)]));
  return near.map(([j]) => j).sort((a, b) => score.get(b) - score.get(a)).slice(0, 16);
}

const FICON = {
  down: `<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`,
  share: `<svg viewBox="0 0 24 24"><path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M6.5 11H5.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5h-1"/></svg>`,
  eye: `<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  nope: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M6 18 18 6"/></svg>`,
};

function trailerFrame(i) {
  return `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer(i))}?autoplay=1&playsinline=1&rel=0"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Trailer"></iframe>`;
}

function renderFilm(i, play) {
  const sc = S.scores(), sd = S.sd(i), rated = S.answers.get(i), saved = watch.includes(imdbOf(i));
  const label = rated != null ? labelOf(rated) : null;
  const why = because(S.support(i, 8));
  const mine = myServices(), keys = servicesOf(i);
  const where = keys.length
    ? `<div class="prov">${keys.map((k) => `<span${mine.has(k) ? ' class="mine"' : ""}><img src="${IMG}w92${services.get(k).logo}" alt="">${esc(k)}</span>`).join("")}</div>`
    : `<p>${ext(i) ? (ext(i)[2] ? "Not streaming anywhere right now, but you can rent or buy it." : "Not streaming anywhere right now.") : "We don't know where this one's streaming yet."}</p>`;
  const sc10 = E.films.score[i];
  const meta = [year(i), hm(runtime(i)), sc10 ? `IMDb ${(sc10 / 10).toFixed(1)}` : ""].filter(Boolean).join(" · ");
  const more = moreLike(i, sc);
  filmSc = sc;
  const btn = (f, icon, text, cls = "") => `<button class="fa${cls}" data-f="${f}"${f === "save" ? ` aria-pressed="${saved}"` : ""}>${icon}<span>${text}</span></button>`;
  $("film").innerHTML = `
    <div class="film-hero${play ? " playing" : ""}" id="film-hero">
      ${play ? trailerFrame(i) : `${posterUrl(i, "w342") ? `<img class="film-blur" src="${posterUrl(i, "w342")}" alt="">` : ""}<div class="film-hero-shade"></div>`}
    </div>
    <button class="icon-round film-close" data-f="close" aria-label="Close">${FICON.down}</button>
    <button class="icon-round film-share" data-f="share" aria-label="Share">${FICON.share}</button>
    <div class="film-body">
      <div class="film-head">
        ${poster(i, "w342", "", true)}
        <div class="film-titles">
          <div class="film-badges">${badges(i)}</div>
          <h1>${esc(title(i))}</h1>
          <div class="film-meta">${esc(meta)}</div>
          <div class="film-genres">${genres(i, 4).map((g) => `<span>${esc(g)}</span>`).join("")}</div>
        </div>
      </div>
      <div class="film-match">
        ${label ? `<button class="your-rating" data-f="rate" style="--rc:${COLORS[label]}" aria-label="${YOURS[label]}. Change your rating"><span class="dot"></span>${YOURS[label]}${ICON.edit}</button>`
          : S.rated >= 3 ? matchPill(E.match(sc[i], sd)) : `<p class="match-start">Rate ${3 - S.rated} more film${S.rated === 2 ? "" : "s"} to find your match.</p>`}
        ${!label && S.rated >= 3 && why ? `<p class="fwhy">${why}</p>` : ""}
      </div>
      <div class="film-actions">
        ${trailer(i) ? btn("trailer", ICON.play, "Trailer") : ""}
        ${label ? "" : btn("save", ICON.save, saved ? "Saved" : "Save", saved ? " on" : "")}
        ${btn("rate", label ? `<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>` : FICON.eye, label ? "Change rating" : "Seen it")}
        ${label || saved ? "" : btn("hide", FICON.nope, "Not for me")}
      </div>
      <section class="film-sec" id="film-about"><div class="skel"></div><div class="skel short"></div></section>
      <section class="film-sec"><h2>Where to watch (US)</h2><div class="where">${where}</div></section>
      <section class="film-sec" id="film-people" hidden></section>
      <section class="film-sec" id="film-dir" hidden></section>
      ${more.length ? `<section class="film-sec"><h2>More like this</h2><div class="shelf-row">${more.map((j, k) => tile(j, true, sc, k < 4)).join("")}</div></section>` : ""}
      <div class="film-links"><a href="${imdbUrl(i)}" target="_blank" rel="noopener">IMDb page</a></div>
    </div>`;
}

function fillAbout(i, a) {
  const box = $("film-about"), people = $("film-people");
  if (!box) return;
  const [summary, tagline, directors, cast, backdrop] = a || ["", "", [], [], ""];
  box.innerHTML = summary || tagline
    ? `${tagline ? `<p class="tagline">${esc(tagline)}</p>` : ""}${summary ? `<p class="overview">${esc(summary)}</p>` : ""}`
    : "";
  box.hidden = !summary && !tagline;
  const face = (name, role, photo) => `<div class="person">${photo
    ? `<img src="${IMG}w185${photo}" alt="" loading="lazy">`
    : `<span class="initials">${esc(name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(""))}</span>`}
    <b>${esc(name)}</b><small>${esc(role)}</small></div>`;
  const faces = [...(directors || []).map((d) => face(d, "Director", "")), ...(cast || []).map(([n, r, ph]) => face(n, r, ph))];
  people.hidden = !faces.length;
  people.innerHTML = faces.length ? `<h2>Cast &amp; crew</h2><div class="people-row">${faces.join("")}</div>` : "";
  const hero = $("film-hero");
  if (backdrop && hero && !hero.classList.contains("playing")) {
    const img = new Image();
    img.className = "film-bd";
    img.alt = "";
    img.onload = () => { if (filmI === i) { hero.prepend(img); requestAnimationFrame(() => img.classList.add("in")); } };
    img.src = `${IMG}w1280${backdrop}`;
  }
}

/** "More from <director>": their other well-known films, most-voted first. */
function fillDirector(i) {
  directors().then((D) => {
    const box = $("film-dir");
    if (!D || !box || filmI !== i) return;
    for (const n of D.films[i] || []) {
      const others = (filmsByDirector.get(n) || []).filter((j) => j !== i && E.films.votes[j] >= 500 && !noArt.has(j))
        .sort((a, b) => E.films.votes[b] - E.films.votes[a]).slice(0, 16);
      if (others.length < 2) continue;
      box.innerHTML = `<h2>More from ${esc(D.names[n])}</h2><div class="shelf-row">${others.map((j, k) => tile(j, true, filmSc, k < 4)).join("")}</div>`;
      box.hidden = false;
      return;
    }
  });
}

/** Open the full-screen page for film i (play: start its trailer). More like this
 *  opens films on top, each a history entry, so Back returns to the one before. */
let filmFrom = null;   // what had focus before the film page opened

async function openFilm(i, { play = false, push = true } = {}) {
  const page = $("film");
  if (page.hidden) filmFrom = document.activeElement;
  filmI = i;
  if (push) { history.pushState({ film: imdbOf(i) }, ""); filmDepth++; }
  renderFilm(i, play && trailer(i));
  page.hidden = false;
  page.setAttribute("aria-label", title(i));
  page.tabIndex = -1;
  setInert();
  page.focus({ preventScroll: true });
  page.scrollTop = 0;
  fillDirector(i);
  const a = await about(i);
  if (filmI === i && !page.hidden) fillAbout(i, a);
}

function hideFilm() {
  const page = $("film");
  page.hidden = true;
  page.innerHTML = "";
  filmI = -1;
  setInert();
  if (filmFrom?.isConnected && filmFrom !== document.body) filmFrom.focus({ preventScroll: true });
  filmFrom = null;
}

function closeFilm() {
  const d = filmDepth;
  filmDepth = 0;
  hideFilm();
  if (d) history.go(-d);
}

async function shareFilm(i) {
  const pct = S.rated >= 3 ? ` (${Math.round(E.match(S.scores()[i], S.sd(i)) * 100)}% match for me)` : "";
  const url = `${location.origin}${location.pathname}#f=${imdbOf(i)}`;
  const text = `${title(i)}${year(i) ? ` (${year(i)})` : ""}${pct} on Kael`;
  try {
    if (navigator.share) await navigator.share({ title: title(i), text, url });
    else { await navigator.clipboard.writeText(`${text}: ${url}`); toast("Link copied"); }
  } catch { /* share sheet dismissed */ }
}

async function filmAction(f, ev) {
  const i = filmI;
  if (i < 0) return;
  if (f === "close") return closeFilm();
  if (f === "share") return shareFilm(i);
  if (f === "trailer") {
    const hero = $("film-hero");
    hero.classList.add("playing");
    hero.innerHTML = trailerFrame(i);
    $("film").scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return;
  }
  if (f === "save") {
    const on = toggleWatch(i);
    if (on) dropFromHome(i);
    toast(on ? "Saved to Watchlist" : "Removed from Watchlist");
    const b = ev.target.closest(".fa");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("span").textContent = on ? "Saved" : "Save";
    $("film").querySelector('[data-f="hide"]')?.toggleAttribute("hidden", on);
    refresh();
    return;
  }
  if (f === "hide") {
    hidden.add(imdbOf(i)); saveAll(); dropFromHome(i);
    toast("Got it. You won't see it again", () => { hidden.delete(imdbOf(i)); saveAll(); refresh(); });
    closeFilm();
    refresh();
    return;
  }
  if (f === "rate") rateFilm(i);
}

// ---------------------------------------------------------------- rate

function saveQueue() {
  store.set(K.queue, rateQueue.map(imdbOf));
}

/** The film to rate now and the one after. The card behind is kept as the next
 *  question, so its poster has downloaded by the time it comes forward; the one after
 *  that is fetched early too. */
function rateFilms() {
  rateQueue = rateQueue.filter((i) => !S.answers.has(i) && !noArt.has(i));
  const kept = rateStack.filter((i) => !S.answers.has(i) && !noArt.has(i));
  const first = rateQueue[0] ?? kept[0] ?? S.next(noArt);
  if (first < 0) return (rateStack = []);
  let second = rateQueue[1] ?? (kept[0] === first ? kept[1] : undefined);
  if (second === undefined) {
    const ahead = S.nextBatch(3, noArt).filter((i) => i !== first);
    second = ahead[0];
    if (ahead[1] !== undefined) preload(ahead[1]);
  } else if (rateQueue[2] !== undefined) preload(rateQueue[2]);
  return (rateStack = second === undefined ? [first] : [first, second]);
}

let rateBusy = false;   // the next card's poster is still downloading: answers wait for it
let rateGen = 0;        // counts draws, so an older one still waiting for a poster gives way

/** Resolves true once card's poster has downloaded and decoded (so it can be shown
 *  whole), false if it can't be. */
function posterReady(card, ms = 15000) {
  const box = card.querySelector(".poster"), img = box.querySelector("img");
  if (!img) return Promise.resolve(false);
  return new Promise((res) => {
    let over = false;
    const end = (ok) => { if (over) return; over = true; clearTimeout(t); mo.disconnect(); res(ok); };
    const check = () => {
      if (box.classList.contains("noimg") || !img.isConnected) return end(false);
      if (box.classList.contains("pending") || !img.complete || !img.naturalWidth) return;
      if (img.decode) img.decode().then(() => end(true), () => end(true));
      else end(true);
    };
    const mo = new MutationObserver(check);
    mo.observe(box, { attributes: true, attributeFilter: ["class"], childList: true });
    img.addEventListener("load", check);
    const t = setTimeout(() => end(false), ms);
    check();
  });
}

/** The Rate cards: the front one, and the next one hidden right behind it with its
 *  poster downloading. A card is only ever seen once its poster is ready: answering
 *  fades the front card out to show the next, and a film that isn't behind it (the
 *  first one, or one brought back by Undo) fades in on top. */
async function renderRate() {
  const n = S.rated;
  if ($("rate-progress")) $("rate-progress").textContent = n < GOAL ? `${n} / ${GOAL}` : `${n} rated`;
  if ($("rate-ready")) $("rate-ready").hidden = n < 3;
  $("rate-count").innerHTML = n < GOAL ? `<b>${n}</b> of ${GOAL} rated` : `<b>${n}</b> rated`;   // picks are sharp at GOAL
  const last = answers.at(-1);
  $("undo").hidden = !last;
  if (last) $("undo-label").textContent = last[1] == null ? "Not seen" : SHORT[labelOf(last[1])];
  const films = rateFilms(), stage = $("rate-stage"), gen = ++rateGen;
  if (!films.length) {
    stage.innerHTML = `<div class="empty">That's every film we had to ask you about.<br>Search for any film to rate more.</div>`;
    if ($("rate-title")) $("rate-title").textContent = "Every opinion counts.";
    if ($("rate-meta")) $("rate-meta").textContent = "Search for another film you've seen to keep shaping your taste.";
    rateBusy = false;
    return;
  }
  stage.querySelector(".empty")?.remove();
  const [a, b] = films, cardOf = (c) => (c ? Number(c.dataset.i) : -1);
  const front = stage.querySelector(".fcard.front:not(.leaving):not(.gone)");
  if (cardOf(front) !== a) {
    const back = stage.querySelector(".fcard.under"), coming = stage.querySelector(".fcard.hold");
    let next = cardOf(back) === a ? back : cardOf(coming) === a ? coming : null;
    if (coming && coming !== next) coming.remove();
    if (!next) { next = cardEl(a, "hold"); stage.append(next); }   // on top, unseen for now
    rateBusy = true;
    const ready = await posterReady(next);
    if (gen !== rateGen) return;   // a newer draw took over
    if (!ready) {
      next.remove();
      if (!navigator.onLine) return addEventListener("online", () => gen === rateGen && renderRate(), { once: true });
      noArt.add(a);
      return renderRate();
    }
    stage.querySelectorAll(".fcard.under, .fcard.hold").forEach((c) => { if (c !== next) c.remove(); });
    if (front) {
      // From behind: the front card fades out to show it. On top: it fades in over the front card.
      front.classList.add(next.classList.contains("under") ? "leaving" : "gone");
      setTimeout(() => front.remove(), 240);
    }
    next.classList.remove("under", "hold");
    next.classList.add("front");
    next.inert = false;
    setBackdrop(a);
    rateBusy = false;
  } else { setBackdrop(a); rateBusy = false; }
  if ($("rate-title")) $("rate-title").textContent = title(a);
  if ($("rate-meta")) $("rate-meta").textContent = subline(a);
  // The card after: hidden behind the front one, so its poster is ready in time.
  const back = stage.querySelector(".fcard.under");
  if (cardOf(back) !== (b ?? -1)) {
    back?.remove();
    if (b !== undefined) stage.prepend(cardEl(b, "under"));
  }
}

function rateCard(i, cls) {
  return `<div class="fcard ${cls}" data-i="${i}" role="button" tabindex="0" aria-label="${esc(`${title(i)}${year(i) ? ` (${year(i)})` : ""}. Open film page`)}">
    ${poster(i, "w780", "", true)}<div class="shade"></div>
    <div class="finfo"><h2>${esc(title(i))}</h2><p class="fsub">${esc(subline(i))}</p></div>
  </div>`;
}

function cardEl(i, cls) {
  const t = document.createElement("template");
  t.innerHTML = rateCard(i, cls).trim();
  const el = t.content.firstElementChild;
  el.inert = cls !== "front";   // unseen until its poster is ready, so no focus either
  return el;
}

function rateWith(label, { save = false } = {}) {
  const card = $("rate-stage").querySelector(".fcard.front:not(.leaving):not(.gone)");
  if (!card || rateBusy) return;
  const i = Number(card.dataset.i);
  const before = S.rated;
  if (save) {
    // Haven't seen it but want to: onto the Watchlist, and on to the next film.
    if (!watch.includes(imdbOf(i))) toggleWatch(i);
    toast("Saved to Watchlist", () => { if (watch.includes(imdbOf(i))) toggleWatch(i); undo(); });
  }
  setAnswer(i, label);
  rateQueue = rateQueue.filter((x) => x !== i);
  saveQueue();
  if (before < 3 && S.rated === 3) toast("Nice! Your first picks are waiting on Home");
  if (before < GOAL && S.rated === GOAL) toast("That's 20! Your picks just got a lot better");
  renderRate();
}

function undo() {
  if (rateBusy) return;
  const last = answers.pop();
  if (!last) return;
  saveAll();
  rebuild();
  const i = idx(last[0]);
  if (i !== undefined) rateQueue.unshift(i);
  saveQueue();
  renderRate();
}

// ---------------------------------------------------------------- poster wall

function openWall() {
  const queued = new Set(rateQueue);
  wallItems = S.nextBatch(WALL + queued.size, noArt).filter((i) => !queued.has(i)).slice(0, WALL);
  wallSel = new Set();
  show("wall");
}

function renderWall() {
  replaceContent($("wall"), wallItems.map((i) => `<button class="tile${wallSel.has(i) ? " sel" : ""}" data-i="${i}" aria-pressed="${wallSel.has(i)}">
      ${poster(i, "w342", "", true)}<span class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
      <span class="t">${esc(title(i))}</span></button>`).join(""));
  const n = wallSel.size;
  $("wall-count").textContent = n ? `${n} seen` : "Tap the ones you've seen";
  $("wall-go").innerHTML = `${n ? `Rate ${n}` : `Next ${WALL}`} ${ICON.chevron}`;
  setBackdrop(wallItems[0] ?? -1);
}

function finishWall() {
  for (const i of wallItems) if (!wallSel.has(i) && !S.answers.has(i)) setAnswer(i, null);
  if (wallSel.size) {
    rateQueue.push(...wallItems.filter((i) => wallSel.has(i)));
    saveQueue();
    show("rate");
  } else openWall();
}

// ---------------------------------------------------------------- picks

/** The friend whose taste Home and Tonight blend with yours: the one you picked, else the
 *  first. Skips any whose saved taste doesn't fit the current model (the model, and so
 *  the size of a taste vector, changes now and then). */
function activeFriend() {
  const usable = friends.filter((f) => { try { return decodeTaste(f.code).length === E.d; } catch { return false; } });
  return usable.find((f) => f.id === prefs.friend) || usable[0];
}

/** How unsure a pick is (± stars): the model's uncertainty, plus more for films with
 *  small audiences and for content-placed films. */
const caution = (i) => Math.sqrt(S.sd(i) ** 2 + AUDIENCE_VAR / (1 + E.films.votes[i] / AUDIENCE_VOTES)
  + (E.flags[i] ? ESTIMATED_VAR : 0));

/** Unit taste direction of film i (films only, so cached for good). */
const dirCache = new Map();
function dir(i) {
  let d = dirCache.get(i);
  if (!d) { d = S.direction(i); dirCache.set(i, d); }
  return d;
}

function varied(sorted, key) {
  const pool = sorted.slice(0, 3 * VARIED), dirs = pool.map(dir);
  const closest = new Float64Array(pool.length), used = new Uint8Array(pool.length), out = [];
  for (let n = 0; n < Math.min(VARIED, pool.length); n++) {
    let bi = -1, bv = -Infinity;
    for (let p = 0; p < pool.length; p++) {
      if (used[p]) continue;
      const v = key.get(pool[p]) - VARIETY * (n ? closest[p] : 0);
      if (v > bv) { bv = v; bi = p; }
    }
    used[bi] = 1;
    out.push(pool[bi]);
    for (let p = 0; p < pool.length; p++) {
      if (used[p]) continue;
      let c = 0;
      for (let q = 0; q < dirs[p].length; q++) c += dirs[p][q] * dirs[bi][q];
      if (c > closest[p]) closest[p] = c;
    }
  }
  const taken = new Set(out);
  return out.concat(sorted.filter((i) => !taken.has(i)));
}

/** "Because you loved A and B, and didn't like C" from S.support. */
function because(support) {
  const verbs = { loved: "loved", liked: "liked", meh: "didn't love", disliked: "didn't like" };
  const list = support.map(([j, a]) => [j, labelOf(a)]);
  const ups = list.filter(([, a]) => a === "loved" || a === "liked").slice(0, 2);
  const downs = list.filter(([, a]) => a === "meh" || a === "disliked").slice(0, ups.length ? 1 : 2);
  const parts = Object.keys(verbs).map((a) => {
    const names = [...ups, ...downs].filter(([, x]) => x === a).map(([j]) => `<b>${esc(title(j))}</b>`);
    return names.length ? `${verbs[a]} ${and(names)}` : "";
  }).filter(Boolean);
  return parts.length ? `Because you ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}` : parts[0]}` : "";
}

// ---------------------------------------------------------------- home

const genreMask = (names) => names.reduce((m, g) => {
  const b = E.meta.genres.indexOf(g);
  return b >= 0 ? m | (1 << b) : m;
}, 0);

/** The films in items that lean toward one end of a taste scale: among the share frac
 *  of well-known films (2,000+ votes) furthest toward it. */
const scaleCuts = new Map();
function scaleEnd(items, end, frac = 0.25) {
  const at = `${end}:${frac}`;
  const sc = E.meta.scales.find((s) => s.left === end || s.right === end);
  if (!sc) return items;
  const u = E.scaleDir(sc), sign = sc.right === end ? 1 : -1;
  if (!scaleCuts.has(at)) {
    const all = [];
    for (let i = 0; i < E.n; i++) if (E.films.votes[i] >= 2000) all.push(sign * E.along(i, u));
    scaleCuts.set(at, all.sort((a, b) => b - a)[Math.floor(all.length * frac)] ?? -Infinity);
  }
  const cut = scaleCuts.get(at);
  return items.filter((i) => sign * E.along(i, u) >= cut);
}

/** Your favourite genres, best first: average stars shrunk toward 3.5, 3+ ratings each. */
function favoriteGenres() {
  const sum = new Map(), cnt = new Map();
  for (const [id, a] of answers) {
    const i = a == null ? undefined : idx(id);
    if (i === undefined) continue;
    E.meta.genres.forEach((g, b) => {
      if (!(E.films.genres[i] & (1 << b))) return;
      sum.set(b, (sum.get(b) || 0) + E.stars(a));
      cnt.set(b, (cnt.get(b) || 0) + 1);
    });
  }
  return [...cnt.keys()].filter((b) => cnt.get(b) >= 3 && SHELF_GENRES.includes(E.meta.genres[b]))
    .map((b) => [b, (sum.get(b) + 3.5 * 2) / (cnt.get(b) + 2)])
    .sort((a, b) => b[1] - a[1]).map(([b]) => b);
}

/** Home's hero pick and shelves. Candidates come from a few pools (popular, lesser
 *  known, new, most-your-taste) scored once with the same cautious score as Best bets. */
function buildHome() {
  const f = E.films, sc = S.scores(), lf = S.lifts(), now = new Date().getFullYear();
  const skip = new Set([...hidden, ...watch, ...seenOnly].map(idx));
  const popular = [], deep = [], fresh = [];
  for (let i = 0; i < E.n; i++) {
    const v = f.votes[i];
    if (v < 200 || S.answers.has(i) || skip.has(i) || noArt.has(i)) continue;
    if (v >= 2000) popular.push(i);
    else if (sc[i] >= 3.6) deep.push(i);    // lesser-known films only matter if you'd like them
    if (f.year[i] >= now - 1 && v >= 300) fresh.push(i);
  }
  const tasteTop = topBy(popular.filter((i) => sc[i] >= 3.75), lf, 1200);
  const pool = [...new Set([...topBy(popular, sc, 2500), ...topBy(deep, sc, 1000), ...topBy(fresh, sc, 300), ...tasteTop])];
  const push = S.maxPush(pool);
  const pen = new Map(pool.map((i, n) => [i, push[n] + caution(i)]));
  const key = new Map(pool.map((i) => [i, sc[i] - pen.get(i)]));

  // Each shelf prefers films not already near the front of a shelf above it.
  const used = new Set();
  const pick = (items, k = key, { vary = true, n = SHELF_LEN } = {}) => {
    let ranked = items.slice().sort((a, b) => k.get(b) - k.get(a));
    if (vary) ranked = varied(ranked, k);
    const unused = ranked.filter((i) => !used.has(i));
    const out = (unused.length >= 10 ? unused : ranked).slice(0, n);
    out.slice(0, 8).forEach((i) => used.add(i));
    return out;
  };
  const shelves = [];
  const add = (title, items, extra = {}) => { if (items.length >= SHELF_MIN) shelves.push({ title, items, ...extra }); };
  const where = (test) => pool.filter(test);

  // Top picks are chosen by the cautious score, then shown best match first, so the
  // hero is never out-matched by the tiles beside it.
  const matchOf = (i) => E.match(sc[i], S.sd(i));
  const top = pick(where((i) => f.votes[i] >= 2000), key, { n: SHELF_LEN + 1 });
  const m = new Map(top.map((i) => [i, matchOf(i)]));
  const hero = top.slice(0, 6).sort((a, b) => m.get(b) - m.get(a))[0];
  add("Top picks for you", top.filter((i) => i !== hero).sort((a, b) => m.get(b) - m.get(a)));

  const friend = activeFriend();
  if (friend) {
    const fs = E.project(decodeTaste(friend.code));
    const both = where((i) => f.votes[i] >= 2000);
    const k = new Map(both.map((i) => [i, Math.min(key.get(i), fs[i] - caution(i))]));
    add(`For you and ${friend.name}`, pick(both, k), { sub: "Films you'd both enjoy" });
  }

  // "Because you loved ___": your most recent loves (or likes), up to two that differ.
  const fav = (min) => answers.filter(([, a]) => a != null && E.stars(a) >= min).map(([id]) => idx(id))
    .filter((i) => i !== undefined).reverse();
  const anchors = [];
  for (const j of [...fav(4.5), ...fav(4)]) {
    const dj = dir(j);
    if (anchors.every((a) => dotDir(a.d, dj) < 0.5)) anchors.push({ j, d: dj });
    if (anchors.length === 2) break;
  }
  const alike = anchors.map(({ j, d }) => {
    const items = where((i) => f.votes[i] >= 1000 && sc[i] >= 3.6);
    const sim = new Map(items.map((i) => [i, dotDir(dir(i), d)]));
    return [j, pick(items, sim, { vary: false })];
  });
  if (alike[0]) add(`Because you ${E.stars(S.answers.get(alike[0][0])) >= 4.5 ? "loved" : "liked"} ${title(alike[0][0])}`, alike[0][1], { because: alike[0][0] });

  add("New releases for you", pick(where((i) => f.year[i] >= now - 1 && f.votes[i] >= 300)));

  const mine = new Set(prefs.services);
  if (mine.size) add("On your services", pick(where((i) => f.votes[i] >= 1000 && providersOf(i).some((p) => mine.has(p)))));
  else add("Streaming now", pick(where((i) => f.votes[i] >= 1000 && providersOf(i).length)),
    { sub: "Add your services in Settings to see just yours" });

  const genresLiked = favoriteGenres();
  const genreShelf = (b) => add(`${E.meta.genres[b]} for you`, pick(where((i) => f.votes[i] >= 2000 && f.genres[i] & (1 << b))));
  if (genresLiked[0] !== undefined) genreShelf(genresLiked[0]);

  add("Hidden gems", pick(where((i) => f.votes[i] < 15000 && sc[i] >= 3.8)), { sub: "Less-known films we think you'll love" });
  if (alike[1]) add(`Because you ${E.stars(S.answers.get(alike[1][0])) >= 4.5 ? "loved" : "liked"} ${title(alike[1][0])}`, alike[1][1], { because: alike[1][0] });

  const tasteItems = where((i) => f.votes[i] >= 2000 && sc[i] >= 3.75);
  const tasteKey = new Map(tasteItems.map((i) => [i, lf[i] - pen.get(i)]));
  add("Very you", pick(tasteItems, tasteKey), { sub: "Films you'll like more than most people do" });

  add("Short and sweet", pick(where((i) => f.votes[i] >= 2000 && runtime(i) && runtime(i) <= 100)), { sub: "Under 1h 40m" });
  if (genresLiked[1] !== undefined) genreShelf(genresLiked[1]);
  add("Classics for you", pick(where((i) => f.year[i] < 1980 && f.votes[i] >= 2000)));

  return { hero, shelves, pool, key, pen, sc };
}

/** The n items with the highest score (in no particular order), without sorting them
 *  all: a numeric typed-array sort finds the cut-off. */
function topBy(items, score, n) {
  if (items.length <= n) return items;
  const cutoff = Float64Array.from(items, (i) => score[i]).sort()[items.length - n];
  const out = [];
  for (const i of items) if (score[i] >= cutoff && out.length < n) out.push(i);
  return out;
}

function dotDir(a, b) {
  let s = 0;
  for (let q = 0; q < a.length; q++) s += a[q] * b[q];
  return s;
}

/** After saving or hiding film i from Home: take it off the shelves without rebuilding
 *  them (saving doesn't change your taste). */
function dropFromHome(i) {
  if (!home) return;
  for (const sh of home.shelves) sh.items = sh.items.filter((x) => x !== i);
  if (home.hero === i) home.hero = home.shelves[0]?.items.shift();
  homeDirty = false;
  homeShown = null;
}

const ICON = {
  play: `<svg viewBox="0 0 24 24" class="fill"><path d="M8 5v14l11-7z"/></svg>`,
  save: `<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11v17L12 16.5l-5.5 4z"/></svg>`,
  info: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/></svg>`,
  moon: `<svg viewBox="0 0 24 24"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>`,
  down: `<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>`,
  edit: `<svg viewBox="0 0 24 24"><path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10z"/><path d="M13.5 6.5l4 4"/></svg>`,
};

function heroCard(i) {
  const why = because(S.support(i, 8));
  const context = E.flags[i]
    ? "An exploratory pick, estimated from its cast, genre and other film details."
    : S.rated < 20 ? "An early pick. A few more ratings will give Kael a clearer picture of your taste."
      : "A pick from your overall taste profile, without a strong connection to one of your rated films.";
  return `<article class="hero" data-i="${i}">
    <button class="hero-art" data-info="${i}" aria-label="Explore ${esc(title(i))}">${poster(i, "w780", "", true)}</button>
    <div class="hero-info">
      <h2><button data-info="${i}">${esc(title(i))}</button></h2>
      <p class="fsub">${esc(subline(i, true))}</p>
      <div class="hero-top">${matchPill(E.match(home.sc[i], S.sd(i)))}${E.flags[i] ? `<span class="hero-caution">An estimated match</span>` : ""}</div>
      <p class="fwhy">${why || context}</p>
      <div class="hero-actions">
        <button class="primary" data-info="${i}">Explore film ${ICON.chevron}</button>
        <button class="btn glass" data-save="${i}" aria-pressed="false">${ICON.save}Save to watchlist</button>
        ${trailer(i) ? `<button class="btn quiet" data-trailer="${i}">${ICON.play}Trailer</button>` : ""}
      </div>
    </div>
  </article>`;
}

function tile(i, withMatch = true, sc = home?.sc, eager = false) {
  const m = withMatch ? `<span class="tm">${matchPill(E.match(sc[i], S.sd(i)), true, "")}</span>` : "";
  return `<button class="stile" data-i="${i}">${poster(i, "w342", "", eager)}${m}
    <span class="tt">${esc(title(i))}</span><span class="ts">${esc([year(i), hm(runtime(i))].filter(Boolean).join(" · "))}</span></button>`;
}

function shelfHtml(sh, withMatch = true) {
  const head = sh.because !== undefined
    ? `<div class="because">${poster(sh.because, "w92")}<div><small>Because you ${E.stars(S.answers.get(sh.because)) >= 4.5 ? "loved" : "liked"}</small><h2>${esc(title(sh.because))}</h2></div></div>`
    : `<div><h2>${esc(sh.title)}</h2>${sh.sub ? `<p>${esc(sh.sub)}</p>` : ""}</div>`;
  return `<section class="shelf"><div class="shelf-head">${head}</div>
    <div class="shelf-row">${sh.items.map((i, k) => tile(i, withMatch, home?.sc, k < 6)).join("")}</div></section>`;
}

function renderHome() {
  const el = $("home");
  if (S.rated < 3) {
    // Not enough ratings for picks yet: say how to start, and show what's popular.
    const now = new Date().getFullYear(), f = E.films, pop = [];
    for (let i = 0; i < E.n; i++) if (f.year[i] >= now - 2 && f.votes[i] >= 20000 && !S.answers.has(i) && !noArt.has(i)) pop.push(i);
    pop.sort((a, b) => f.votes[b] - f.votes[a]);
    el.innerHTML = `<div class="welcome welcome-start"><div class="welcome-copy">
        <h2>Good films.<br>Your kind of good.</h2>
        <p>Rate ${3 - S.rated} more film${S.rated === 2 ? "" : "s"} you've seen and Kael will start picking films for you. The more you rate, the better it gets to know you.</p>
        <div class="stack"><button class="primary" data-wall>Start with the poster wall</button>
        <button class="btn glass" data-go="rate">Rate one by one</button></div></div>
        <div class="welcome-films" aria-label="Popular films to rate">${pop.slice(0, 2).map((i) => `<button data-info="${i}" aria-label="Rate ${esc(title(i))}">${poster(i, "w342", "", true)}<span>${esc(title(i))}</span></button>`).join("")}</div>
      </div>`
      + shelfHtml({ title: "Popular right now", sub: "Seen any? Tap to rate it", items: pop.slice(0, 20) }, false);
    setBackdrop(pop[0] ?? -1);
    homeShown = null;
    return;
  }
  if (homeDirty || !home) { home = buildHome(); homeDirty = false; }
  setBackdrop(home.hero ?? -1);
  if (home === homeShown) return;   // same shelves: keep them, posters and all
  homeShown = home;
  el.innerHTML = `<div class="home-feature">${home.hero !== undefined ? heroCard(home.hero) : `<div class="welcome"><h2>A fresh perspective.</h2><p>You've explored all your current picks. Rate more films or look through your watchlist.</p></div>`}
    <aside class="home-aside">
      <button class="tonight" data-tonight><span class="ic">${ICON.moon}</span>
        <span class="tx"><b>What to watch tonight</b><span>A mood. A little time. Three films for you.</span></span>${ICON.chevron}</button>
      <div class="taste-note"><h3>A taste all your own.</h3><p>${S.rated.toLocaleString()} films rated. Your opinions shape every recommendation.</p>
        <button class="text-link" data-go="rate">Keep shaping your taste ${ICON.chevron}</button></div>
    </aside></div>` + home.shelves.map((sh) => shelfHtml(sh)).join("");
}

function homeSave(i) {
  const on = toggleWatch(i);
  if (on) dropFromHome(i);
  toast(on ? "Saved to Watchlist" : "Removed from Watchlist", on ? () => { toggleWatch(i); homeDirty = true; refresh(); } : null);
  refresh();
}

// ---------------------------------------------------------------- tonight

/** Up to 30 picks for a Tonight request, best first (varied, so the first three differ). */
function tonightPicks(st) {
  const { pool, key, pen, sc } = home, f = E.films;
  const mood = MOODS.find((m) => m.id === st.mood) || MOODS[0];
  let items = moodItems(mood, pool.filter((i) => f.votes[i] >= 1000));
  if (st.time) items = items.filter((i) => runtime(i) && runtime(i) <= st.time);
  if (st.mine) { const mine = new Set(prefs.services); items = items.filter((i) => providersOf(i).some((p) => mine.has(p))); }
  let k = key;
  const friend = st.who === "friend" && activeFriend();
  if (friend) {
    const fs = E.project(decodeTaste(friend.code));
    k = new Map(items.map((i) => [i, Math.min(sc[i] - pen.get(i), fs[i] - caution(i))]));
  }
  return varied(items.sort((a, b) => k.get(b) - k.get(a)), k).slice(0, 30);
}

async function openTonight() {
  if (S.rated < 3) return toast(`Rate ${3 - S.rated} more film${S.rated === 2 ? "" : "s"} first, then we'll find you something`);
  if (homeDirty || !home) { home = buildHome(); homeDirty = false; }
  const friend = activeFriend();
  const st = { mood: "any", time: 0, who: "me", mine: prefs.services.length > 0 };
  let results = [], at = 0;
  const card = () => $("sheet-card");
  const opt = (g, v, label) => `<button class="opt" data-x="opt:${g}:${v}" aria-pressed="${String(st[g]) === String(v)}">${esc(label)}</button>`;
  const form = () => `<h3>Tonight</h3><p class="sub">What are you in the mood for?</p>
    <div class="opts">${MOODS.map((m) => opt("mood", m.id, m.label)).join("")}</div>
    <h4 class="opt-h">How long have you got?</h4>
    <div class="opts">${TIMES.map(([v, l]) => opt("time", v, l)).join("")}</div>
    ${friend ? `<h4 class="opt-h">Who's watching?</h4><div class="opts">${opt("who", "me", "Just me")}${opt("who", "friend", `Me and ${friend.name}`)}</div>` : ""}
    ${prefs.services.length ? `<label class="switch"><span>Only on my services</span><input type="checkbox" id="tn-mine"${st.mine ? " checked" : ""}></label>` : ""}
    <button class="primary wide" data-x="go">Show me 3 picks</button>`;
  const shown = () => {
    if (!results.length) return `<h3>Tonight</h3><div class="empty">Nothing fits all of that.<br>Try a different mood or length.</div>
      <button class="primary wide" data-x="change">Change</button>`;
    const three = results.slice(at, at + 3);
    return `<h3>Tonight</h3><p class="sub">${esc(MOODS.find((m) => m.id === st.mood).label)}${st.time ? ` · ${esc(TIMES.find(([v]) => v === st.time)[1].toLowerCase())}` : ""}</p>
      <div class="tn-list">${three.map((i) => {
        const why = because(S.support(i, 8)), saved = watch.includes(imdbOf(i));
        return `<div class="tn"><button class="tn-poster" data-x="open:${i}" aria-label="Open ${esc(title(i))}">${poster(i, "w185")}</button>
          <div class="tn-main"><button class="tn-title" data-x="open:${i}">${esc(title(i))}</button>
            <div class="tn-sub">${esc(subline(i))}</div>
            <div class="tn-row">${matchPill(E.match(home.sc[i], S.sd(i)), true)}${logos(i, 3)}</div>
            ${why ? `<p class="tn-why">${why}</p>` : ""}
            <div class="tn-actions">${trailer(i) ? `<button class="btn small light" data-x="trailer:${i}">${ICON.play}Trailer</button>` : ""}
              <button class="btn small glass" data-x="save:${i}" aria-pressed="${saved}">${ICON.save}${saved ? "Saved" : "Save"}</button></div>
          </div></div>`;
      }).join("")}</div>
      <div class="tn-foot"><button class="btn glass" data-x="change">Change</button>
        ${results.length > 3 ? `<button class="primary" data-x="more">3 more</button>` : ""}</div>`;
  };
  const act = await openSheet(form(), (x) => {
    if (x.startsWith("opt:")) {
      const [, g, v] = x.split(":");
      st[g] = g === "time" ? Number(v) : v;
      st.mine = $("tn-mine")?.checked ?? st.mine;
      replaceContent(card(), CLOSE + form());
      return true;
    }
    if (x === "go") {
      st.mine = $("tn-mine")?.checked ?? false;
      results = tonightPicks(st); at = 0;
      replaceContent(card(), CLOSE + shown());
      card().scrollTop = 0;
      return true;
    }
    if (x === "more") { at = at + 3 < results.length ? at + 3 : 0; replaceContent(card(), CLOSE + shown()); return true; }
    if (x === "change") { replaceContent(card(), CLOSE + form()); return true; }
    if (x.startsWith("save:")) {
      const i = Number(x.slice(5)), on = toggleWatch(i);
      if (on) dropFromHome(i);
      replaceContent(card(), CLOSE + shown());
      return true;
    }
    return false;
  });
  if (act?.startsWith("open:")) openFilm(Number(act.slice(5)));
  if (act?.startsWith("trailer:")) openFilm(Number(act.slice(8)), { play: true });
  if (view === "home") refresh();
}

// ---------------------------------------------------------------- watchlist, search

function renderWatchCount() {
  const n = watch.length, c = $("watch-count");
  c.hidden = n === 0;
  c.textContent = n > 99 ? "99+" : n;
}

function renderWatch() {
  const sc = S.scores(), sort = prefs.watchSort || "match";
  let items = watch.map(idx).filter((i) => i !== undefined).sort((a, b) => sc[b] - sc[a]);
  const all = items.length;
  if (sort === "short") items.sort((a, b) => (runtime(a) || 999) - (runtime(b) || 999));
  if (sort === "new") items.sort((a, b) => year(b) - year(a));
  if (sort === "mine") { const mine = new Set(prefs.services); items = items.filter((i) => providersOf(i).some((p) => mine.has(p))); }
  const bar = $("watch-sort");
  bar.hidden = all < 2;
  bar.querySelectorAll("[data-sort]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.sort === sort));
    if (b.dataset.sort === "mine") b.hidden = !prefs.services.length;
  });
  setBackdrop(items[0] ?? -1);
  $("watch").innerHTML = items.length ? items.map((i) => `<button class="gtile" data-i="${i}">
      ${poster(i, "w342")}<div class="gmatch">${matchPill(E.match(sc[i], S.sd(i)), true)}</div>
      <div class="gt">${esc(title(i))}</div><div class="gs">${esc([year(i), hm(runtime(i))].filter(Boolean).join(" · "))}</div>
      ${logos(i, 5)}</button>`).join("")
    : all ? `<div class="empty" style="grid-column:1/-1">None of your saved films are on your services right now.</div>`
    : `<div class="empty" style="grid-column:1/-1">Nothing saved yet.<br>Tap Save on a pick on Home to keep it here.</div>`;
}

function search(q) {
  if (!fullReady) return renderWaiting();
  if (!q.trim()) { renderBrowse(); return; }
  $("browse").innerHTML = "";
  titles ??= new Titles(E.films.title, E.films.votes);
  const sc = S.scores();
  $("results").innerHTML = titles.find(q).map((i) => filmRow(i, sc)).join("") || `<li class="empty">Couldn't find that one.<br>Try another spelling?</li>`;
}

/** Build the Search index in small slices once the app has settled, so the first
 *  search doesn't pause to do it all. */
function warmSearch() {
  titles ??= new Titles(E.films.title, E.films.votes);
  const step = () => { if (!titles.warm(6)) setTimeout(step, 40); };
  setTimeout(step, 2000);
}

/** One line per film: poster, title, year and genres, and your rating or your match.
 *  scale: your rating as the four choices under the title, the one you gave lit up,
 *  so another is one tap away. */
function filmRow(i, sc, { scale = false } = {}) {
  const a = S.answers.get(i), l = a != null ? labelOf(a) : null;
  if (l && scale) {
    return `<li class="row" data-i="${i}">${poster(i, "w154")}
      <div class="row-main"><button class="row-title">${esc(title(i))}</button><div class="row-sub">${esc(subline(i))}</div>
        <div class="rate-pick" role="group" aria-label="Your rating">${SCALE.map((k) =>
          `<button data-set="${k}" style="--rc:${COLORS[k]}" aria-pressed="${k === l}" aria-label="${LABELS[k]}">${RICON[k]}<span>${SHORT[k]}</span></button>`).join("")}</div>
      </div></li>`;
  }
  const end = l ? `<button class="rtag" data-change="${i}" style="--rc:${COLORS[l]}" aria-label="${YOURS[l]}. Change your rating">${SHORT[l]}${ICON.down}</button>`
    : S.rated >= 3 ? matchPill(E.match(sc[i], S.sd(i)), true, "") : "";
  const saved = !l && watch.includes(imdbOf(i));
  return `<li class="row" data-i="${i}">${poster(i, "w154")}
    <div class="row-main"><button class="row-title">${esc(title(i))}</button><div class="row-sub">${esc(subline(i))}</div></div>
    <div class="row-end">${saved ? `<span class="saved-mark" aria-label="On your watchlist">${ICON.save}</span>` : ""}${end}</div>
  </li>`;
}

// ---------------------------------------------------------------- browse

const BROWSE_GENRES = ["Action", "Comedy", "Drama", "Thriller", "Horror", "Sci-Fi", "Romance", "Crime", "Animation", "Documentary",
  "Adventure", "Mystery"];
const DECADES = [2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950];
let browsing = null;   // {title, items} while a browse list is open

/** Keep the films in items that fit a Tonight mood. */
function moodItems(mood, items) {
  const f = E.films;
  if (mood.genres) { const m = genreMask(mood.genres); items = items.filter((i) => f.genres[i] & m); }
  if (mood.not) { const m = genreMask(mood.not); items = items.filter((i) => !(f.genres[i] & m)); }
  if (mood.end) items = scaleEnd(items, mood.end, mood.frac);
  return items;
}

/** A browse list: your best matches that pass test (and fit mood), or, before you've
 *  rated 3 films, the most popular. */
function browseList(test, mood = null, n = 60) {
  let items;
  if (S.rated >= 3) {
    if (homeDirty || !home) { home = buildHome(); homeDirty = false; }
    items = home.pool.filter((i) => E.films.votes[i] >= 500 && test(i));
    if (mood) items = moodItems(mood, items);
    return varied(items.sort((a, b) => home.key.get(b) - home.key.get(a)), home.key).slice(0, n);
  }
  items = [];
  for (let i = 0; i < E.n; i++) if (E.films.votes[i] >= 5000 && !S.answers.has(i) && !noArt.has(i) && test(i)) items.push(i);
  if (mood) items = moodItems(mood, items);
  return items.sort((a, b) => E.films.votes[b] - E.films.votes[a]).slice(0, n);
}

function renderBrowse() {
  const el = $("browse"), res = $("results");
  if (browsing) {
    el.innerHTML = `<div class="browse-head"><h2>${esc(browsing.title)}</h2>
      <button class="icon-round" data-browse-close aria-label="Back to browse"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;
    const sc = S.scores();
    res.innerHTML = browsing.items.map((i) => filmRow(i, sc)).join("") || `<li class="empty">Nothing here yet.</li>`;
    setBackdrop(browsing.items[0] ?? -1);
    return;
  }
  res.innerHTML = "";
  const g = E.films.genres, mine = S.rated >= 3;
  const tiles = BROWSE_GENRES.map((name) => {
    const b = E.meta.genres.indexOf(name);
    const top = b < 0 ? undefined : browseList((i) => g[i] & (1 << b), null, 1)[0];
    const url = top !== undefined ? posterUrl(top, "w342") : "";
    return `<button class="gen" data-genre="${esc(name)}">${url ? `<img src="${url}" alt="" loading="lazy">` : ""}<span>${esc(name)}</span></button>`;
  }).join("");
  el.innerHTML = `
    <h2 class="browse-h">${mine ? "In the mood for" : "Moods"}</h2>
    <div class="opts">${MOODS.filter((m) => m.id !== "any").map((m) => `<button class="opt" data-mood="${m.id}">${esc(m.label)}</button>`).join("")}</div>
    <h2 class="browse-h">Genres</h2><div class="genre-grid">${tiles}</div>
    <h2 class="browse-h">Decades</h2>
    <div class="opts">${DECADES.map((d) => `<button class="opt" data-decade="${d}">${d}s</button>`).join("")}</div>`;
  setBackdrop(-1);
}

function openBrowse(kind, value) {
  const f = E.films, mine = S.rated >= 3;
  if (kind === "genre") {
    const b = E.meta.genres.indexOf(value);
    browsing = { title: mine ? `${value} for you` : `Popular ${value.toLowerCase()}`, items: browseList((i) => f.genres[i] & (1 << b)) };
  } else if (kind === "decade") {
    const d = Number(value);
    browsing = { title: `The ${d}s${mine ? " for you" : ""}`, items: browseList((i) => f.year[i] >= d && f.year[i] < d + 10) };
  } else {
    const mood = MOODS.find((m) => m.id === value);
    browsing = { title: mood.label, items: browseList(() => true, mood) };
  }
  renderBrowse();
  $("view-search").scrollTop = 0;
}

// ---------------------------------------------------------------- library

let libTab = "watch", ratedFilter = "all";

function renderLib() {
  document.querySelectorAll("#lib-tabs button").forEach((b) => {
    const selected = b.dataset.lib === libTab;
    b.id = `tab-${b.dataset.lib}`;
    b.setAttribute("aria-selected", String(selected));
    b.setAttribute("aria-controls", `lib-${b.dataset.lib}`);
    b.tabIndex = selected ? 0 : -1;
  });
  for (const t of ["watch", "diary", "rated"]) {
    const panel = $(`lib-${t}`);
    panel.hidden = t !== libTab;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${t}`);
    panel.tabIndex = 0;
  }
  if (libTab === "watch") renderWatch();
  else if (libTab === "diary") renderDiary();
  else renderRated();
}

function renderRated() {
  const all = answers.filter(([, a]) => a != null).reverse().map(([id, a]) => [idx(id), labelOf(a)]).filter(([i]) => i !== undefined);
  const counts = {};
  for (const [, l] of all) counts[l] = (counts[l] || 0) + 1;
  if (ratedFilter !== "all" && !counts[ratedFilter]) ratedFilter = "all";
  $("rated-filter").hidden = all.length < 2;
  replaceContent($("rated-filter"), [["all", `All ${all.length}`], ...Object.keys(LABELS).filter((k) => counts[k]).map((k) => [k, `${SHORT[k]} ${counts[k]}`])]
    .map(([k, l]) => `<button class="opt" data-rf="${k}" aria-pressed="${ratedFilter === k}">${l}</button>`).join(""));
  const list = all.filter(([, l]) => ratedFilter === "all" || l === ratedFilter).map(([i]) => i);
  const sc = S.scores();
  replaceContent($("mine"), list.length ? list.slice(0, mineShown).map((i) => filmRow(i, sc, { scale: true })).join("")
    : `<li class="empty">Nothing rated yet.<br>Rate a few films in the Rate tab.</li>`);
  $("more-mine").hidden = list.length <= mineShown;
  $("more-mine").textContent = `Show all ${list.length}`;
  setBackdrop(list[0] ?? -1);
}

// ---------------------------------------------------------------- you

function renderMe() {
  const thisYear = String(new Date().getFullYear());
  const loved = answers.filter(([, a]) => a != null && E.stars(a) >= 4.5).length;
  const logged = diary.filter(([, d]) => d.startsWith(thisYear)).length;
  $("stats").innerHTML = [[S.rated, "rated"], [loved, "loved"], [logged, `watched in ${thisYear}`]]
    .map(([v, l]) => `<div class="stat"><strong>${v.toLocaleString()}</strong><span>${l}</span></div>`).join("");
  renderScales();
  renderLife();
  renderFriends();
  setBackdrop(ratedFilms()[0]?.[0] ?? -1);
}

function renderSettings() {
  renderServices();
  renderBackup();
  $("unhide").hidden = hidden.size === 0;
  $("unhide").textContent = `Unhide ${hidden.size} film${hidden.size === 1 ? "" : "s"}`;
  $("updated").textContent = `Film data updated ${E.meta.updated}.`;
  setBackdrop(-1);
}

// ---------------------------------------------------------------- your film life

let directorsP = null, filmsByDirector = null;
/** Directors per film, from data/directors.json (null if it isn't there). */
function directors() {
  directorsP ??= fetch(`data/directors.json?v=${dataV}`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (!d) { directorsP = null; return null; }
    filmsByDirector = new Map();
    for (const [k, ds] of Object.entries(d.films)) for (const n of ds) {
      if (!filmsByDirector.has(n)) filmsByDirector.set(n, []);
      filmsByDirector.get(n).push(Number(k));
    }
    return d;
  });
  return directorsP;
}

/** Your rated films, [[film, stars], ...], newest first. */
const ratedFilms = () => answers.filter(([, a]) => a != null).reverse()
  .map(([id, a]) => [idx(id), E.stars(a)]).filter(([i]) => i !== undefined);

const pctLiked = (liked, n) => `${Math.round((100 * liked) / n)}% liked`;

function renderLife() {
  const el = $("life"), rated = ratedFilms();
  if (rated.length < 5) {
    el.innerHTML = `<p class="muted">Rate ${5 - rated.length} more film${rated.length === 4 ? "" : "s"} to see your genres, decades and directors.</p>`;
    return;
  }
  // Genres you watch most (bars: how many you've rated; right: how many you liked).
  const byGenre = new Map();
  for (const [i, st] of rated) {
    E.meta.genres.forEach((name, b) => {
      if (!(E.films.genres[i] & (1 << b)) || !SHELF_GENRES.includes(name)) return;
      const v = byGenre.get(name) || [0, 0];
      v[0]++; if (st >= 4) v[1]++;
      byGenre.set(name, v);
    });
  }
  const topG = [...byGenre].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).slice(0, 6);
  const maxG = topG[0]?.[1][0] || 1;
  const genreRows = topG.map(([name, [n, liked]]) => `<div class="bar-row">
      <span class="bl">${esc(name)}</span><span class="bt"><span class="bf" style="width:${(100 * n) / maxG}%"></span></span>
      <span class="bv">${n} · ${pctLiked(liked, n)}</span></div>`).join("");

  // Decades: how many films from each; the one you like most (3+ films) is highlighted.
  const byDec = new Map();
  for (const [i, st] of rated) {
    const y = E.films.year[i];
    if (!(y > 0)) continue;
    const d = Math.floor(y / 10) * 10, v = byDec.get(d) || [0, 0, 0];
    v[0]++; v[1] += st; if (st >= 4) v[2]++;
    byDec.set(d, v);
  }
  const decs = [...byDec].sort((a, b) => a[0] - b[0]);
  const fav = decs.filter(([, v]) => v[0] >= 3).sort((a, b) => (b[1][1] + 7) / (b[1][0] + 2) - (a[1][1] + 7) / (a[1][0] + 2))[0]?.[0];
  const maxD = Math.max(...decs.map(([, v]) => v[0]));
  const decLabel = (d) => (d >= 2000 ? `${d}s` : `’${String(d).slice(2)}s`);
  const decCaption = (d) => { const v = byDec.get(d); return `${d}s: ${v[0]} film${v[0] === 1 ? "" : "s"}, ${pctLiked(v[2], v[0])}`; };
  const favCaption = (d) => { const v = byDec.get(d); return `The <b>${d}s</b> are your decade. You liked ${Math.round((100 * v[2]) / v[0])}% of the ${v[0]} you've rated.`; };
  const cols = decs.map(([d, v]) => `<button class="col${d === fav ? " fav" : ""}" data-dec="${d}" aria-label="${esc(decCaption(d))}">
      <span class="cf" style="height:${Math.max(4, (100 * v[0]) / maxD)}%"></span><span class="cl">${decLabel(d)}</span></button>`).join("");

  // Favourites: films you loved, newest first.
  const favs = rated.filter(([, st]) => st >= 4.5).map(([i]) => i).slice(0, 12);

  el.innerHTML = `
    <h3 class="life-h">Genres you watch most</h3><div class="bars">${genreRows}</div>
    <h3 class="life-h">Decades</h3>
    <p class="life-cap" id="dec-cap">${fav !== undefined ? favCaption(fav) : "Tap a decade"}</p>
    <div class="cols" role="group" aria-label="Films you've rated by decade">${cols}</div>
    <div id="life-dirs"></div>
    ${favs.length ? `<h3 class="life-h">Films you loved</h3><div class="fav-row">${favs.map((i) => `<button class="fav-tile" data-i="${i}">${poster(i, "w185")}<span>${esc(title(i))}</span></button>`).join("")}</div>` : ""}`;

  directors().then((D) => {
    const box = $("life-dirs");
    if (!D || !box) return;
    const byDir = new Map();
    for (const [i, st] of rated) for (const n of D.films[i] || []) {
      const v = byDir.get(n) || [0, 0, []];
      v[0]++; if (st >= 4) v[1]++; v[2].push(i);
      byDir.set(n, v);
    }
    const top = [...byDir].filter(([, v]) => v[0] >= 2).sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]).slice(0, 5);
    box.innerHTML = top.length ? `<h3 class="life-h">Directors you keep coming back to</h3><div class="dirs">${top.map(([n, [c, liked, films]]) => `
      <div class="dir"><div class="dir-films">${films.slice(0, 3).map((i) => poster(i, "w92")).join("")}</div>
        <div><b>${esc(D.names[n])}</b><span>${c} films · ${pctLiked(liked, c)}</span></div></div>`).join("")}</div>` : "";
  });
}

function renderDiary() {
  const el = $("diary"), more = $("more-diary");
  const items = diary.map((e, n) => [...e, n]).filter(([id]) => idx(id) !== undefined)
    .sort((a, b) => b[1].localeCompare(a[1]) || b[3] - a[3]);
  if (!items.length) {
    el.innerHTML = `<div class="empty">Nothing logged yet.<br>On a film page, tap Seen it and pick when you watched it.</div>`;
    more.hidden = true;
    return;
  }
  const shown = items.slice(0, diaryShown);
  let month = "", html = "";
  for (const [id, date, label, n] of shown) {
    const m = date.slice(0, 7);
    if (m !== month) {
      month = m;
      html += `<div class="month">${new Date(`${m}-01T12:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>`;
    }
    const i = idx(id), l = labelOf(label);
    html += `<div class="entry" data-i="${i}"><span class="day">${Number(date.slice(8))}</span>${poster(i, "w92")}
      <div class="entry-main"><button class="entry-title" aria-label="Open ${esc(title(i))}">${esc(title(i))}</button><span>${esc(String(year(i)))}${LABELS[l] ? ` · <i style="color:${COLORS[l]}">${LABELS[l]}</i>` : ""}</span></div>
      <button class="entry-x" data-unlog="${n}" aria-label="Remove ${esc(title(i))} from diary"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;
  }
  el.innerHTML = html;
  more.hidden = items.length <= diaryShown;
  more.textContent = `Show all ${items.length}`;
}

// ---------------------------------------------------------------- taste card

const loadImg = (src) => new Promise((res) => {
  if (!src) return res(null);
  const im = new Image();
  im.crossOrigin = "anonymous";
  const t = setTimeout(() => res(null), 3500);
  im.onload = () => { clearTimeout(t); res(im); };
  im.onerror = () => { clearTimeout(t); res(null); };
  im.src = src;
});

/** What the card says about you: top genres you like, best decade, taste leanings. */
function tasteSummary() {
  const rated = ratedFilms(), byGenre = new Map(), byDec = new Map();
  for (const [i, st] of rated) {
    E.meta.genres.forEach((name, b) => {
      if (!(E.films.genres[i] & (1 << b)) || !SHELF_GENRES.includes(name) || name === "Drama") return;
      const v = byGenre.get(name) || [0, 0]; v[0]++; v[1] += st >= 4; byGenre.set(name, v);
    });
    const y = E.films.year[i];
    if (y > 0) { const d = Math.floor(y / 10) * 10, v = byDec.get(d) || [0, 0]; v[0]++; v[1] += st; byDec.set(d, v); }
  }
  const genresTop = [...byGenre].filter(([, v]) => v[0] >= 2)
    .sort((a, b) => (b[1][1] + 1) / (b[1][0] + 2) * Math.log1p(b[1][0]) - (a[1][1] + 1) / (a[1][0] + 2) * Math.log1p(a[1][0]))
    .slice(0, 3).map(([n]) => n);
  const decade = [...byDec].filter(([, v]) => v[0] >= 3).sort((a, b) => (b[1][1] + 7) / (b[1][0] + 2) - (a[1][1] + 7) / (a[1][0] + 2))[0]?.[0];
  const leanings = E.meta.scales.map((sc) => {
    const { z } = S.scalePosition(sc);
    return Math.abs(z) >= 0.35 ? (z > 0 ? sc.right : sc.left) : null;
  }).filter(Boolean);
  const favs = rated.filter(([, st]) => st >= 4.5).map(([i]) => i).slice(0, 4);
  return { genresTop, decade, leanings, favs, rated: rated.length, loved: rated.filter(([, st]) => st >= 4.5).length };
}

async function drawTasteCard(withPosters) {
  const W = 1080, H = 1350, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d"), t = tasteSummary();
  await Promise.all(['700 80px "Fraunces"', '600 40px "Fraunces"'].map((f) => document.fonts.load(f).catch(() => {})));
  const serif = (w, px) => `${w} ${px}px Fraunces, Georgia, serif`;
  const sans = (w, px) => `${w} ${px}px -apple-system, "SF Pro Text", system-ui, sans-serif`;
  g.fillStyle = BRAND.ink; g.fillRect(0, 0, W, H);
  const X = 84;
  drawWordmark(g, X, 76, 250);
  g.fillStyle = BRAND.paper; g.font = serif(700, 76);
  const head = prefs.name ? `${prefs.name}'s taste in film` : "My taste in film";
  const words = head.split(" "); let line = "", y = 250;
  for (const w of words) {
    if (g.measureText(`${line}${w} `).width > W - 2 * X && line) { g.fillText(line.trim(), X, y); line = ""; y += 86; }
    line += `${w} `;
  }
  g.fillText(line.trim(), X, y);
  // favourite posters
  const PW = 204, PH = 306, GAP = (W - 2 * X - 4 * PW) / 3, PY = y + 60;
  const imgs = withPosters ? (await Promise.all(t.favs.map((i) => loadImg(posterUrl(i, "w342"))))).filter(Boolean) : [];
  imgs.forEach((im, k) => {   // only the posters that downloaded
    const px = X + k * (PW + GAP);
    g.save();
    g.beginPath(); g.roundRect(px, PY, PW, PH, 6); g.clip();
    g.drawImage(im, px, PY, PW, PH);
    g.restore();
  });
  let ty = PY + (imgs.length ? PH + 90 : 20);
  const label = (text) => {
    g.fillStyle = BRAND.gold; g.font = sans(800, 24);
    if ("letterSpacing" in g) g.letterSpacing = "4px";
    g.fillText(text.toUpperCase(), X, ty);
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    ty += 58;
  };
  const big = (text) => { g.fillStyle = BRAND.paper; g.font = serif(650, 50); ty = wrapText(g, text, X, ty, W - 2 * X, 60, 2) + 34; };
  if (t.genresTop.length) { label("Loves"); big(and(t.genresTop)); }
  if (t.leanings.length) { label("Leans"); big(t.leanings.join(" · ")); }
  if (t.decade) { label("Best decade"); big(`The ${t.decade}s`); }
  g.fillStyle = "#bdccd6"; g.font = sans(600, 30);
  g.fillText(`${t.rated.toLocaleString()} films rated · ${t.loved.toLocaleString()} loved`, X, H - 130);
  g.fillStyle = BRAND.paper; g.font = sans(700, 30);
  g.fillText(`Find films you'll love: ${location.host}`, X, H - 80);
  return new Promise((res, rej) => { try { c.toBlob((b) => (b ? res(b) : rej(new Error("no image"))), "image/png"); } catch (e) { rej(e); } });
}

/** Write text in up to maxLines lines of width w; returns the y after the last line. */
function wrapText(g, text, x, y, w, lh, maxLines) {
  const words = String(text).split(/\s+/);
  let line = "", n = 0;
  for (let k = 0; k < words.length; k++) {
    const next = line ? `${line} ${words[k]}` : words[k];
    if (g.measureText(next).width > w && line) {
      if (++n === maxLines) { g.fillText(`${line}…`, x, y); return y + lh; }
      g.fillText(line, x, y); y += lh; line = words[k];
    } else line = next;
  }
  g.fillText(line, x, y);
  return y + lh;
}

async function openTasteCard() {
  if (S.rated < 5) return toast(`Rate ${5 - S.rated} more film${S.rated === 4 ? "" : "s"} first so there's something to show`);
  const btn = $("taste-card");
  if (btn.disabled) return;
  btn.disabled = true;
  toast("Making your taste card…");
  let blob;
  try { blob = await drawTasteCard(true); } catch { blob = await drawTasteCard(false); }   // posters that can't be drawn
  btn.disabled = false;
  $("toast").hidden = true;
  const url = URL.createObjectURL(blob);
  const file = new File([blob], "kael-taste.png", { type: "image/png" });
  const canShare = navigator.canShare?.({ files: [file] });
  // On phones, "download" links don't reach Photos; the share sheet's Save Image does.
  await openSheet(`<h3>Your taste card</h3>
    <p class="sub">${canShare ? "Tap Save or share, then Save Image to put it in Photos." : "Save it, or share it anywhere."}</p>
    <img class="card-img" src="${url}" alt="Your taste card">
    <div class="card-actions">${canShare ? `<button class="primary" data-x="share">${ICON.save}Save or share</button>`
      : `<a class="primary" href="${url}" download="kael-taste.png">Save image</a>`}</div>
    <p class="card-tip">You can also press and hold the picture to save it.</p>`,
  (x) => { if (x === "share") navigator.share({ files: [file], title: "My taste in film" }).catch(() => {}); return x === "share"; });
  URL.revokeObjectURL(url);
}

function renderScales() {
  if (S.rated < 5) {
    $("scales").innerHTML = `<p style="color:var(--muted);margin:4px 0 0">Rate ${5 - S.rated} more film${S.rated === 4 ? "" : "s"} to see where you sit.</p>`;
    return;
  }
  const thumbs = (ids) => ids.map(idx).filter((i) => i !== undefined).slice(0, 3).map((i) => poster(i, "w92")).join("");
  $("scales").innerHTML = E.meta.scales.map((sc) => {
    const { z, spread } = S.scalePosition(sc);
    const pos = phi(z), lo = phi(z - spread), hi = phi(z + spread);
    return `<div class="scale">
      <div class="scale-labels"><span>${esc(sc.left)}</span><span>${esc(sc.right)}</span></div>
      <div class="scale-track"><div class="scale-band" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></div>
        <div class="scale-dot" style="left:${pos * 100}%"></div></div>
      <div class="scale-films"><div>${thumbs(sc.left_films)}</div><div>${thumbs(sc.right_films)}</div></div>
    </div>`;
  }).join("");
}

function renderFriends() {
  $("friends").innerHTML = friends.map((f) => `<div class="friend"><div><b>${esc(f.name)}</b><br><span>${f.rated} films rated</span></div>
    <div style="display:flex;gap:8px"><button class="pill-btn" data-friend-pick="${esc(f.id)}">See picks</button><button class="pill-btn" data-friend-remove="${esc(f.id)}">Remove</button></div></div>`).join("");
}

function renderServices() {
  const list = [...services.values()].filter((g) => g.films >= 20)
    .sort((a, b) => serviceRank(a.name) - serviceRank(b.name)).slice(0, 24);
  const mine = myServices();
  $("services").innerHTML = list.length ? list.map((g) => `<button class="svc" data-svc="${esc(g.name)}" aria-pressed="${mine.has(g.name)}">
      <img src="${IMG}w92${g.logo}" alt="">${esc(g.name)}</button>`).join("")
    : `<p style="color:var(--muted);margin:0">Streaming info is still loading, or isn't available yet.</p>`;
}

// ---------------------------------------------------------------- watch together

async function shareTaste() {
  if (S.rated < 5) return toast(`Rate ${5 - S.rated} more film${S.rated === 4 ? "" : "s"} first so your friend gets good picks`);
  if (!prefs.name) {
    const act = await openSheet(`<h3>Your name</h3><p class="sub">So your friend knows whose taste it is.</p>
      <div class="field"><input type="text" id="share-name" aria-label="Your first name" maxlength="20" placeholder="First name" autocomplete="given-name"></div>
      <button class="primary" style="width:100%" data-x="ok">Continue</button>`, (x) => {
      if (x === "ok") prefs.name = ($("share-name").value || "").trim().slice(0, 20);
      return x === "ok" && !prefs.name;
    });
    if (act !== "ok" || !prefs.name) return;
    savePrefs();
  }
  const url = tasteLink(`${location.origin}${location.pathname}`, prefs.name, S.rated, S.mean);
  try {
    if (navigator.share) await navigator.share({ title: "Kael", text: `${prefs.name}'s movie taste. Open it to find films we'd both like.`, url });
    else { await navigator.clipboard.writeText(url); toast("Link copied. Send it to a friend!"); }
  } catch { /* share sheet dismissed */ }
}

function receiveTaste() {
  if (!location.hash.startsWith("#t=")) return false;
  const link = parseTasteLink(location.hash, E.d);
  history.replaceState(null, "", location.pathname);
  if (!link) { toast("That link didn't work. Ask your friend to send it again."); return false; }
  const { name, rated, code } = link;
  friends = friends.filter((f) => f.name !== name);
  const id = `${Date.now()}`;
  friends.push({ id, name, rated, code, added: new Date().toISOString().slice(0, 10) });
  store.set(K.friends, friends);
  prefs.friend = id; savePrefs();
  markDirty();
  toast(S.rated >= 3 ? `Added ${name}! Home now has films you'll both like` : `Added ${name}! Rate 3 films to see what you'd both like`);
  return true;
}

// ---------------------------------------------------------------- import

async function importFile(file) {
  if (!fullReady) return toast("Still loading the film catalogue. Try again in a moment.");
  const res = $("import-result");
  res.hidden = false;
  res.textContent = "Reading…";
  try {
    const { ratings, seen, saves, logs, missing } = await readImport(file, E);
    if (!ratings.length && !seen.length && !saves.length && !logs.length) throw new Error("no films found in it");
    const has = new Map(answers.map(([id, a]) => [id, a]));
    let added = 0, kept = 0;
    for (const [i, stars] of ratings) {
      const id = imdbOf(i);
      if (has.get(id) != null) { kept++; continue; }
      answers = answers.filter(([x]) => x !== id);
      answers.push([id, stars]);
      watch = watch.filter((x) => x !== id);
      seenOnly.delete(id);
      has.set(id, stars);
      added++;
    }
    for (const i of seen) if (has.get(imdbOf(i)) == null) seenOnly.add(imdbOf(i));
    for (const i of saves) {
      const id = imdbOf(i);
      if (has.get(id) == null && !seenOnly.has(id) && !watch.includes(id)) watch.push(id);
    }
    const logged = new Set(diary.map(([id, d]) => `${id}|${d}`));
    let dated = 0;
    for (const [i, date, stars] of logs) {
      const key = `${imdbOf(i)}|${date}`;
      if (logged.has(key)) continue;
      logged.add(key);
      diary.push([imdbOf(i), date, stars]);
      dated++;
    }
    store.set(K.diary, diary);
    saveAll();
    rebuild();
    const n = (k, one, many) => `${k.toLocaleString()} ${k === 1 ? one : many}`;
    const got = [added && n(added, "rating", "ratings"), seen.length && n(seen.length, "watched film", "watched films"),
      saves.length && n(saves.length, "watchlist film", "watchlist films"), dated && n(dated, "diary entry", "diary entries")].filter(Boolean);
    res.textContent = (got.length ? `Imported ${and(got)}.` : "Nothing new to import.")
      + (kept ? ` ${n(kept, "film was", "films were")} already rated here, so we kept your answer${kept === 1 ? "" : "s"}.` : "")
      + (missing ? ` We couldn't find ${n(missing, "film", "films")} from the file.` : "");
    refresh();
  } catch (err) {
    res.textContent = `Couldn't import that file: ${err.message}.`;
  }
}

// ---------------------------------------------------------------- backup

// A backup is every stored key (K), as saved: {app, version, saved, data: {key: value}}.
const CLEAN = { [K.answers]: clean.answers, [K.hidden]: clean.ids, [K.watch]: clean.ids, [K.seen]: clean.ids,
  [K.friends]: clean.friends, [K.queue]: clean.ids, [K.diary]: clean.diary };

function renderBackup() {
  const n = answers.filter(([, a]) => a != null).length;
  $("backup-note").textContent = prefs.lastBackup
    ? `Last backup ${new Date(`${prefs.lastBackup}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.`
    : n >= 10 ? `You haven't saved a backup of your ${n} ratings yet.` : "";
}

async function saveBackup() {
  const data = {};
  for (const k of Object.values(K)) {
    const v = store.get(k, null);
    if (v != null) data[k] = v;
  }
  const name = `kael-backup-${isoDay()}.json`;
  const file = new File([JSON.stringify({ app: "kael", version: 1, saved: new Date().toISOString(), data })], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Kael backup" }); } catch { return; }   // cancelled
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  prefs.lastBackup = isoDay(); savePrefs();
  renderBackup();
  toast("Backup saved");
}

/** Restore a backup file: merge it with what's here (your answers win), or replace. */
async function restoreBackup(file) {
  let b = null;
  try { b = JSON.parse(await file.text()); } catch { /* not JSON */ }
  const d = b?.app === "kael" && b.data && typeof b.data === "object" ? b.data : null;
  if (!d) return toast("That file isn't a Kael backup");
  const list = (k) => CLEAN[k](d[k]);   // what the backup holds for k, with anything malformed dropped
  const rated = list(K.answers).filter(([, a]) => a != null).length;
  const saved = b.saved ? new Date(b.saved) : null;
  const when = saved && !isNaN(saved) ? saved.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "on an unknown date";
  const act = await openSheet(`<h3>Restore backup</h3>
    <p class="sub">Saved ${esc(when)}: ${rated.toLocaleString()} ratings, ${list(K.watch).length.toLocaleString()} saved, ${list(K.diary).length.toLocaleString()} diary entries.</p>
    <div class="stack"><button class="primary" data-x="merge">Merge with what's here</button>
      <button class="btn glass wide" data-x="replace">Replace what's here</button></div>
    <p class="fine">Merging keeps your ratings on this phone and adds the rest. Replacing makes this phone match the backup.</p>
    <button class="cancel" data-x="close">Cancel</button>`);
  if (act !== "merge" && act !== "replace") return;
  if (act === "replace") {
    // Write the backup's data first and clear the rest after, so a failed write (store.set
    // says so) leaves what was here rather than nothing.
    const next = Object.fromEntries(Object.keys(CLEAN).filter((k) => Array.isArray(d[k])).map((k) => [k, list(k)]));
    if (d[K.prefs] && typeof d[K.prefs] === "object") next[K.prefs] = clean.prefs(d[K.prefs]);
    if (!Object.entries(next).every(([k, v]) => store.set(k, v))) return;
    for (const k of Object.values(K)) if (!(k in next)) localStorage.removeItem(k);
  } else {
    const union = (mine, theirs, key = (x) => x) => {
      const seen = new Set(mine.map(key));
      return [...mine, ...theirs.filter((x) => { const k = key(x); return seen.has(k) ? false : (seen.add(k), true); })];
    };
    // Ratings: keep every one made here; add the backup's for films not rated here (a
    // backup rating replaces a "haven't seen it" here).
    const theirsA = list(K.answers);
    const ratedHere = new Set(answers.filter(([, a]) => a != null).map(([id]) => id));
    const known = new Set(answers.map(([id]) => id));
    const add = theirsA.filter(([id, a]) => a != null && !ratedHere.has(id));
    const addIds = new Set(add.map(([id]) => id));
    const notSeen = theirsA.filter(([id, a]) => a == null && !known.has(id));
    const merged = [...answers.filter(([id]) => !addIds.has(id)), ...notSeen, ...add];
    const ratedIds = new Set(merged.filter(([, a]) => a != null).map(([id]) => id));
    store.set(K.answers, merged);
    store.set(K.hidden, union([...hidden], list(K.hidden)));
    store.set(K.seen, union([...seenOnly], list(K.seen)).filter((id) => !ratedIds.has(id)));
    store.set(K.watch, union(watch, list(K.watch)).filter((id) => !ratedIds.has(id)));
    store.set(K.diary, union(diary, list(K.diary), ([id, date]) => `${id}|${date}`));
    store.set(K.friends, union(friends, list(K.friends), (f) => f.id));
    const theirs = clean.prefs(d[K.prefs]);
    store.set(K.prefs, { ...prefs, services: prefs.services.length ? prefs.services : theirs.services, name: prefs.name || theirs.name });
  }
  try { sessionStorage.setItem("kael.restored", act); } catch { /* private mode */ }
  location.reload();
}

// ---------------------------------------------------------------- navigation

function show(v) {
  view = v;
  document.body.dataset.view = v;
  document.querySelectorAll(".view").forEach((s) => { s.hidden = s.id !== `view-${v}`; });
  const tab = { wall: "rate", settings: "me" }[v] || v;
  document.querySelectorAll(".tabbar button").forEach((b) => {
    if (b.dataset.view === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  refresh();
  const el = document.getElementById(`view-${v}`);
  el.scrollTop = 0;
  el.classList.remove("scrolled");
}

function refresh() {
  if (!fullReady && (view === "search" || (view === "home" && S.rated >= 3))) return renderWaiting();
  if (view === "home") renderHome();
  else if (view === "rate") renderRate();
  else if (view === "wall") renderWall();
  else if (view === "lib") renderLib();
  else if (view === "search") search($("q").value);
  else if (view === "me") renderMe();
  else if (view === "settings") renderSettings();
}

/** Search and picks need every film, which a new visitor is still downloading. */
function renderWaiting() {
  if (view === "search") {
    $("browse").innerHTML = "";
    $("results").innerHTML = `<li class="empty">Loading all ${Math.round(E.fullN / 1000)},000 films…<br>One moment.</li>`;
  } else {
    homeShown = null;
    $("home").innerHTML = `<div class="welcome"><h2>Finding your picks</h2><p>Kael is still loading the whole film catalogue. Your picks will appear in a moment.</p></div>`;
  }
}


function wire() {
  document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  document.querySelectorAll("#view-rate .act").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.a;
    if (a === "save") rateWith(null, { save: true });
    else rateWith(a === "skip" ? null : a);
  }));
  $("undo").addEventListener("click", undo);
  $("to-wall").addEventListener("click", openWall);
  $("wall-back").addEventListener("click", () => show("rate"));
  $("wall").addEventListener("click", (ev) => {
    const t = ev.target.closest(".tile");
    if (!t) return;
    const i = Number(t.dataset.i);
    if (wallSel.has(i)) wallSel.delete(i); else wallSel.add(i);
    renderWall();
  });
  $("wall-go").addEventListener("click", finishWall);
  $("wall-none").addEventListener("click", () => { wallSel.clear(); finishWall(); });

  $("rate-stage").addEventListener("click", (ev) => {
    const card = ev.target.closest(".fcard.front:not(.leaving):not(.gone)");
    if (card) openFilm(Number(card.dataset.i));
  });
  $("film").addEventListener("click", (ev) => {
    const f = ev.target.closest("[data-f]"), t = ev.target.closest(".stile");
    if (f) filmAction(f.dataset.f, ev);
    else if (t) openFilm(Number(t.dataset.i));
  });
  window.addEventListener("popstate", () => {
    const id = history.state?.film;
    if (id !== undefined && idx(id) !== undefined) { filmDepth = Math.max(0, filmDepth - 1); openFilm(idx(id), { push: false }); }
    else { filmDepth = 0; hideFilm(); }
  });
  document.addEventListener("keydown", (ev) => {
    trapDialogFocus(ev);
    if (ev.key === "Escape") { if (dismissSheet) dismissSheet(); else if (filmI >= 0) closeFilm(); return; }
    const key = (ev.key || "").toLowerCase(), act = RATE_KEYS[key];
    if ((!act && key !== "z") || ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || view !== "rate"
      || !$("sheet").hidden || !$("film").hidden || ev.target.closest?.("input, textarea, select")) return;
    if (key === "z") undo();
    else if (act === "save") rateWith(null, { save: true });
    else rateWith(act === "skip" ? null : act);
  });
  $("rate-stage").addEventListener("keydown", (ev) => {
    const card = ev.target.closest(".fcard.front:not(.leaving):not(.gone)");
    if (card && ev.target === card && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openFilm(Number(card.dataset.i)); }
  });
  $("home").addEventListener("click", (ev) => {
    const at = (sel) => ev.target.closest(sel);
    const n = (el, k) => Number(el.dataset[k]);
    let b;
    if ((b = at("[data-trailer]"))) openFilm(n(b, "trailer"), { play: true });
    else if ((b = at("[data-save]"))) homeSave(n(b, "save"));
    else if ((b = at("[data-info]"))) openFilm(n(b, "info"));
    else if (at("[data-tonight]")) openTonight();
    else if (at("[data-wall]")) openWall();
    else if ((b = at(".hero, .stile"))) openFilm(n(b, "i"));
  });
  document.addEventListener("click", (ev) => {
    const go = ev.target.closest("[data-go]");
    if (go) show(go.dataset.go);
  });

  $("watch-sort").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-sort]");
    if (b) { prefs.watchSort = b.dataset.sort; savePrefs(); renderWatch(); }
  });
  $("watch").addEventListener("click", (ev) => {
    const t = ev.target.closest(".gtile");
    if (t) openFilm(Number(t.dataset.i));
  });
  for (const id of ["results", "mine"]) {
    $(id).addEventListener("click", (ev) => {
      const ch = ev.target.closest("[data-change]"), set = ev.target.closest("[data-set]"), li = ev.target.closest(".row");
      if (ch) rateFilm(Number(ch.dataset.change));
      else if (set) setRating(Number(li.dataset.i), set.dataset.set);
      else if (li) openFilm(Number(li.dataset.i));
    });
  }
  $("browse").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-mood], [data-genre], [data-decade], [data-browse-close]");
    if (!b) return;
    if (b.hasAttribute("data-browse-close")) { browsing = null; renderBrowse(); return; }
    if (b.dataset.mood) openBrowse("mood", b.dataset.mood);
    else if (b.dataset.genre) openBrowse("genre", b.dataset.genre);
    else openBrowse("decade", b.dataset.decade);
  });
  $("lib-tabs").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-lib]");
    if (b) { libTab = b.dataset.lib; renderLib(); $("view-lib").scrollTop = 0; }
  });
  $("lib-tabs").addEventListener("keydown", (ev) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) return;
    const tabs = [...$("lib-tabs").querySelectorAll("[data-lib]")], at = tabs.indexOf(document.activeElement);
    if (at < 0) return;
    ev.preventDefault();
    const next = ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1
      : (at + (ev.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    libTab = tabs[next].dataset.lib;
    renderLib();
    tabs[next].focus({ preventScroll: true });
    $("view-lib").scrollTop = 0;
  });
  $("rated-filter").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-rf]");
    if (b) { ratedFilter = b.dataset.rf; mineShown = 30; renderRated(); }
  });
  // Headers get a frosted background once the page scrolls under them.
  document.querySelectorAll(".view.scroll").forEach((v) =>
    v.addEventListener("scroll", () => v.classList.toggle("scrolled", v.scrollTop > 4), { passive: true }));
  let t;
  $("q").addEventListener("input", (ev) => { clearTimeout(t); t = setTimeout(() => search(ev.target.value), 120); });

  $("share").addEventListener("click", shareTaste);
  $("friends").addEventListener("click", (ev) => {
    const pick = ev.target.closest("[data-friend-pick]"), rm = ev.target.closest("[data-friend-remove]");
    if (pick) { prefs.friend = pick.dataset.friendPick; savePrefs(); homeDirty = true; show("home"); }
    if (rm) { friends = friends.filter((f) => f.id !== rm.dataset.friendRemove); store.set(K.friends, friends); markDirty(); renderFriends(); }
  });
  $("services").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-svc]");
    if (!b) return;
    const g = services.get(b.dataset.svc), on = !myServices().has(g.name);
    const set = new Set(prefs.services);
    for (const id of g.ids) { if (on) set.add(id); else set.delete(id); }
    prefs.services = [...set]; savePrefs(); markDirty();
    b.setAttribute("aria-pressed", String(on));
  });
  $("import-file").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file) importFile(file);
    ev.target.value = "";
  });
  $("more-mine").addEventListener("click", () => { mineShown = Infinity; renderRated(); });
  $("more-diary").addEventListener("click", () => { diaryShown = Infinity; renderDiary(); });
  $("diary").addEventListener("click", (ev) => {
    const x = ev.target.closest("[data-unlog]"), e = ev.target.closest(".entry");
    if (x) {
      const n = Number(x.dataset.unlog), gone = diary[n];
      diary.splice(n, 1); store.set(K.diary, diary); renderDiary();
      toast("Removed from your diary", () => { diary.splice(n, 0, gone); store.set(K.diary, diary); renderDiary(); });
    } else if (e) openFilm(Number(e.dataset.i));
  });
  $("life").addEventListener("click", (ev) => {
    const c = ev.target.closest("[data-dec]"), t = ev.target.closest(".fav-tile");
    if (c) $("dec-cap").textContent = c.getAttribute("aria-label");
    else if (t) openFilm(Number(t.dataset.i));
  });
  window.addEventListener("hashchange", () => {
    let got = false;
    try { got = receiveTaste(); } catch { /* an odd link: ignore it */ }
    if (got) { homeShown = null; refresh(); } else if (!openSharedFilm() && location.hash === "#rate") show("rate");
  });
  $("taste-card").addEventListener("click", openTasteCard);
  $("backup-save").addEventListener("click", saveBackup);
  $("backup-file").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file) restoreBackup(file);
    ev.target.value = "";
  });
  $("unhide").addEventListener("click", () => { hidden.clear(); saveAll(); renderSettings(); });
  $("reset").addEventListener("click", () => {
    if (!confirm("Delete all your ratings, watchlist, diary and imports, and start over?")) return;
    answers = []; hidden.clear(); watch = []; seenOnly.clear(); diary = []; rateQueue = []; rateStack = [];
    store.set(K.diary, diary); saveQueue(); saveAll();
    prefs.seed = newSeed(); savePrefs(); rebuild(); show("rate");
  });
}

// ---------------------------------------------------------------- start

const getJson = (f, count) => fetch(`data/${f}?v=${dataV}`).then((r) => (r.ok ? r.json() : null)).catch(() => null).finally(count || undefined);

/** Films with no poster are never shown (only once posters are known at all). */
function markNoArt() {
  if (posters.some(Boolean)) for (let i = 0; i < E.n; i++) if (!posters[i]) noArt.add(i);
}

/** After a quick start: bring in every film, posters and streaming data, then let Search and
 *  picks work. Tries again a few times if the connection drops; the quiz works meanwhile. */
async function loadEverything(meta, tries = 4) {
  try {
    const [rest, p, x] = await Promise.all([loadRest("data/", meta), getJson("posters.json"), getJson("extras.json")]);
    E.upgrade(rest);
    if (p) posters = p;
    if (x) { extras = x; buildServices(); }
    markNoArt();
    simCands = null; scaleCuts.clear(); titles = null; home = null; homeDirty = true; homeShown = null;
    S.forget();
    fullReady = true;
    warmSearch();
    refresh();
  } catch {
    if (tries > 1) setTimeout(() => loadEverything(meta, tries - 1), 5000);
    else toast("Couldn't load the whole film catalogue. Check your connection and reopen the app.");
  }
}

/** Open the film a #f=<IMDb id> link names. True if the address was one. */
function openSharedFilm() {
  const m = location.hash.match(/^#f=(\d+)$/);
  if (!m) return false;
  history.replaceState(null, "", location.pathname);
  const i = idx(Number(m[1]));
  if (i !== undefined) openFilm(i);
  return true;
}

async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  watchPosters();
  try {
    const meta = await loadMeta();
    dataV = buildOf(meta);
    // A new visitor (nothing rated yet, not following a film link) only needs the question
    // pool to start: about 1.5 MB instead of 16 MB. The rest loads while they rate.
    const quick = answers.length === 0 && !location.hash.startsWith("#f=");
    // Streaming data, trailers and runtimes only matter once there are picks (Home, Tonight,
    // Watchlist), so someone with under 3 ratings isn't kept waiting for them either.
    const needExtras = !quick && answers.filter(([, a]) => a != null).length >= 3;
    let done = 0;
    const step = () => {
      const total = quick ? 2 : needExtras ? 7 : 6;   // quick.json + seen.bin; or loadEngine's 5 files, posters, maybe extras
      done++;
      $("loading-ring").style.strokeDashoffset = String(100 - (100 * done) / total);
      $("loading-text").textContent = done < total / 2 ? "Threading the projector…" : done < total ? "Sorting through 150,000 films…" : "Finding films you'll love…";
    };
    if (quick) {
      const q = await loadQuick("data/", step, meta);
      E = q.engine;
      posters = q.posters;
      fullReady = false;
    } else {
      const extrasP = getJson("extras.json", needExtras && step);
      const [e, p] = await Promise.all([loadEngine("data/", step, meta), getJson("posters.json", step)]);
      E = e;
      if (p) posters = p;
      const useExtras = (x) => { if (x) { extras = x; buildServices(); } };
      if (needExtras) useExtras(await extrasP);
      else extrasP.then((x) => { useExtras(x); markDirty(); if (S && view !== "rate" && view !== "wall") refresh(); });   // arrives in the background
    }
    markNoArt();
    if (quick) loadEverything(meta);
  } catch (err) {
    $("loading-text").textContent = `Couldn't load films (${err.message}). Check your connection and try again.`;
    $("retry").hidden = false;
    $("retry").onclick = () => location.reload();
    return;
  }
  if (prefs.seed == null) { prefs.seed = newSeed(); savePrefs(); }
  rebuild();
  rateQueue = clean.ids(store.get(K.queue, [])).map(idx).filter((i) => i !== undefined);
  wire();
  renderWatchCount();
  const loading = $("loading");
  loading.classList.add("out");
  setTimeout(() => { loading.hidden = true; }, 450);
  $("app").hidden = false;
  if (fullReady) warmSearch();
  try { receiveTaste(); } catch { /* an odd link: carry on without it */ }
  show(location.hash === "#rate" ? "rate" : "home");
  let restored = null;
  try { restored = sessionStorage.getItem("kael.restored"); sessionStorage.removeItem("kael.restored"); } catch { /* private mode */ }
  if (restored) toast(restored === "merge" ? "Backup merged in" : "Backup restored");
  openSharedFilm();
  if (!prefs.onboarded) { prefs.onboarded = true; savePrefs(); }
}

start();
