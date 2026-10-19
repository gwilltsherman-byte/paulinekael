import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { File } from "node:buffer";
import { Session } from "../web/engine.js";
import { Titles } from "../web/search.js";
import { makeEngine } from "./helpers.mjs";

// Exercise the real app functions, with only browser IO replaced. No app startup,
// downloads or timers are needed to test persistence and recommendation eligibility.
const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/\nstart\(\);\s*$/, "");
const NOW = Date.UTC(2026, 9, 19, 6);
const DAY = 24 * 60 * 60 * 1000;
const SKIPS = "mt.snoozed.v1";
const plain = (value) => JSON.parse(JSON.stringify(value));

function app({ data = {}, rated = true, engine = makeEngine({ n: 80, pool: 30 }) } = {}) {
  let now = NOW, failWrites = false, reloaded = false, sharedFile, timerId = 0;
  const stored = new Map(Object.entries(data).map(([key, value]) => [key, JSON.stringify(value)]));
  const elements = new Map(), timers = new Map();
  const document = {
    activeElement: null,
    querySelectorAll: () => [],
    addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
  };
  function element(id) {
    const listeners = new Map(), controls = new Map();
    const el = {
      id, listeners, innerHTML: "", textContent: "", hidden: true, dataset: {}, value: "",
      style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(name, handler) { listeners.set(name, handler); },
      querySelectorAll: () => [],
      querySelector(selector) {
        if (!controls.has(selector)) controls.set(selector, { focus() { document.activeElement = this; } });
        return controls.get(selector);
      },
      focus() { document.activeElement = this; },
      setAttribute() {}, removeAttribute() {},
    };
    return el;
  }
  document.body = element("body");
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({
    document, Date: Clock, Session, Titles, File,
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem(key, value) { if (failWrites) throw new Error("Storage full"); stored.set(key, value); },
      removeItem: (key) => stored.delete(key),
    },
    sessionStorage: { setItem() {} },
    location: { reload() { reloaded = true; } },
    navigator: { storage: {}, canShare: () => true, share: async ({ files }) => { sharedFile = files[0]; } },
    window: { addEventListener() {} },
    confirm: () => true,
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(`${source}\n globalThis.app = {
    setup(engine, rated) {
      E = engine; view = "home";
      answers = rated ? [[imdbOf(0), "loved"], [imdbOf(1), "liked"], [imdbOf(2), "meh"]] : [];
      rebuild(); renderHome();
    },
    homeSkip, renderHome, moreLike, tonightPicks, browseList, renderBrowse, search, saveBackup, toast,
    setBrowse(items) { browsing = { title: "Test picks", items }; },
    state() { return { home, snoozed: [...snoozed], answers, hidden: [...hidden], watch,
      seen: [...seenOnly], rated: S.rated, mean: [...S.mean], cov: [...S.cov] }; },
    similar(i) { return moreLike(i, S.scores()); },
    async restore(data, action) {
      openSheet = async () => action;
      await restoreBackup({ text: async () => JSON.stringify({ app: "kael", version: 1, data }) });
    },
    reset() {
      wire();
      renderRate = () => {};
      $("reset").listeners.get("click")();
    }
  };`, context);
  engine.films.year.fill(2026);
  engine.films.votes.fill(25000);
  context.app.setup(engine, rated);
  return {
    api: context.app, engine, elements,
    read: (key) => JSON.parse(stored.get(key) ?? "null"),
    data: () => Object.fromEntries([...stored].map(([key, value]) => [key, JSON.parse(value)])),
    clock(value) { now = value; },
    failStorage(value = true) { failWrites = value; },
    undo() { elements.get("toast").querySelector("button").onclick(); },
    dismiss() { elements.get("toast").querySelector("[data-toast-dismiss]").onclick(); },
    get activeElement() { return document.activeElement; },
    get pendingTimers() { return [...timers.values()]; },
    get reloaded() { return reloaded; },
    get sharedFile() { return sharedFile; },
  };
}

test("skipping replaces the hero for 90 days without changing taste or library state", () => {
  const h = app(), before = plain(h.api.state()), i = before.home.hero;
  h.api.setBrowse([i, ...before.home.pool.filter((j) => j !== i).slice(0, 3)]);
  h.api.homeSkip(i);
  const after = plain(h.api.state());
  assert.deepEqual(h.read(SKIPS), [[h.engine.films.imdb[i], NOW + 90 * DAY]]);
  for (const key of ["answers", "hidden", "watch", "seen", "rated", "mean", "cov"]) {
    assert.deepEqual(after[key], before[key], `${key} must not change`);
  }
  assert.notEqual(after.home.hero, i);
  assert.ok(!after.home.pool.includes(i));
  assert.ok(after.home.shelves.every((shelf) => !shelf.items.includes(i)));
  assert.ok(!h.api.tonightPicks({ mood: "any", time: 0, mine: false, who: "me" }).includes(i));
  assert.ok(!h.api.similar((i + 1) % h.engine.n).includes(i));
  assert.ok(!h.api.browseList(() => true).includes(i));
  h.api.renderBrowse();
  assert.doesNotMatch(h.elements.get("results").innerHTML, new RegExp(`data-i="${i}"`));
  h.api.search(h.engine.films.title[i]);
  assert.match(h.elements.get("results").innerHTML, new RegExp(`data-i="${i}"`), "direct search still finds skipped films");
});

test("a cached Home keeps the skip before the deadline and restores eligibility at the boundary", () => {
  const h = app(), i = h.api.state().home.hero;
  h.api.homeSkip(i);
  h.clock(NOW + 90 * DAY - 1);
  h.api.renderHome();
  assert.ok(!h.api.state().home.pool.includes(i));
  h.clock(NOW + 90 * DAY);
  h.api.renderHome();
  assert.ok(h.api.state().home.pool.includes(i));
  assert.equal(h.api.state().home.hero, i);
  assert.deepEqual(h.read(SKIPS), []);
});

test("persisted skips follow IMDb IDs when the film catalogue is reordered", () => {
  const first = app(), i = first.api.state().home.hero;
  first.api.homeSkip(i);
  const engine = makeEngine({ n: 80, pool: 30 });
  const j = i === 79 ? 78 : 79, id = engine.films.imdb[i];
  [engine.films.imdb[i], engine.films.imdb[j]] = [engine.films.imdb[j], engine.films.imdb[i]];
  engine.byImdb = new Map(engine.films.imdb.map((imdb, index) => [imdb, index]));
  const reloaded = app({ data: first.data(), engine });
  assert.equal(engine.films.imdb[j], id);
  assert.ok(!reloaded.api.state().home.pool.includes(j));
  assert.ok(reloaded.api.state().home.pool.includes(i));
});

test("malformed and expired saved skips cannot break opening the app or hide valid picks", () => {
  const h = app({ data: { [SKIPS]: [null, {}, [1004, "later"], [-1, NOW + DAY], [1005, Infinity],
    [1006, 8640000000000001], [1007, NOW], [1008, NOW + DAY]] } });
  assert.deepEqual(plain(h.api.state().snoozed), [[1008, NOW + DAY]]);
  assert.ok(h.api.state().home.pool.includes(7));
  assert.ok(!h.api.state().home.pool.includes(8));
});

test("Undo persists the previous eligibility and brings the original hero back", () => {
  const h = app(), i = h.api.state().home.hero;
  h.api.homeSkip(i);
  h.undo();
  assert.deepEqual(h.read(SKIPS), []);
  assert.equal(h.api.state().home.hero, i);
  assert.equal(app({ data: h.data() }).api.state().home.hero, i);

  const until = NOW + DAY, previous = app({ data: { [SKIPS]: [[1005, until]] } });
  previous.api.homeSkip(5);
  previous.undo();
  assert.deepEqual(previous.read(SKIPS), [[1005, until]], "Undo restores an existing earlier deadline");
});

test("skip confirmation keeps Undo focused until Undo or Dismiss returns focus to the next pick", () => {
  const h = app(), i = h.api.state().home.hero;
  h.api.toast("Earlier status");
  assert.equal(h.pendingTimers.length, 1, "ordinary notifications still expire");
  h.api.homeSkip(i);
  const toast = h.elements.get("toast"), undo = toast.querySelector("button");
  const dismiss = toast.querySelector("[data-toast-dismiss]");
  const nextPick = h.elements.get("home").querySelector("[data-skip], [data-tonight]");
  assert.notEqual(undo, dismiss);
  assert.equal(h.activeElement, undo);
  assert.equal(toast.hidden, false);
  assert.equal(h.pendingTimers.length, 0, "the prior timeout is cancelled and Undo has no time limit");
  assert.match(toast.innerHTML, /data-toast-dismiss/);

  h.dismiss();
  assert.equal(toast.hidden, true);
  assert.equal(h.activeElement, nextPick);
  assert.deepEqual(h.read(SKIPS), [[h.engine.films.imdb[i], NOW + 90 * DAY]]);

  const next = h.api.state().home.hero;
  h.api.homeSkip(next);
  assert.equal(h.activeElement, undo);
  h.undo();
  assert.equal(toast.hidden, true);
  assert.equal(h.activeElement, nextPick);
  assert.equal(h.api.state().home.hero, next);
});

test("a failed storage write neither skips a film nor falsely undoes a saved skip", () => {
  const h = app(), before = plain(h.api.state()), i = before.home.hero;
  h.failStorage();
  h.api.homeSkip(i);
  assert.deepEqual(plain(h.api.state()), before);
  assert.equal(h.read(SKIPS), null);
  assert.match(h.elements.get("toast").innerHTML, /save on this device/);
  h.failStorage(false);
  h.api.homeSkip(i);
  h.failStorage();
  h.undo();
  assert.ok(!h.api.state().home.pool.includes(i));
  assert.deepEqual(h.read(SKIPS), [[h.engine.films.imdb[i], NOW + 90 * DAY]]);
});

test("popular picks shown before three ratings respect persisted skips", () => {
  const h = app({ rated: false, data: { [SKIPS]: [[1000, NOW + DAY]] } });
  assert.ok(!h.api.browseList(() => true).includes(0));
  assert.doesNotMatch(h.elements.get("home").innerHTML, /data-(?:info|i)="0"/);
  assert.match(h.elements.get("home").innerHTML, /data-info="1"/);
});

test("backups export skips, merge the furthest deadline, and ignore expired entries", async () => {
  const h = app({ data: { [SKIPS]: [[1005, NOW + 10 * DAY]] } });
  await h.api.saveBackup();
  const saved = JSON.parse(await h.sharedFile.text());
  assert.deepEqual(saved.data[SKIPS], [[1005, NOW + 10 * DAY]]);
  await h.api.restore({ [SKIPS]: [[1005, NOW + 20 * DAY], [1005, NOW + 5 * DAY],
    [1006, NOW + DAY], [1007, NOW - DAY]] }, "merge");
  assert.deepEqual(h.read(SKIPS), [[1005, NOW + 20 * DAY], [1006, NOW + DAY]]);
  assert.equal(h.reloaded, true);
});

test("backup replace restores skips and legacy backup handling preserves merge versus replace semantics", async () => {
  const initial = { [SKIPS]: [[1005, NOW + DAY]] };
  const replacement = app({ data: initial });
  await replacement.api.restore({ [SKIPS]: [[1006, NOW + 2 * DAY]], "mt.answers.v1": [] }, "replace");
  assert.deepEqual(replacement.read(SKIPS), [[1006, NOW + 2 * DAY]]);
  const merged = app({ data: initial });
  await merged.api.restore({ "mt.answers.v1": [] }, "merge");
  assert.deepEqual(merged.read(SKIPS), initial[SKIPS]);
  const replaced = app({ data: initial });
  await replaced.api.restore({ "mt.answers.v1": [] }, "replace");
  assert.equal(replaced.read(SKIPS), null);
});

test("starting over removes saved skips together with the profile", () => {
  const h = app({ data: { [SKIPS]: [[1005, NOW + DAY]] } });
  h.api.reset();
  assert.deepEqual(h.read(SKIPS), []);
  assert.deepEqual(plain(h.api.state().snoozed), []);
  assert.equal(h.api.state().rated, 0);
});
