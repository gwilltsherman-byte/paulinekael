import { loadEngine, phi, Session } from "./engine.js";
import { norm, readImport } from "./importer.js";
import { fly, reset, swipeable } from "./swipe.js";

const $ = (id) => document.getElementById(id);
const K = {
  answers: "mt.answers.v1",  // [[imdbId, label | stars | null], ...] oldest first
  hidden: "mt.hidden.v1",    // [imdbId, ...] "not for me"
  watch: "mt.watch.v1",      // [imdbId, ...] newest first
  seen: "mt.seen.v1",        // [imdbId, ...] watched but not rated (imported)
  friends: "mt.friends.v1",  // [{id, name, rated, code, added}, ...] shared tastes
  queue: "mt.queue.v1",      // [imdbId, ...] poster-wall films still to rate
  prefs: "mt.prefs.v1",
};
const LABELS = { loved: "Loved it", liked: "Liked it", meh: "It was OK", disliked: "Didn't like it" };
const SHORT = { loved: "Loved", liked: "Liked", meh: "OK", disliked: "Nope" };
const COLORS = { loved: "var(--love)", liked: "var(--like)", meh: "var(--meh)", disliked: "var(--nope)" };
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

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
};

let E, S;
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
let answers = store.get(K.answers, []);
let hidden = new Set(store.get(K.hidden, []));
let watch = store.get(K.watch, []);
let seenOnly = new Set(store.get(K.seen, []));
let friends = store.get(K.friends, []);
let prefs = {
  list: "best", era: "any", genre: -1, deep: false, maxRuntime: 0, streamOnly: false,
  services: [], friend: null, name: "", onboarded: false,
  seed: null,  // varies which films the quiz opens with (Session.weights)
  ...store.get(K.prefs, {}),
};
const newSeed = () => (Math.random() * 2 ** 32) | 0;
let view = "rate";
let rateQueue = [];     // films picked on the poster wall, rated next (saved as IMDb ids)
let wallItems = [], wallSel = new Set();
let recsDirty = true, recList = [], recScores = null, friendScores = null;
let searchIndex = null, mineShown = 30;

// ---------------------------------------------------------------- helpers

const idx = (imdb) => E.byImdb.get(imdb);
const imdbOf = (i) => E.films.imdb[i];
const title = (i) => E.films.title[i] || "Untitled";
const year = (i) => E.films.year[i] || "";
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

function hues(i) {
  const h = (Math.imul(imdbOf(i), 2654435761) >>> 0) % 360;
  return [`hsl(${h} 45% 34%)`, `hsl(${(h + 48) % 360} 55% 12%)`];
}

const posterUrl = (i, size) => (posters[i] ? `${IMG}${size}/${posters[i]}` : "");

function poster(i, size, cls = "") {
  const url = posterUrl(i, size), [h1, h2] = hues(i);
  return `<div class="poster ${cls}" style="--h1:${h1};--h2:${h2}"><span class="pf">${esc(title(i))}</span>`
    + (url ? `<img src="${url}" alt="" decoding="async" onerror="this.remove()">` : "") + "</div>";
}

function setBackdrop(i) {
  const url = i >= 0 && posterUrl(i, "w342");
  const [h1, h2] = i >= 0 ? hues(i) : ["#2b2140", "#08070b"];
  $("backdrop").style.setProperty("--bd", url ? `url("${url}")` : `linear-gradient(160deg, ${h1}, ${h2})`);
}

