import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Session } from "../web/engine.js";
import { makeEngine } from "./helpers.mjs";

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/\nstart\(\);\s*$/, "");

function fixture() {
  const engine = makeEngine({ n: 60, pool: 30 });
  const stored = new Map(), elements = new Map(), cards = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, { textContent: "", hidden: false });
    return elements.get(id);
  }
  // The stage models card promotion. No images ever load and no timers fire.
  const stage = {
    append: (card) => cards.push(card), prepend: (card) => cards.unshift(card),
    querySelector: (s) => cards.find((c) => s.startsWith(".fcard." + c.kind)),
  };
  elements.set("rate-stage", stage);
  const card = (i, kind) => {
    const node = { kind, dataset: { i: String(i) }, inert: kind !== "front",
      classList: { add: (v) => { node.kind = v; }, remove: () => {} },
      remove: () => cards.splice(cards.indexOf(node), 1),
    };
    return node;
  };
  const context = vm.createContext({
    Session, engine, card, document: { getElementById: element },
    clearTimeout() {}, setTimeout() { return 1; },
    navigator: { onLine: false }, localStorage: {
      getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v),
    },
  });
  vm.runInContext(source + `
    E = engine; rebuild(); cardEl = card;
    setBackdrop = preload = renderWatchCount = rateSaveState = () => {};
    let undoToast;
    toast = (_, action) => { undoToast = action; };
    show = (v) => { view = v; };
    globalThis.api = {
      setQueue(list) { rateQueue = [...list]; },
      artUnavailable(i) { noArt.add(i); },
      renderRate, rateWith, undo, openWall, finishWall, undoToast: () => undoToast(),
      select(i) { wallSel.add(i); },
      get wall() { return [...wallItems]; },
      get queue() { return [...rateQueue]; },
      get answers() { return [...S.answers.entries()]; }
    };`, context);
  return { api: context.api, cards, element, stored };
}

test("offline and missing posters still allow immediate rating, promotion, and undo", () => {
  const { api, cards, element } = fixture();
  api.setQueue([4, 6, 9]);
  api.artUnavailable(4);
  api.renderRate();
  assert.equal(element("rate-title").textContent, "Film 4");
  const prefetched = cards.find((c) => c.kind === "under");
  assert.equal(prefetched.dataset.i, "6");
  api.rateWith("liked");
  assert.deepEqual(Array.from(api.answers, (a) => [...a]), [[4, "liked"]]);
  assert.equal(element("rate-title").textContent, "Film 6");
  assert.equal(prefetched.kind, "front");
  assert.equal(prefetched.inert, false);
  api.rateWith("disliked");
  assert.equal(element("rate-title").textContent, "Film 9");
  api.undo();
  assert.equal(element("rate-title").textContent, "Film 6");
  assert.deepEqual(Array.from(api.answers, (a) => [...a]), [[4, "liked"]]);
  assert.deepEqual(Array.from(api.queue), [6, 9]);
});

test("choosing films on a wall queues only those films and leaves other tiles unknown", () => {
  const { api, stored } = fixture();
  api.openWall();
  const [a, b] = api.wall;
  api.select(a); api.select(b);
  api.finishWall();
  assert.deepEqual(Array.from(api.queue), [a, b]);
  assert.deepEqual(Array.from(api.answers), []);
  assert.deepEqual(JSON.parse(stored.get("mt.queue.v1")), [1000 + a, 1000 + b]);
});

test("undo on an earlier Save toast preserves the rating given to the following card", () => {
  const { api, stored, element } = fixture();
  api.setQueue([4, 6, 9]);
  api.renderRate();
  api.rateWith(null, { save: true });
  api.rateWith("loved");
  api.undoToast();
  assert.deepEqual(Array.from(api.answers, (a) => [...a]), [[6, "loved"]]);
  assert.deepEqual(JSON.parse(stored.get("mt.watch.v1")), []);
  assert.equal(element("rate-title").textContent, "Film 4");
});

test("Next without a selection pages through different films; explicit none records this wall only", () => {
  const { api } = fixture();
  api.openWall();
  const first = new Set(api.wall);
  api.finishWall();
  const second = Array.from(api.wall);
  assert.equal(second.length, 12);
  assert.ok(second.every((i) => !first.has(i)));
  assert.deepEqual(Array.from(api.answers), []);
  api.finishWall(true);
  assert.deepEqual(Array.from(api.answers, (a) => [...a]), second.map((i) => [i, null]));
  api.openWall();
  assert.ok(api.wall.some((i) => first.has(i)));
});
