import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Session } from "../web/engine.js";
import { Titles } from "../web/search.js";
import { makeEngine } from "./helpers.mjs";

// The real app functions, with only browser IO replaced (as in watchlist.test.mjs).
const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/\nstart\(\);\s*$/, "");
const ANSWERS = "mt.answers.v1", FAVS = "mt.favs.v1";
const META = { fav_lift: 1.5, fav_noise: 1, fav_ref: [0, 0, 0, 0, 0, 0, 1], fav_ref_b: 0 };

/** rated: [[film, answer], ...]; favs: films. Films are indices; storage holds IMDb ids. */
function app({ rated = [], favs = [] } = {}) {
  const engine = makeEngine({ n: 80, pool: 30, meta: META }), id = (i) => engine.films.imdb[i];
  const stored = new Map([[ANSWERS, JSON.stringify(rated.map(([i, a]) => [id(i), a]))], [FAVS, JSON.stringify(favs.map(id))]]);
  const elements = new Map();
  const element = (name) => {
    const controls = new Map();
    return {
      id: name, innerHTML: "", textContent: "", hidden: true, dataset: {}, value: "",
      style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {}, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {}, focus() {}, contains: () => false,
      querySelector(selector) {
        if (!controls.has(selector)) controls.set(selector, { textContent: "", disabled: false, focus() {} });
        return controls.get(selector);
      },
    };
  };
  const document = {
    querySelectorAll: () => [], addEventListener() {},
    getElementById: (name) => elements.get(name) ?? elements.set(name, element(name)).get(name),
  };
  document.body = element("body");
  const context = vm.createContext({
    document, Session, Titles,
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
    sessionStorage: { setItem() {} }, navigator: { storage: {} }, window: { addEventListener() {} },
    setTimeout: () => 0, clearTimeout() {},
  });
  vm.runInContext(`${source}\n globalThis.app = {
    setup(engine) { E = engine; view = "me"; refresh = () => {}; rebuild(); },
    toggleFav, setRating, renderFavs, get favs() { return favs; }, get answers() { return answers; }, get S() { return S; },
  };`, context);
  context.app.setup(engine);
  const ids = (list) => [...list].map((x) => engine.films.imdb.indexOf(x));
  return {
    api: context.app, engine, elements,
    favs: () => ids(context.app.favs),
    stored: () => ids(JSON.parse(stored.get(FAVS))),
    answer: (i) => context.app.answers.find(([x]) => x === id(i))?.[1],
    toast: () => elements.get("toast").innerHTML,
    undo() { elements.get("toast").querySelector("button").onclick(); },
    /** Tap a button in the open sheet (data-x value). */
    choose(x) {
      elements.get("sheet").onclick({ target: { closest: (sel) => (sel === "[data-x]" ? { dataset: { x } } : null) } });
    },
  };
}

test("making an unrated film a favourite rates it Loved it, and Undo takes both back", () => {
  const h = app({ rated: [[1, "liked"]] });
  h.api.toggleFav(5);
  assert.deepEqual(h.favs(), [5]);
  assert.deepEqual(h.stored(), [5]);
  assert.equal(h.answer(5), "loved");
  assert.equal(h.api.S.favs.has(5), true);
  assert.match(h.toast(), /is a favourite, rated Loved it/);
  h.undo();
  assert.deepEqual(h.favs(), []);
  assert.equal(h.answer(5), undefined);
});

test("a film you loved becomes a favourite as it is, and the favourite shapes your profile", () => {
  const rated = [[5, "loved"], [6, "liked"], [7, "disliked"]], h = app({ rated });
  const plain = new Session(h.engine, rated);
  h.api.toggleFav(5);
  assert.equal(h.answer(5), "loved");
  assert.ok(h.api.S.mean.some((v, u) => Math.abs(v - plain.mean[u]) > 1e-6), "the profile changed");
  h.api.toggleFav(5);
  assert.deepEqual(h.favs(), []);
  assert.match(h.toast(), /is no longer a favourite/);
  h.api.S.mean.forEach((v, u) => assert.ok(Math.abs(v - plain.mean[u]) < 1e-12));
});

test("with five favourites, a sixth swaps out the one you choose, or nothing if you cancel", async () => {
  const rated = [0, 1, 2, 3, 4, 5].map((i) => [i, "loved"]), h = app({ rated, favs: [0, 1, 2, 3, 4] });
  let pending = h.api.toggleFav(5);
  h.choose("close");
  await pending;
  assert.deepEqual(h.favs(), [0, 1, 2, 3, 4]);
  pending = h.api.toggleFav(5);
  h.choose(`fav:${h.engine.films.imdb[2]}`);
  await pending;
  assert.deepEqual(h.favs(), [0, 1, 5, 3, 4]);
  h.undo();
  assert.deepEqual(h.favs(), [0, 1, 2, 3, 4]);
});

test("rating a favourite lower takes it off the list, and Undo puts it back", () => {
  const h = app({ rated: [[5, "loved"], [6, "loved"]], favs: [6, 5] });
  h.api.setRating(6, "liked");
  assert.deepEqual(h.favs(), [5]);
  assert.match(h.toast(), /Changed to Liked\. No longer a favourite/);
  h.undo();
  assert.deepEqual(h.favs(), [6, 5]);
  assert.equal(h.answer(6), "loved");
});

test("stored favourites are checked: repeats, more than five, and films not loved are dropped", () => {
  const rated = [[5, "loved"], [6, 5], [7, "liked"], [8, "loved"], [9, 4.5], [10, "loved"]];
  const h = app({ rated, favs: [5, 5, 6, 7, 8, 9, 10] });
  assert.deepEqual(h.favs(), [5, 6, 8, 9]);
  assert.deepEqual(h.stored(), [5, 6, 8, 9]);
});

test("Your taste shows the favourites numbered, with a free slot for each one left", () => {
  const h = app({ rated: [[5, "loved"], [6, "loved"]], favs: [6, 5] });
  h.api.renderFavs();
  const html = h.elements.get("favs").innerHTML;
  assert.match(html, /aria-label="Number 1: Film 6"[\s\S]*aria-label="Number 2: Film 5"/);
  assert.equal((html.match(/data-fav-add/g) || []).length, 3);
});