function badges(i) {
  return (year(i) >= new Date().getFullYear() - 1 ? `<span class="badge new">New</span>` : "")
    + (E.flags[i] ? `<span class="badge">Estimated</span>` : "");
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

function saveAll() {
  store.set(K.answers, answers);
  store.set(K.hidden, [...hidden]);
  store.set(K.watch, watch);
  store.set(K.seen, [...seenOnly]);
  recsDirty = true;
  renderWatchCount();
}

/** Record (or change, or clear with label undefined) the answer for film i. */
function setAnswer(i, label) {
  const id = imdbOf(i);
  const existed = answers.findIndex(([x]) => x === id);
  if (existed >= 0) answers.splice(existed, 1);
  if (label !== undefined) answers.push([id, label]);
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
  if (undo) t.querySelector("button").onclick = () => { t.hidden = true; undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3400);
}

// ---------------------------------------------------------------- sheets

const CLOSE = `<button class="sheet-close" data-x="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;

/** Open a bottom sheet. onClick(action, event) handles [data-x] buttons; return true to keep it open. */
function openSheet(html, onClick) {
  const sheet = $("sheet"), card = $("sheet-card");
  card.innerHTML = CLOSE + html;
  sheet.hidden = false;
  return new Promise((resolve) => {
    const done = (v) => { sheet.hidden = true; sheet.onclick = null; card.innerHTML = ""; resolve(v); };
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

function askRating(i) {
  return openSheet(`<div class="detail-head">${poster(i, "w185")}<div><h3>${esc(title(i))}</h3>
      <div class="detail-meta">${esc(subline(i))}</div></div></div>
    <p class="sub">How was it?</p>
    <div class="rate-grid">${Object.keys(LABELS).map((k) =>
      `<button data-x="${k}"><span class="dot" style="background:${COLORS[k]}"></span>${LABELS[k]}</button>`).join("")}</div>
    <button class="cancel" data-x="close">Cancel</button>`);
}

async function openDetails(i, { inWatchlist = false } = {}) {
  const sc = S.scores()[i], sd = S.sd(i);
  const why = because(S.support(i, 8));
  const mine = myServices(), keys = servicesOf(i);
  const where = keys.length
    ? `<div class="prov">${keys.map((k) => `<span${mine.has(k) ? ' class="mine"' : ""}><img src="${IMG}w92${services.get(k).logo}" alt="">${esc(k)}</span>`).join("")}</div>`
    : `<p>${ext(i) ? (ext(i)[2] ? "Not streaming right now; available to rent or buy." : "Not on any streaming service right now.") : "No streaming info for this film yet."}</p>`;
  const saved = watch.includes(imdbOf(i));
  const act = await openSheet(`
    <div class="detail-head">${poster(i, "w342")}<div>
      <h3>${esc(title(i))}</h3><div class="detail-meta">${esc(subline(i, true))}</div>
      <div style="margin-top:9px">${matchPill(E.match(sc, sd), true)}</div></div></div>
    ${why ? `<p class="detail-why">${why}</p>` : ""}
    <div class="where"><h4>Where to watch (US)</h4>${where}</div>
    <div class="detail-actions">
      ${trailer(i) ? `<button class="primary" data-x="trailer"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M8 5v14l11-7z"/></svg>Trailer</button>` : ""}
      <a href="${imdbUrl(i)}" target="_blank" rel="noopener">IMDb</a>
      ${inWatchlist ? `<button data-x="watched">Watched it</button><button data-x="remove">Remove</button>`
        : `<button data-x="save">${saved ? "Saved ✓" : "Save"}</button><button data-x="seen">Seen it</button>`}
    </div>`, (x) => x === "trailer" ? (playTrailer(i), true) : false);
  if (act === "save") { toast(toggleWatch(i) ? "Saved to Watchlist" : "Removed from Watchlist"); refresh(); }
  if (act === "remove") { toggleWatch(i); refresh(); }
  if (act === "seen" || act === "watched") {
    const label = await askRating(i);
    if (label && LABELS[label]) { setAnswer(i, label); toast(`Rated ${title(i)} — picks updated`); refresh(); }
  }
}

function playTrailer(i) {
  $("sheet-card").innerHTML = CLOSE + `<h3>${esc(title(i))}</h3><p class="sub">Trailer</p>
    <div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer(i))}?autoplay=1&playsinline=1&rel=0"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Trailer"></iframe></div>`;
}

// ---------------------------------------------------------------- rate

function saveQueue() {
  store.set(K.queue, rateQueue.map(imdbOf));
}

function rateFilms() {
  rateQueue = rateQueue.filter((i) => !S.answers.has(i));
  const first = rateQueue[0] ?? S.next();
  if (first < 0) return [];
  const second = rateQueue[1] ?? S.nextBatch(2).find((i) => i !== first);
  return second === undefined ? [first] : [first, second];
}

function renderRate() {
  const n = S.rated;
  const q = rateQueue.filter((i) => !S.answers.has(i)).length;
  $("rate-count").innerHTML = `<b>${n}</b> rated${q ? ` · ${q} from wall` : n < GOAL ? ` · sharp at ${GOAL}` : ""}`;
  $("undo").hidden = answers.length === 0;
  const films = rateFilms(), stage = $("rate-stage");
  if (!films.length) {
    stage.innerHTML = `<div class="empty">You've been through every quiz film.<br>Use Search to rate more.</div>`;
    return;
  }
  stage.innerHTML = films.map((i, d) => rateCard(i, d)).reverse().join("");
  setBackdrop(films[0]);
  const card = stage.lastElementChild;
  swipeable(card, { right: true, left: true, up: true, down: true },
    (dir) => rateWith({ right: "liked", left: "disliked", up: "loved", down: null }[dir], dir));
}

