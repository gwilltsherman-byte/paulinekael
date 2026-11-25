import assert from "node:assert/strict";
import test from "node:test";
import { Session } from "../web/engine.js";
import { compareQuiz } from "../scripts/compare_quiz.mjs";
import { makeEngine } from "./helpers.mjs";

function example() {
  const e = makeEngine({ n: 11, k: 2, pool: 4, meta: {
    scale: [1, 1], prior_mean: [0, 0, 0], prior_cov: [[1, 0, 0], [0, 1, 0], [0, 0, 0.1]],
    seen_p: [.8, .8, .1, .8], noise: 1,
  } });
  // The most globally uncertain question (0) reveals only the second factor.
  // Only the first factor distinguishes the third and fourth recommendation.
  e.vec.set([0,5, 1,0, 1,0, 0,0, 0,0, 0,0, 1,0, -1,0, 0,0, 0,0, 0,0]);
  e.bias.set([0,0,0,0, 1,0.9,0.05,0, 0,0,0]);
  const s = new Session(e, [[8,3.5], [9,3.5], [10,3.5]]);
  s.quizTargets = () => [4,5,6,7];
  return s;
}

test("decision questions resolve a top-three choice, favor familiar questions and honor exclusions", () => {
  const s = example();
  assert.equal(s.next(), 0);
  s.quizPolicy = "decision";
  assert.equal(s.next(), 1);
  assert.equal(s.nextBatch(3)[0], 1);
  assert.equal(s.next(new Set([1])), 2);
  assert.deepEqual(s.nextBatch(0), []);
  const batch = s.nextBatch(3, new Set([1]));
  assert.equal(batch[0], 2);
  assert.equal(new Set(batch).size, 3);
  assert.ok(!batch.includes(1));
  s.answer(1, null);
  assert.equal(s.next(), 2);
});

test("quick mode, missing shortlists and the initial questions retain the information policy", () => {
  const s = example();
  s.quizPolicy = "decision";
  s.e.fullN = s.e.n + 50;
  assert.equal(s.next(), 0);
  s.e.fullN = s.e.n;
  s.quizEligible = () => false;
  assert.equal(s.next(), 0);
  s.quizEligible = null;
  const empty = new Session(s.e);
  const first = empty.nextBatch(3);
  empty.quizPolicy = "decision";
  assert.deepEqual(empty.nextBatch(3), first);
  assert.ok(s.decisionSlate().every(i => s.answers.get(i) == null));
});

test("arm is stable for old sessions and distributed across seeded profiles", () => {
  assert.equal(Session.quizPolicy(null), "information");
  const assignments = Array.from({ length: 1000 }, (_, i) => Session.quizPolicy(i));
  const n = assignments.filter((v) => v === "decision").length;
  assert.ok(n > 450 && n < 550);
  assert.equal(Session.quizPolicy(31), assignments[31]);
});

test("equal-time replay isolates hidden labels from questions and accounts for too few ratings", () => {
  const e = makeEngine({ n: 130, k: 4, pool: 100 });
  const known = e.films.imdb.slice(0, 100).map((id, i) => [id, i % 2 ? 4 : 3.5]);
  const hidden = e.films.imdb.slice(100).map((id) => [id, 5]);
  const a = compareQuiz(e, { seed: 6, known, hidden });
  const b = compareQuiz(e, { seed: 6, known, hidden: hidden.map(([id]) => [id, 1]) });
  for (const name of ["decision", "information"]) {
    assert.equal(a[name].seconds, 60);
    assert.deepEqual(a[name], { ...b[name], liked: 1 });
    assert.equal(b[name].liked, 0);
  }
  const incomplete = compareQuiz(e, { seed: 6, known: [], hidden });
  assert.equal(incomplete.decision.liked, null);
  assert.equal(incomplete.information.liked, null);
  assert.throws(() => compareQuiz(e, { seed: 6, known: [hidden[0]], hidden }), /holdout/);
});
