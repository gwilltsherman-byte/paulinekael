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
      querySelector: () => null, contains: () => false, classList: { remove() {}, toggle() {} } });
    return elements.get(id);
  }
  const document = { getElementById: element, querySelectorAll: () => [], body: element("body") };
  const engine = makeEngine({ n: 20, k: 4, pool: 10 });
  const context = vm.createContext({ document, Session, Titles, readImport, navigator: { storage: {} },
    localStorage: { getItem: (key) => saved.get(key), setItem: (key, text) => saved.set(key, text) },
    clearTimeout() {}, setTimeout() {}, console });
  vm.runInContext(source + `\n globalThis.api = {
    start(engine) {
      E = engine; fullReady = false; view = "settings"; rebuild();
      renderSettings = () => {}; toast = () => {};
    },
    onLoad(loader) { loadEverything = async () => { await loader(); fullReady = true; }; },
    ensureCatalogue, importFile, resetImport, renderHome, show, search, setRating,
    answers: () => [...S.answers], get diaryCount() { return diary.length; },
  };`, context);
  context.api.start(engine);
  return { app: context.api, element, saved };
}

function ratingsFile() {
  return { name: "ratings.csv", type: "text/csv", text: async () => "Const,Your Rating\ntt1003,9\ntt1004,7" };
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