function rateCard(i, depth) {
  return `<div class="fcard${depth ? " under" : ""}" data-i="${i}">
    ${poster(i, depth ? "w500" : "w780")}<div class="shade"></div>
    ${depth ? "" : `<div class="stamp" data-dir="right" style="color:var(--like)">LIKED</div>
      <div class="stamp" data-dir="left">NOPE</div>
      <div class="stamp" data-dir="up" style="color:var(--love)">LOVED</div>
      <div class="stamp" data-dir="down">NOT SEEN</div>`}
    <div class="finfo"><h2>${esc(title(i))}</h2><p class="fsub">${esc(subline(i))}</p></div>
  </div>`;
}

function rateWith(label, dir) {
  const card = $("rate-stage").querySelector(".fcard:last-child");
  if (!card) return;
  const i = Number(card.dataset.i);
  const way = dir || { liked: "right", disliked: "left", loved: "up", meh: "down" }[label] || "down";
  fly(card, way);
  if (label === "meh") card.style.setProperty("--p-down", 0);  // no "NOT SEEN" stamp for OK
  const before = S.rated;
  setAnswer(i, label);
  rateQueue = rateQueue.filter((x) => x !== i);
  saveQueue();
  if (before < 3 && S.rated === 3) toast("Your first picks are ready in Discover");
  if (before < GOAL && S.rated === GOAL) toast("20 rated — your picks are sharp now");
  setTimeout(renderRate, 240);
}

function undo() {
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
  wallItems = S.nextBatch(WALL + queued.size).filter((i) => !queued.has(i)).slice(0, WALL);
  wallSel = new Set();
  show("wall");
}

function renderWall() {
  $("wall").innerHTML = wallItems.map((i) => `<button class="tile${wallSel.has(i) ? " sel" : ""}" data-i="${i}" aria-pressed="${wallSel.has(i)}">
      ${poster(i, "w342")}<span class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
      <span class="t">${esc(title(i))}</span></button>`).join("");
  const n = wallSel.size;
  $("wall-count").textContent = n ? `${n} seen` : "Tap every film you've seen";
  $("wall-go").textContent = n ? `Rate ${n} →` : `Next ${WALL} →`;
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

// ---------------------------------------------------------------- discover

function eraRange(era) {
  const now = new Date().getFullYear();
  if (era === "new") return [now - 1, 9999];
  if (era === "old") return [0, 1979];
  if (era === "any") return [0, 9999];
  const d = Number(era);
  return [d, d + 9];
}

const activeFriend = () => friends.find((f) => f.id === prefs.friend) || friends[0];

function computeRecs() {
  const f = E.films, sc = S.scores();
  const minVotes = prefs.deep ? 100 : 2000;
  const [y0, y1] = eraRange(prefs.era);
  const gbit = prefs.genre >= 0 ? 1 << prefs.genre : 0;
  const skip = new Set([...hidden, ...watch, ...seenOnly].map(idx));
  const mine = new Set(prefs.services);
  const streamOnly = prefs.streamOnly && mine.size;
  const cand = [];
  for (let i = 0; i < E.n; i++) {
    if (f.votes[i] < minVotes || S.answers.has(i) || skip.has(i)) continue;
    const y = f.year[i];
    if (y < y0 || y > y1) continue;
    if (gbit && !(f.genres[i] & gbit)) continue;
    if (prefs.maxRuntime && !(runtime(i) && runtime(i) <= prefs.maxRuntime)) continue;
    if (streamOnly && !providersOf(i).some((p) => mine.has(p))) continue;
    cand.push(i);
  }
  const caution = (i) => Math.sqrt(S.sd(i) ** 2 + AUDIENCE_VAR / (1 + f.votes[i] / AUDIENCE_VOTES)
    + (E.flags[i] ? ESTIMATED_VAR : 0));
  const rank = (list, key) => {
    const k = new Map(list.map((i) => [i, key(i)]));
    return varied(list.sort((a, b) => k.get(b) - k.get(a)), k);
  };
  // Every pick must be backed by the combination of your ratings: its score is
  // taken without its single biggest supporter (S.maxPush).
  const combined = (list) => {
    const push = S.maxPush(list);
    return new Map(list.map((i, n) => [i, push[n] + caution(i)]));
  };
  if (prefs.list === "together" && activeFriend()) {
    const fs = friendScores;
    const top = cand.sort((a, b) => Math.min(sc[b], fs[b]) - Math.min(sc[a], fs[a])).slice(0, 2000);
    const pen = combined(top);
    return rank(top, (i) => Math.min(sc[i] - pen.get(i), fs[i] - caution(i)));
  }
  const top = cand.sort((a, b) => sc[b] - sc[a]).slice(0, 2500), penB = combined(top);
  const best = rank(top, (i) => sc[i] - penB.get(i));
  if (prefs.list !== "taste") return best;
  const lf = S.lifts(), shownBest = new Set(best.slice(0, 20));
  const liked = cand.filter((i) => sc[i] >= 3.75 && !shownBest.has(i)).sort((a, b) => lf[b] - lf[a]).slice(0, 2500);
  const penT = combined(liked);
  return rank(liked, (i) => lf[i] - penT.get(i));
}

function varied(sorted, key) {
  const pool = sorted.slice(0, 3 * VARIED), dirs = pool.map((i) => S.direction(i));
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

function filtersActive() {
  return prefs.era !== "any" || prefs.genre >= 0 || prefs.deep || prefs.maxRuntime || (prefs.streamOnly && prefs.services.length);
}

function renderDiscover() {
  const friend = activeFriend();
  if (prefs.list === "together" && !friend) prefs.list = "best";
  document.querySelectorAll("#lists button").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.list === prefs.list));
    if (b.dataset.list === "together") { b.hidden = !friend; b.textContent = friend ? `With ${friend.name}` : "Together"; }
  });
  $("filter-dot").hidden = !filtersActive();
  const deck = $("deck");
  if (S.rated < 3) {
    deck.innerHTML = `<div class="empty">Rate at least 3 films to get picks.<br><button class="primary" data-go="rate">Start rating</button></div>`;
    setBackdrop(-1);
    return;
  }
  if (recsDirty) {
    friendScores = friend ? E.project(decodeTaste(friend.code)) : null;
    recList = computeRecs();
    recScores = S.scores();
    recsDirty = false;
  }
  const top = recList.slice(0, 3);
  if (!top.length) {
    deck.innerHTML = `<div class="empty">Nothing matches these filters.<br><button class="primary" data-x-open="filters">Change filters</button></div>`;
    return;
  }
  deck.innerHTML = top.map((i, d) => discoverCard(i, d)).reverse().join("");
  setBackdrop(top[0]);
  const card = deck.lastElementChild;
  swipeable(card, { right: true, left: true, up: true }, (dir) => discoverAct(dir), () => openDetails(Number(card.dataset.i)));
}

