import test from "node:test";
import assert from "node:assert/strict";
import { compareUser } from "../scripts/compare_picks.mjs";
import { makeEngine } from "./helpers.mjs";

const engine = makeEngine({ n: 130, k: 4, pool: 100 });
const known = engine.films.imdb.slice(0, 100).map((id, i) => [id, i % 2 ? 4 : 3.5]);
const hidden = engine.films.imdb.slice(100).map((id, i) => [id, i % 2 ? 5 : 2]);
const user = { seed: 3, known, hidden };

test("changing hidden outcomes only changes the score, never the simulated interactions", () => {
  const a = compareUser(engine, { ...user, hidden: hidden.map(([id]) => [id, 5]) });
  const b = compareUser(engine, { ...user, hidden: hidden.map(([id]) => [id, 1]) });
  assert.equal(a.baselineScore, 1);
  assert.equal(a.refinedScore, 1);
  assert.equal(b.baselineScore, 0);
  assert.equal(b.refinedScore, 0);
  assert.equal(a.offered, true);
  assert.deepEqual(a, { ...b, baselineScore: 1, refinedScore: 1 });
  assert.equal(a.refinedTime, 60);
  assert.equal(a.baselineTime, 60);
});

test("overlap is rejected; unready sessions never count as successful recommendations", () => {
  assert.throws(() => compareUser(engine, { ...user, known: [hidden[0]] }), /quiz and holdout/);
  const incomplete = compareUser(engine, { ...user, known: [] });
  assert.equal(incomplete.baselineScore, null);
  assert.equal(incomplete.refinedScore, null);
  assert.equal(incomplete.offered, false);
  assert.equal(compareUser(engine, { ...user, hidden: hidden.slice(0, 2) }), null);
});

test("equal source ratings never invent a comparison winner, even if a question is offered", () => {
  const result = compareUser(engine, { ...user, known: known.map(([id]) => [id, 4]) });
  assert.equal(result.answered, false);
  assert.equal(result.refinedTime, 60);
  assert.deepEqual(compareUser(engine, user), compareUser(engine, user));
});
