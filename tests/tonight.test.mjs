import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Session } from "../web/engine.js";
import { makeEngine } from "./helpers.mjs";

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/\nstart\(\);\s*$/, "");
const PREFS = "mt.prefs.v1";

function app(preferences = {}, friend = null) {
  const data = new Map([[PREFS, JSON.stringify(preferences)]]);
  const dialog = {}, card = {}, checkbox = { checked: false };
  const engine = makeEngine({ n: 70, pool: 30, meta: { genres: ["Comedy"] } });
  engine.films.genres.fill(1);
  const context = vm.createContext({
    Session, engine, friend, dialog, card,
    localStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    },
    document: { addEventListener() {}, getElementById: (id) => id === "sheet-card" ? card : id === "tn-mine" ? checkbox : {} },
    window: { addEventListener() {} },
    setTimeout() {}, clearTimeout() {},
    decodeTaste: () => Array(engine.d).fill(0),
  });
  vm.runInContext(source + `
    E = engine;
    S = new Session(E, [[0, "loved"], [1, "liked"], [2, "meh"]]);
    for (let i = 0; i < E.n; i++) extras.films[i] = ["", [7], "", 90];
    activeFriend = () => friend;
    toast = () => {};
    closeFilm = () => {};
    refresh = () => {};
    dialog.hideFilm = (index) => { filmI = index; return filmAction("hide"); };
    replaceContent = (el, html) => { el.innerHTML = html; };
    openSheet = (html, click) => {
      card.innerHTML = html;
      dialog.click = click;
      return new Promise(resolve => { dialog.close = resolve; });
    };
    dialog.open = openTonight;
  `, context);
  return { dialog, card, checkbox, prefs: () => JSON.parse(data.get(PREFS)) };
}

test("Tonight opens directly on three picks and persists only applied filters", async () => {
  const guest = { id: "guest-one", name: "Sam" };
  const { dialog, card, checkbox, prefs } = app({ services: [7] }, guest);
  const open = dialog.open();
  assert.equal((card.innerHTML.match(/class="tn-title"/g) || []).length, 3);
  assert.match(card.innerHTML, /Edit filters/);
  assert.match(card.innerHTML, /My services/);
  dialog.click("change");
  checkbox.checked = false;
  dialog.click("opt:mood:laugh");
  dialog.click("opt:time:100");
  dialog.click("opt:who:friend");
  dialog.click("go");
  assert.match(card.innerHTML, /Make me laugh · Under 1h 40m · Sam/);
  assert.deepEqual(prefs().tonight, { mood: "laugh", time: 100, mine: false, friendId: guest.id });
  dialog.click("change");
  dialog.click("opt:mood:scare");
  dialog.close();
  await open;
  assert.equal(prefs().tonight.mood, "laugh");

  const returning = app(prefs(), guest);
  const reopened = returning.dialog.open();
  assert.match(returning.card.innerHTML, /Make me laugh · Under 1h 40m · Sam/);
  assert.equal((returning.card.innerHTML.match(/class="tn-title"/g) || []).length, 3);
  returning.dialog.close();
  await reopened;
});

test("unsupported filters and a different companion cannot silently change the ranking context", async () => {
  const { dialog, card } = app({ services: [], tonight: { mood: "retired", time: "oops", mine: true, friendId: "old" } }, { id: "new", name: "Jo" });
  const open = dialog.open();
  assert.match(card.innerHTML, /Surprise me/);
  assert.doesNotMatch(card.innerHTML, /My services|Jo|old|retired/);
  dialog.click("change");
  assert.match(card.innerHTML, /data-x="opt:who:me" aria-pressed="true"/);
  assert.match(card.innerHTML, /data-x="opt:time:0" aria-pressed="true"/);
  dialog.close();
  await open;
});

test("empty filtered results keep Edit available and preserve the explicit service choice", async () => {
  const { dialog, card, prefs } = app({ services: [8], tonight: { time: 100, mine: true } });
  const open = dialog.open();
  assert.match(card.innerHTML, /No films match these filters/);
  assert.match(card.innerHTML, /Edit filters/);
  assert.equal(prefs().tonight.mine, true);
  dialog.close();
  await open;
});

test("Tonight excludes films just saved or hidden from the cached Home pool", async () => {
  const { dialog, card } = app();
  const first = dialog.open();
  const [saved, hidden] = [...card.innerHTML.matchAll(/class="tn-title" data-x="open:(\d+)"/g)]
    .map((match) => Number(match[1]));
  dialog.click("save:" + saved);
  assert.match(card.innerHTML, new RegExp('data-x="save:' + saved + '" aria-pressed="true"'));
  dialog.close();
  await first;
  await dialog.hideFilm(hidden);

  const reopened = dialog.open();
  assert.equal((card.innerHTML.match(/class="tn-title"/g) || []).length, 3);
  for (const excluded of [saved, hidden]) assert.ok(!card.innerHTML.includes('data-x="open:' + excluded + '"'));
  dialog.close();
  await reopened;
});