function discoverCard(i, depth) {
  const cls = depth === 1 ? " under" : depth === 2 ? " under2" : "";
  if (depth) return `<div class="fcard${cls}" data-i="${i}">${poster(i, "w500")}<div class="shade"></div></div>`;
  const sd = S.sd(i), p = E.match(recScores[i], sd);
  const friend = prefs.list === "together" ? activeFriend() : null;
  const pill = friend
    ? `<div style="display:grid;gap:6px;justify-items:end">${matchPill(p, true, "you")}${matchPill(E.match(friendScores[i], Math.sqrt(sd * sd + 0.1)), true, esc(friend.name))}</div>`
    : matchPill(p);
  const why = because(S.support(i, 8));
  return `<div class="fcard" data-i="${i}">
    ${poster(i, "w780")}<div class="shade"></div>
    <div class="ftop"><div class="left">${badges(i)}</div>${pill}</div>
    <div class="stamp" data-dir="right" style="color:var(--accent)">SAVE</div>
    <div class="stamp" data-dir="left">NOPE</div>
    <div class="stamp" data-dir="up" style="color:var(--seen)">SEEN IT</div>
    <div class="finfo">
      <h2>${esc(title(i))}</h2>
      <p class="fsub">${esc(subline(i, true))}</p>
      <div class="frow">${logos(i)}
        ${trailer(i) ? `<button class="chip-btn play" data-nodrag data-trailer="${i}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Trailer</button>` : ""}
        <button class="chip-btn" data-nodrag data-info="${i}">More</button>
      </div>
      ${why ? `<p class="fwhy">${why}</p>` : ""}
    </div>
  </div>`;
}

async function discoverAct(dir) {
  const card = $("deck").querySelector(".fcard:last-child");
  if (!card || card.classList.contains("under")) return;
  const i = Number(card.dataset.i);
  if (dir === "up") {
    card.style.setProperty("--p-up", 1);
    const label = await askRating(i);
    if (!label || !LABELS[label]) { reset(card); return; }
    fly(card, "up");
    setAnswer(i, label);
    toast(`Rated ${title(i)} — picks updated`);
    setTimeout(renderDiscover, 280);
    return;
  }
  fly(card, dir);
  if (dir === "right") toggleWatch(i);
  else { hidden.add(imdbOf(i)); saveAll(); }
  recsDirty = false;
  recList = recList.filter((x) => x !== i);
  toast(dir === "right" ? "Saved to Watchlist" : "Won't show it again", () => {
    if (dir === "right") toggleWatch(i);
    else { hidden.delete(imdbOf(i)); saveAll(); }
    recsDirty = false;
    recList.unshift(i);
    renderDiscover();
  });
  setTimeout(renderDiscover, 260);
}

async function openFilters() {
  const eras = [["any", "Any year"], ["new", "New (last 2 years)"], ["2020", "2020s"], ["2010", "2010s"], ["2000", "2000s"],
    ["1990", "1990s"], ["1980", "1980s"], ["old", "Before 1980"]];
  const lens = [[0, "Any length"], [100, "Under 1h 40m"], [120, "Under 2 hours"], [150, "Under 2h 30m"]];
  const gopts = [[-1, "Any genre"], ...E.meta.genres.map((g, b) => [b, g]).filter(([b]) => genreCount(b) >= 500)];
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`).join("");
  const svc = prefs.services.length ? `${prefs.services.length} service${prefs.services.length > 1 ? "s" : ""} picked` : "Pick your services in the You tab first";
  const friendSel = friends.length > 1 ? `<div class="field"><label>Watch together with</label><select id="f-friend">${opt(friends.map((f) => [f.id, f.name]), activeFriend()?.id)}</select></div>` : "";
  const act = await openSheet(`<h3>Filters</h3><p class="sub">Narrow down your picks.</p>
    <div class="field"><label>Era</label><select id="f-era">${opt(eras, prefs.era)}</select></div>
    <div class="field"><label>Genre</label><select id="f-genre">${opt(gopts, prefs.genre)}</select></div>
    <div class="field"><label>Length</label><select id="f-len">${opt(lens, prefs.maxRuntime)}</select></div>
    ${friendSel}
    <label class="switch"><span>Only what I can stream<small>${esc(svc)}</small></span><input type="checkbox" id="f-stream"${prefs.streamOnly ? " checked" : ""}></label>
    <label class="switch"><span>Include lesser-known films<small>Films with under 2,000 IMDb ratings</small></span><input type="checkbox" id="f-deep"${prefs.deep ? " checked" : ""}></label>
    <div class="stack"><button class="primary" data-x="apply">Show picks</button><button class="cancel" data-x="clear">Clear filters</button></div>`,
  (x) => {
    if (x === "apply") {
      prefs.era = $("f-era").value; prefs.genre = Number($("f-genre").value); prefs.maxRuntime = Number($("f-len").value);
      prefs.streamOnly = $("f-stream").checked; prefs.deep = $("f-deep").checked;
      if ($("f-friend")) prefs.friend = $("f-friend").value;
    }
    if (x === "clear") Object.assign(prefs, { era: "any", genre: -1, maxRuntime: 0, streamOnly: false, deep: false });
    return false;
  });
  if (act === "apply" || act === "clear") { savePrefs(); recsDirty = true; renderDiscover(); }
}

