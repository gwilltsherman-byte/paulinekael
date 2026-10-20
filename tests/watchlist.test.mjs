import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Session } from "../web/engine.js";
import { Titles } from "../web/search.js";
import { makeEngine } from "./helpers.mjs";

// The real app functions, with only browser IO replaced (as in snooze.test.mjs).
const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/\nstart\(\);\s*$/, "");
const WATCH = "mt.watch.v1";

function app(saved) {
  const engine = makeEngine({ n: 80, pool: 30 });
  const stored = new Map([[WATCH, JSON.stringify(saved.map((i) => engine.films.imdb[i]))]]);
  const elements = new Map();
  const element = (id) => {
    const controls = new Map();
    return {
      id, innerHTML: "", textContent: "", hidden: true, dataset: {}, value: "",
      style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {}, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {}, focus() {},
      querySelector(selector) {
        if (!controls.has(selector)) controls.set(selector, { textContent: "", disabled: false, focus() {} });
        return controls.get(selector);
      },
    };
  };
  const document = {
    querySelectorAll: () => [], addEventListener() {},
    getElementById: (id) => elements.get(id) ?? elements.set(id, element(id)).get(id),
  };
  document.body = element("body");
  const context = vm.createContext({
    document, Session, Titles,
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
    sessionStorage: { setItem() {} }, navigator: { storage: {} }, window: { addEventListener() {} },
    setTimeout: () => 0, clearTimeout() {},
  });
  vm.runInContext(`${source}\n globalThis.app = {
    setup(engine) { E = engine; view = "lib"; rebuild(); },
    pick(list) { watchSel = new Set(list); renderWatch(); },
    removeWatch, renderWatch, imdbOf, get watchSel() { return watchSel; },
  };`, context);
  context.app.setup(engine);
  return {
    api: context.app, elements,
    saved: () => JSON.parse(stored.get(WATCH)).map((id) => engine.films.imdb.indexOf(id)),
    undo() { elements.get("toast").querySelector("button").onclick(); },
  };
}

test("several films come off the Watchlist at once, and Undo puts them back in order", () => {
  const h = app([5, 6, 7, 8, 9]);
  h.api.removeWatch([6, 8, 9].map(h.api.imdbOf));
  assert.deepEqual(h.saved(), [5, 7]);
  assert.match(h.elements.get("toast").innerHTML, /Removed 3 films from Watchlist/);
  h.undo();
  assert.deepEqual(h.saved(), [5, 6, 7, 8, 9]);
});

test("choosing films shows how many will be removed", () => {
  const h = app([5, 6, 7]);
  h.api.pick([5, 7]);
  const bar = h.elements.get("watch-bar"), remove = bar.querySelector('[data-wsel="remove"]');
  assert.equal(bar.hidden, false);
  assert.equal(h.elements.get("watch-sort").hidden, true);
  assert.equal(h.elements.get("watch-n").textContent, "2 selected");
  assert.equal(remove.textContent, "Remove 2");
  assert.equal(remove.disabled, false);
  assert.equal((h.elements.get("watch").innerHTML.match(/aria-pressed="true"/g) || []).length, 2);
  h.api.pick([]);
  assert.equal(remove.disabled, true);
});

test("removing nothing leaves the Watchlist and toast alone", () => {
  const h = app([5, 6]);
  h.api.removeWatch([]);
  assert.deepEqual(h.saved(), [5, 6]);
  assert.equal(h.elements.get("toast")?.innerHTML ?? "", "");
});
