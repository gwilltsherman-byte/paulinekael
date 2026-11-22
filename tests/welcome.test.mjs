import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Session } from "../web/engine.js";
import { readImport } from "../web/importer.js";
import { Titles } from "../web/search.js";
import { makeEngine } from "./helpers.mjs";

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/\nstart\(\);\s*$/, "");

function setup() {
  const elements = new Map(), saved = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { id, value: "", dataset: {}, style: { setProperty() {} },
      querySelector: () => null, contains: () => false, focus() {}, classList: { remove() {}, toggle() {} } });
    return elements.get(id);
  }
  const document = { getElementById: element, querySelectorAll: () => [], body: element("body") };
  const location = { hash: "", pathname: "/", search: "?open=1" };
  const history = { replaceState(_state, _title, path) { assert.equal(path, "/?open=1"); location.hash = ""; } };
  const engine = makeEngine({ n: 20, k: 4, pool: 10 });
  const context = vm.createContext({ document, location, history, Session, Titles, readImport, navigator: { storage: {} },
    localStorage: { getItem: (key) => saved.get(key), setItem: (key, text) => saved.set(key, text) },
    clearTimeout() {}, setTimeout() {}, console });
  vm.runInContext(source + `\n globalThis.api = {
    start(engine) {
      E = engine; fullReady = false; view = "settings"; rebuild();
      renderSettings = () => {}; toast = () => {};
    },
    onLoad(loader) { loadEverything = async () => { await loader(); fullReady = true; }; },
    ensureCatalogue, importFile, resetImport, renderHome, show, openLinkedView, search, setRating,
    answers: () => [...S.answers], get diaryCount() { return diary.length; },
  };`, context);
  context.api.start(engine);
  return { app: context.api, element, location, saved };
}

function ratingsFile(rows = "tt0001003,9\ntt0001004,7") {
  return { name: "ratings.csv", type: "text/csv", text: async () => "Const,Your Rating\n" + rows };
}

test("a welcome import waits for the in-flight catalogue and reads the chosen file once", async () => {
  const { app, element } = setup();
  let finish, requests = 0;
  app.onLoad(() => { requests++; return new Promise((resolve) => { finish = resolve; }); });
  const background = app.ensureCatalogue();
  const importing = app.importFile(ratingsFile());
  assert.equal(requests, 1);
  assert.equal(element("import-file").disabled, true);
  assert.match(element("home-import-result").textContent, /Waiting for the film catalogue/);
  assert.equal(app.answers().length, 0);
  await app.importFile(ratingsFile());
  finish();
  await Promise.all([background, importing]);
  assert.equal(requests, 1);
  assert.deepEqual(Array.from(app.answers(), (r) => Array.from(r)), [[3, 4.5], [4, 3.5]]);
  assert.equal(element("import-file").disabled, false);
  assert.equal(element("home-import-result").textContent, "Imported 2 ratings.");
  assert.equal(element("import-result").textContent, element("home-import-result").textContent);
});

test("a failed catalogue load releases the file picker and a new selection can retry", async () => {
  const { app, element } = setup();
  app.onLoad(() => { throw new Error("offline"); });
  await app.importFile(ratingsFile());
  assert.match(element("home-import-result").textContent, /Reconnect/);
  assert.equal(element("import-file").disabled, false);
  assert.equal(app.answers().length, 0);
  app.onLoad(async () => {});
  await app.importFile(ratingsFile());
  assert.equal(app.answers().length, 2);
  assert.equal(element("import-result").textContent, "Imported 2 ratings.");
});

test("starting over cancels an import that was waiting for the catalogue", async () => {
  const { app, element } = setup();
  let finish;
  app.onLoad(() => new Promise((resolve) => { finish = resolve; }));
  const pending = app.importFile(ratingsFile());
  app.resetImport();
  finish();
  await pending;
  assert.equal(element("import-file").disabled, false);
  assert.equal(element("home-import-result").hidden, true);
  assert.equal(app.answers().length, 0);
});

test("known-title onboarding rates search results in the quick pool and unlocks picks at three", () => {
  const { app, element } = setup();
  app.renderHome();
  assert.match(element("home").innerHTML, /data-known-titles/);
  assert.match(element("home").innerHTML, /type="file" data-import-ratings/);
  assert.match(element("home").innerHTML, /href="#imdb-import">Import IMDb ratings/);
  app.show("search", { knownTitles: true });
  assert.equal(element("search-heading").textContent, "Rate films I know");
  element("q").value = "Film 3";
  app.search(element("q").value);
  assert.match(element("results").innerHTML, /data-i="3"/);
  assert.match(element("results").innerHTML, /data-set="loved"/);
  assert.equal(element("known-picks").hidden, true);
  app.setRating(3, "loved");
  app.setRating(4, "liked");
  app.setRating(5, "meh");
  assert.equal(element("known-picks").hidden, false);
  assert.equal(app.diaryCount, 0);
  assert.equal(app.answers().length, 3);
  app.show("search");
  assert.equal(element("known-picks").hidden, true);
  assert.equal(element("search-heading").textContent, "Find your next film");
});

test("the linked IMDb screen imports, preserves existing scores on retry, and enables picks", async () => {
  const { app, element, location } = setup();
  location.hash = "#imdb-import";
  assert.equal(app.openLinkedView(), true);
  assert.equal(element("body").dataset.view, "imdb-import");
  assert.equal(element("imdb-back").dataset.go, "settings");
  assert.equal(element("imdb-picks").hidden, true);
  app.onLoad(async () => {});
  await app.importFile(ratingsFile("tt9999999,9\ntt0001003,"), "imdb");
  assert.match(element("imdb-result").textContent, /No ratings imported.*1 title.*1 row/);
  assert.equal(element("imdb-file").disabled, false);
  await app.importFile(ratingsFile("tt0001003,8\ntt0001004,6\ntt0001005,10"), "imdb");
  assert.equal(element("imdb-result").textContent, "Imported 3 ratings.");
  assert.equal(element("imdb-picks").hidden, false);
  await app.importFile(ratingsFile(), "imdb");
  assert.match(element("imdb-result").textContent, /Nothing new to import.*2 films were already rated/);
  assert.deepEqual(Array.from(app.answers(), r => Array.from(r)), [[3, 4], [4, 3], [5, 5]]);
  app.show("settings");
  assert.equal(location.hash, "");
});