const genreCounts = new Map();
function genreCount(b) {
  if (!genreCounts.has(b)) {
    let n = 0;
    for (const m of E.films.genres) if (m & (1 << b)) n++;
    genreCounts.set(b, n);
  }
  return genreCounts.get(b);
}

// ---------------------------------------------------------------- watchlist, search

function renderWatchCount() {
  const n = watch.length, c = $("watch-count");
  c.hidden = n === 0;
  c.textContent = n > 99 ? "99+" : n;
}

function renderWatch() {
  const sc = S.scores();
  const items = watch.map(idx).filter((i) => i !== undefined).sort((a, b) => sc[b] - sc[a]);
  setBackdrop(items[0] ?? -1);
  $("watch").innerHTML = items.length ? items.map((i) => `<button class="gtile" data-i="${i}">
      ${poster(i, "w342")}<div class="gmatch">${matchPill(E.match(sc[i], S.sd(i)), true)}</div>
      <div class="gt">${esc(title(i))}</div><div class="gs">${esc([year(i), hm(runtime(i))].filter(Boolean).join(" · "))}</div>
      ${logos(i, 5)}</button>`).join("")
    : `<div class="empty" style="grid-column:1/-1">Nothing saved yet.<br>Swipe right on a pick in Discover to save it here.</div>`;
}

