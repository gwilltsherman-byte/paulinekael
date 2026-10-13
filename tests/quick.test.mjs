import test from "node:test";
import assert from "node:assert/strict";
import { Engine, Session, loadQuick } from "../web/engine.js";
import { makeEngine } from "./helpers.mjs";

const FULL = makeEngine({ n: 500, pool: 100 });
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");
const prefix = (e, P) => ({
  films: Object.fromEntries(Object.entries(e.films).map(([c, v]) => [c, v.slice(0, P)])),
  vec: e.vec.slice(0, P * e.k), bias: e.bias.slice(0, P), flags: e.flags.slice(0, P),
});
function quickEngine(e = FULL) {
  const q = prefix(e, e.pool), c = new Engine({ ...e.meta, n: e.pool }, q.films, q.vec, q.bias, q.flags, e.seen);
  c.fullN = e.meta.n;
  return c;
}
const ANSWERS = ["loved", "liked", "meh", "disliked", null, 4.5];

test("an engine built from the question pool alone asks exactly what the full one asks", () => {
  const q = quickEngine(), a = new Session(q, [], [], 9), b = new Session(FULL, [], [], 9);
  for (let i = 0; i < 25; i++) {
    const x = a.next(), y = b.next();
    assert.equal(x, y);
    a.answer(x, ANSWERS[i % ANSWERS.length]); b.answer(y, ANSWERS[i % ANSWERS.length]);
    assert.deepEqual(a.nextBatch(6), b.nextBatch(6));
  }
  for (let i = 0; i < FULL.pool; i++) assert.ok(Math.abs(a.scores()[i] - b.scores()[i]) < 1e-9);
  assert.deepEqual([...a.mean], [...b.mean]);
});

test("after upgrade() a session carries on as if it had always had every film", () => {
  const q = quickEngine(), a = new Session(q, [], [], 4), b = new Session(FULL, [], [], 4);
  for (let i = 0; i < 12; i++) { const x = a.next(); a.answer(x, ANSWERS[i % 6]); b.answer(x, ANSWERS[i % 6]); }
  assert.equal(q.n, FULL.pool);
  assert.equal(q.byImdb.get(FULL.films.imdb[300]), undefined);   // not known yet
  q.upgrade({ films: FULL.films, vec: FULL.vec, bias: FULL.bias, flags: FULL.flags });
  a.forget();
  assert.equal(q.n, 500);
  assert.equal(q.byImdb.get(FULL.films.imdb[300]), 300);
  assert.equal(a.scores().length, 500);
  for (let i = 0; i < 500; i++) assert.ok(Math.abs(a.scores()[i] - b.scores()[i]) < 1e-9, `film ${i}`);
  assert.equal(a.next(), b.next());
  assert.equal(a.sd(300), b.sd(300));
});

test("upgrade() refuses data that is not this build's", () => {
  const q = quickEngine();
  assert.throws(() => q.upgrade({ films: { imdb: [1, 2, 3] }, vec: new Int8Array(3 * q.k), bias: new Float32Array(3), flags: new Uint8Array(3) }), /doesn't fit/);
  assert.throws(() => q.upgrade({ films: FULL.films, vec: FULL.vec.slice(1), bias: FULL.bias, flags: FULL.flags }), /doesn't fit/);
  assert.equal(q.n, FULL.pool);   // untouched
});

test("loadQuick decodes quick.json (as taste/quick.py writes it) and seen.bin", async () => {
  const P = FULL.pool, q = prefix(FULL, P);
  const files = {
    "quick.json": JSON.stringify({ films: q.films, vec: b64(q.vec), bias: b64(q.bias), flags: b64(q.flags), posters: Array.from({ length: P }, (_, i) => `p${i}.jpg`) }),
    "seen.bin": Buffer.from(FULL.seen.buffer),
  };
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const name = String(url).split("/").pop().split("?")[0];
    return name in files ? new Response(files[name]) : new Response("no", { status: 404 });
  };
  try {
    const { engine, posters } = await loadQuick("data/", null, { ...FULL.meta, build: "B1" });
    assert.deepEqual(asked.sort(), ["data/quick.json?v=B1", "data/seen.bin?v=B1"]);   // nothing else is downloaded
    assert.equal(engine.n, P);
    assert.equal(engine.fullN, 500);
    assert.deepEqual([...engine.vec], [...FULL.vec.slice(0, P * FULL.k)]);
    assert.deepEqual([...engine.bias], [...FULL.bias.slice(0, P)]);
    assert.equal(posters[7], "p7.jpg");
    assert.equal(new Session(engine, [], [], 3).next(), new Session(FULL, [], [], 3).next());
  } finally { globalThis.fetch = real; }
});