function search(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const ol = $("results");
  if (!words.length) { ol.innerHTML = ""; return; }
  searchIndex ??= E.films.title.map(norm);
  const hits = [];
  for (let i = 0; i < E.n; i++) if (words.every((w) => searchIndex[i].includes(w))) hits.push(i);
  const phrase = words.join(" ");
  hits.sort((a, b) => (searchIndex[b].startsWith(phrase) - searchIndex[a].startsWith(phrase))
    || (E.films.votes[b] - E.films.votes[a]));
  ol.innerHTML = hits.slice(0, 30).map(filmRow).join("") || `<li class="empty">No films found.</li>`;
}

function chips(i) {
  const a = labelOf(S.answers.get(i));
  return `<div class="chips">${Object.keys(SHORT).map((k) =>
    `<button class="chip ${k}" data-rate="${k}" aria-pressed="${a === k}" aria-label="${LABELS[k]}">${SHORT[k]}</button>`).join("")}</div>`;
}

function filmRow(i) {
  const saved = watch.includes(imdbOf(i));
  const canSave = S.answers.get(i) == null;
  return `<li class="row" data-i="${i}">${poster(i, "w154")}
    <div class="row-main">
      <div class="row-title">${esc(title(i))}</div><div class="row-sub">${esc(subline(i, true))}</div>
      ${chips(i)}
    </div>
    ${canSave ? `<button class="save-btn${saved ? " on" : ""}" data-save aria-label="${saved ? "Remove from" : "Save to"} watchlist"><svg viewBox="0 0 24 24"><path d="M6.5 3.5h11v17L12 16.5l-5.5 4z"/></svg></button>` : ""}
  </li>`;
}

// ---------------------------------------------------------------- you

function renderMe() {
  $("stats").innerHTML = [[S.rated, "rated"], [watch.length, "saved"], [E.n.toLocaleString(), "films"]]
    .map(([v, l]) => `<div class="stat"><strong>${v}</strong><span>${l}</span></div>`).join("");
  renderScales();
  renderFriends();
  renderServices();
  const rated = answers.filter(([, a]) => a != null).reverse().map(([id]) => idx(id)).filter((i) => i !== undefined);
  $("mine").innerHTML = rated.length ? rated.slice(0, mineShown).map(filmRow).join("") : `<li class="empty">Nothing rated yet.</li>`;
  $("more-mine").hidden = rated.length <= mineShown;
  $("more-mine").textContent = `Show all ${rated.length}`;
  $("unhide").hidden = hidden.size === 0;
  $("unhide").textContent = `Unhide ${hidden.size} film${hidden.size === 1 ? "" : "s"}`;
  $("updated").textContent = `Film data updated ${E.meta.updated}.`;
  setBackdrop(rated[0] ?? -1);
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
    <div style="display:flex;gap:8px"><button class="pill-btn" data-friend-pick="${f.id}">See picks</button><button class="pill-btn" data-friend-remove="${f.id}">Remove</button></div></div>`).join("");
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

function encodeTaste(w) {
  const q = new Int16Array(w.length);
  w.forEach((v, j) => { q[j] = Math.max(-32767, Math.min(32767, Math.round(v * 4096))); });
  return btoa(String.fromCharCode(...new Uint8Array(q.buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeTaste(code) {
  const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const q = new Int16Array(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer);
  return Float64Array.from(q, (v) => v / 4096);
}

async function shareTaste() {
  if (S.rated < 5) return toast("Rate at least 5 films first");
  if (!prefs.name) {
    const act = await openSheet(`<h3>Your name</h3><p class="sub">So your friend knows whose taste it is.</p>
      <div class="field"><input type="text" id="share-name" maxlength="20" placeholder="First name" autocomplete="given-name"></div>
      <button class="primary" style="width:100%" data-x="ok">Continue</button>`, (x) => {
      if (x === "ok") prefs.name = ($("share-name").value || "").trim().slice(0, 20);
      return x === "ok" && !prefs.name;
    });
    if (act !== "ok" || !prefs.name) return;
    savePrefs();
  }
  const url = `${location.origin}${location.pathname}#t=${encodeURIComponent(prefs.name)}~${S.rated}~${encodeTaste(S.mean)}`;
  try {
    if (navigator.share) await navigator.share({ title: "Filmsense", text: `${prefs.name}'s movie taste. Open it to find films we'd both like.`, url });
    else { await navigator.clipboard.writeText(url); toast("Link copied — send it to a friend"); }
  } catch { /* share sheet dismissed */ }
}

function receiveTaste() {
  const m = location.hash.match(/^#t=([^~]+)~(\d+)~([A-Za-z0-9_-]+)$/);
  if (!m) return false;
  history.replaceState(null, "", location.pathname);
  const name = decodeURIComponent(m[1]).slice(0, 20), code = m[3];
  try { if (decodeTaste(code).length !== E.d) return false; } catch { return false; }
  friends = friends.filter((f) => f.name !== name);
  const id = `${Date.now()}`;
  friends.push({ id, name, rated: Number(m[2]), code, added: new Date().toISOString().slice(0, 10) });
  store.set(K.friends, friends);
  prefs.friend = id; prefs.list = "together"; savePrefs();
  recsDirty = true;
  toast(S.rated >= 3 ? `Added ${name}'s taste — here are picks for you both` : `Added ${name}'s taste. Rate 3 films to see picks for you both.`);
  return true;
}

// ---------------------------------------------------------------- import

async function importFile(file) {
  const res = $("import-result");
  res.hidden = false;
  res.textContent = "Reading…";
  try {
    const { ratings, seen, saves, missing } = await readImport(file, E);
    if (!ratings.length && !seen.length && !saves.length) throw new Error("no films found in it");
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
    saveAll();
    rebuild();
    const n = (k, one, many) => `${k.toLocaleString()} ${k === 1 ? one : many}`;
    res.textContent = `Imported ${n(added, "rating", "ratings")}`
      + (seen.length ? `, ${n(seen.length, "watched film", "watched films")}` : "")
      + (saves.length ? `, ${n(saves.length, "watchlist film", "watchlist films")}` : "") + "."
      + (kept ? ` ${n(kept, "film was", "films were")} already rated here, so your answer stays.` : "")
      + (missing ? ` ${n(missing, "film", "films")} couldn't be matched.` : "");
    renderMe();
  } catch (err) {
    res.textContent = `Couldn't import that file: ${err.message}.`;
  }
}

// ---------------------------------------------------------------- navigation

function show(v) {
  view = v;
  document.querySelectorAll(".view").forEach((s) => { s.hidden = s.id !== `view-${v}`; });
  const tab = v === "wall" ? "rate" : v;
  document.querySelectorAll(".tabbar button").forEach((b) => {
    if (b.dataset.view === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  refresh();
  window.scrollTo(0, 0);
}

function refresh() {
  if (view === "rate") renderRate();
  else if (view === "wall") renderWall();
  else if (view === "discover") renderDiscover();
  else if (view === "watch") renderWatch();
  else if (view === "search") { setBackdrop(-1); search($("q").value); }
  else if (view === "me") renderMe();
}

function onboarding() {
  const arrow = (d, color, label) => `<div><svg viewBox="0 0 24 24" style="color:${color}"><path d="${d}"/></svg>${label}</div>`;
  openSheet(`<h3>Swipe to rate</h3><p class="sub">Each answer teaches it your taste. The more you rate, the better your picks.</p>
    <div class="legend">
      ${arrow("M5 12h14M13 6l6 6-6 6", "var(--like)", "Right: liked it")}
      ${arrow("M12 19V5M6 11l6-6 6 6", "var(--love)", "Up: loved it")}
      ${arrow("M19 12H5M11 6l-6 6 6 6", "var(--nope)", "Left: didn't like it")}
      ${arrow("M12 5v14M6 13l6 6 6-6", "var(--meh)", "Down: haven't seen it")}
    </div>
    <div class="stack"><button class="primary" data-x="wall">Start with the poster wall (fastest)</button>
    <button class="cancel" data-x="close">Swipe one by one</button></div>`).then((x) => {
    prefs.onboarded = true; savePrefs();
    if (x === "wall") openWall();
  });
}

function wire() {
  document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  document.querySelectorAll("#view-rate .act").forEach((b) => b.addEventListener("click", () =>
    rateWith(b.dataset.a === "skip" ? null : b.dataset.a)));
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

  document.querySelectorAll("#lists button").forEach((b) => b.addEventListener("click", () => {
    prefs.list = b.dataset.list; savePrefs(); recsDirty = true; renderDiscover();
  }));
  $("filters-btn").addEventListener("click", openFilters);
  document.querySelectorAll("#view-discover .act").forEach((b) => b.addEventListener("click", () => discoverAct(b.dataset.d)));
  $("deck").addEventListener("click", (ev) => {
    const tr = ev.target.closest("[data-trailer]"), info = ev.target.closest("[data-info]");
    if (tr) { const i = Number(tr.dataset.trailer); openDetails(i); playTrailer(i); }
    else if (info) openDetails(Number(info.dataset.info));
    else if (ev.target.closest("[data-x-open]")) openFilters();
  });
  document.addEventListener("click", (ev) => {
    const go = ev.target.closest("[data-go]");
    if (go) show(go.dataset.go);
  });

  $("watch").addEventListener("click", (ev) => {
    const t = ev.target.closest(".gtile");
    if (t) openDetails(Number(t.dataset.i), { inWatchlist: true });
  });
  for (const id of ["results", "mine"]) {
    $(id).addEventListener("click", (ev) => {
      const li = ev.target.closest(".row");
      if (!li) return;
      const i = Number(li.dataset.i);
      if (ev.target.closest("[data-save]")) {
        toast(toggleWatch(i) ? "Saved to Watchlist" : "Removed from Watchlist");
        li.outerHTML = filmRow(i);
        return;
      }
      const btn = ev.target.closest("[data-rate]");
      if (!btn) { if (!ev.target.closest("button")) openDetails(i); return; }
      const same = labelOf(S.answers.get(i)) === btn.dataset.rate;
      setAnswer(i, same ? undefined : btn.dataset.rate);
      li.outerHTML = filmRow(i);
    });
  }
  let t;
  $("q").addEventListener("input", (ev) => { clearTimeout(t); t = setTimeout(() => search(ev.target.value), 120); });

  $("share").addEventListener("click", shareTaste);
  $("friends").addEventListener("click", (ev) => {
    const pick = ev.target.closest("[data-friend-pick]"), rm = ev.target.closest("[data-friend-remove]");
    if (pick) { prefs.friend = pick.dataset.friendPick; prefs.list = "together"; savePrefs(); recsDirty = true; show("discover"); }
    if (rm) { friends = friends.filter((f) => f.id !== rm.dataset.friendRemove); store.set(K.friends, friends); recsDirty = true; renderFriends(); }
  });
  $("services").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-svc]");
    if (!b) return;
    const g = services.get(b.dataset.svc), on = !myServices().has(g.name);
    const set = new Set(prefs.services);
    for (const id of g.ids) { if (on) set.add(id); else set.delete(id); }
    prefs.services = [...set]; savePrefs(); recsDirty = true;
    b.setAttribute("aria-pressed", String(on));
  });
  $("import-file").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file) importFile(file);
    ev.target.value = "";
  });
  $("more-mine").addEventListener("click", () => { mineShown = Infinity; renderMe(); });
  $("unhide").addEventListener("click", () => { hidden.clear(); saveAll(); renderMe(); });
  $("reset").addEventListener("click", () => {
    if (!confirm("Delete all your ratings, watchlist and imports, and start over?")) return;
    answers = []; hidden.clear(); watch = []; seenOnly.clear(); rateQueue = []; saveQueue(); saveAll();
    prefs.seed = newSeed(); savePrefs(); rebuild(); show("rate");
  });
}

// ---------------------------------------------------------------- start

async function start() {
  // iOS Safari ignores user-scalable=no, so block its pinch gesture directly (see app.css).
  for (const g of ["gesturestart", "gesturechange"]) document.addEventListener(g, (ev) => ev.preventDefault(), { passive: false });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  try {
    E = await loadEngine("data/", (done, total) => { $("loading-bar").style.width = `${(done / total) * 100}%`; });
  } catch (err) {
    $("loading-text").textContent = `Couldn't load films (${err.message}). Check your connection and reopen the app.`;
    return;
  }
  if (prefs.seed == null) { prefs.seed = newSeed(); savePrefs(); }
  rebuild();
  rateQueue = store.get(K.queue, []).map(idx).filter((i) => i !== undefined);
  wire();
  renderWatchCount();
  $("loading").hidden = true;
  $("app").hidden = false;
  const got = receiveTaste();
  show(got && S.rated >= 3 ? "discover" : S.rated >= 3 && location.hash !== "#rate" ? "discover" : "rate");
  if (!prefs.onboarded && !answers.length && !got) onboarding();
  const json = (f) => fetch(`data/${f}`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [p, x] = await Promise.all([json("posters.json"), json("extras.json")]);
  if (p) posters = p;
  if (x) { extras = x; buildServices(); }
  recsDirty = true;
  refresh();
}

start();
