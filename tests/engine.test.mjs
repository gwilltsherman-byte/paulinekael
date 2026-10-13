import test from "node:test";
import assert from "node:assert/strict";
import { cholSolve, phi, Session } from "../web/engine.js";
import { makeEngine, rng } from "./helpers.mjs";

const E = makeEngine();
const ANSWERS = ["loved", "liked", "meh", "disliked", null, 4.5, 2];

/** The picker as it was before the rank-one update: a full d x d quadratic form per film per pick. */
function referenceBatch(s, n, skip = null) {
  const e = s.e, d = e.d, p = s.seenProb(), w = s.weights(), S = s.cov.slice(), picked = [];
  for (let r = 0; r < n; r++) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < e.pool; i++) {
      if (s.answers.has(i) || picked.includes(i) || skip?.has(i)) continue;
      const x = e.x(i);
      let q = 0;
      for (let a = 0; a < d; a++) { let t = 0; for (let b = 0; b < d; b++) t += S[a * d + b] * x[b]; q += x[a] * t; }
      const sc = w[i] * p[i] * 0.5 * Math.log1p(q / e.noise);
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    if (best < 0) break;
    picked.push(best);
    const x = e.x(best), Sx = new Float64Array(d);
    for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) Sx[a] += S[a * d + b] * x[b];
    const den = e.noise / p[best] + x.reduce((t, v, a) => t + v * Sx[a], 0);
    for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) S[a * d + b] -= (Sx[a] * Sx[b]) / den;
  }
  return picked;
}

test("cholSolve solves A x = b for a positive-definite A", () => {
  const A = Float64Array.from([4, 1, 0.5, 1, 3, 0.2, 0.5, 0.2, 2]), b = [1, -2, 3];
  const x = cholSolve(A, 3, b);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(A[i * 3] * x[0] + A[i * 3 + 1] * x[1] + A[i * 3 + 2] * x[2] - b[i]) < 1e-12);
});

test("phi is the standard normal CDF", () => {
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(phi(1.96) - 0.9750021) < 2e-7);
  assert.ok(Math.abs(phi(-1) - 0.1586553) < 2e-7);
  assert.ok(Math.abs(phi(2.5) + phi(-2.5) - 1) < 1e-12);
});

test("answering one at a time gives the same posterior as solving it all at once", () => {
  const r = rng(3), s = new Session(E), d = E.d, rated = [];
  for (let q = 0; q < 25; q++) {
    const i = Math.floor(r() * E.n), a = ANSWERS[Math.floor(r() * 4)];
    if (s.answers.has(i)) continue;
    s.answer(i, a); rated.push([i, a]);
  }
  // posterior mean = (S0^-1 + X'X/noise)^-1 (S0^-1 m0 + X't/noise)
  const P = new Float64Array(d * d), rhs = new Float64Array(d);
  const inv = Array.from({ length: d }, (_, c) => cholSolve(E.priorCov, d, Array.from({ length: d }, (_, q) => (q === c ? 1 : 0))));
  for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) P[a * d + b] = inv[b][a];
  for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) rhs[a] += P[a * d + b] * E.priorMean[b];
  for (const [i, a] of rated) {
    const x = E.x(i), t = E.stars(a) - E.mu - E.bias[i];
    for (let u = 0; u < d; u++) { rhs[u] += (x[u] * t) / E.noise; for (let v = 0; v < d; v++) P[u * d + v] += (x[u] * x[v]) / E.noise; }
  }
  const want = cholSolve(P, d, rhs);
  for (let u = 0; u < d; u++) assert.ok(Math.abs(s.mean[u] - want[u]) < 1e-9, `dim ${u}: ${s.mean[u]} vs ${want[u]}`);
});

test("quads() stays equal to x'Sx recomputed from the covariance, whatever is answered", () => {
  const r = rng(11), s = new Session(E, [], [], 5), d = E.d, px = E.poolX();
  s.quads();                                       // start tracking before the answers
  for (let q = 0; q < 40; q++) {
    const i = r() < 0.25 ? E.pool + Math.floor(r() * (E.n - E.pool)) : s.next();   // off-pool films too
    s.answer(i, ANSWERS[Math.floor(r() * ANSWERS.length)]);
  }
  const q = s.quads();
  for (let j = 0; j < E.pool; j++) {
    let t = 0;
    for (let a = 0; a < d; a++) { let u = 0; for (let b = 0; b < d; b++) u += s.cov[a * d + b] * px[j * d + b]; t += px[j * d + a] * u; }
    assert.ok(Math.abs(q[j] - t) < 1e-10 * Math.max(1, t), `film ${j}: ${q[j]} vs ${t}`);
  }
});

test("next() and nextBatch() pick what the full computation picks", () => {
  const r = rng(21);
  for (let trial = 0; trial < 12; trial++) {
    const seed = trial % 2 ? (r() * 2 ** 32) | 0 : null, s = new Session(E, [], [], seed);
    const skip = new Set(Array.from({ length: 10 }, () => Math.floor(r() * E.pool)));
    for (let q = 0, steps = 1 + Math.floor(r() * 30); q < steps; q++) s.answer(s.next(skip), ANSWERS[Math.floor(r() * ANSWERS.length)]);
    for (const n of [1, 3, 12]) assert.deepEqual(s.nextBatch(n, skip), referenceBatch(s, n, skip), `trial ${trial}, batch of ${n}`);
    assert.equal(s.next(skip), referenceBatch(s, 1, skip)[0]);
    // a session rebuilt from the same answers (what the app does after Undo) agrees too
    const rebuilt = new Session(E, [...s.answers], [], seed);
    assert.equal(rebuilt.next(skip), s.next(skip));
  }
});

test("nextBatch never repeats a film or picks one already answered", () => {
  const s = new Session(E, [[3, "loved"], [9, null]], [], 4), batch = s.nextBatch(40);
  assert.equal(new Set(batch).size, batch.length);
  assert.ok(!batch.includes(3) && !batch.includes(9));
});

test("similar() returns the n most alike films, best first", () => {
  const cands = Array.from({ length: E.n - 10 }, (_, i) => i + 10), got = E.similar(5, cands, 15);
  const cos = (i, j) => { const a = E.x(i).subarray(0, E.k), b = E.x(j).subarray(0, E.k); let d = 0, na = 0, nb = 0; for (let q = 0; q < E.k; q++) { d += a[q] * b[q]; na += a[q] ** 2; nb += b[q] ** 2; } return d / Math.sqrt(na * nb); };
  const want = cands.map((i) => [i, cos(i, 5)]).sort((a, b) => b[1] - a[1]).slice(0, 15);
  assert.deepEqual(got.map(([i]) => i), want.map(([i]) => i));
  got.forEach(([, s], q) => assert.ok(Math.abs(s - want[q][1]) < 1e-12));
  assert.equal(E.similar(5, [10, 11], 15).length, 2);   // fewer candidates than n
});

test("match() is a probability that rises with the predicted rating", () => {
  const a = E.match(2.5, 0.4), b = E.match(3.8, 0.4), c = E.match(4.6, 0.4);
  assert.ok(0 < a && a < b && b < c && c < 1);
});

/** taste.quiz.Session.answer, written out with plain arrays, as an independent reference. */
function referenceSession(e, steps) {
  const d = e.d, cov = Array.from({ length: d }, (_, a) => Array.from({ length: d }, (_, b) => e.priorCov[a * d + b]));
  const solve = Array.from(cholSolve(e.priorCov, d, e.priorMean));
  let h = solve, mean = Array.from(e.priorMean);
  const mv = (M, v) => M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
  for (const [i, label] of steps) {
    const x = Array.from(e.x(i));
    let t, noise = e.noise;
    if (label == null) {
      if (e.unseenDelta == null) continue;
      t = x.reduce((s, v, j) => s + v * mean[j], 0) - e.unseenDelta;
      noise = e.noise * e.unseenNoise;
    } else t = e.stars(label) - e.mu - e.bias[i];
    const Sx = mv(cov, x), den = noise + x.reduce((s, v, j) => s + v * Sx[j], 0);
    for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) cov[a][b] -= (Sx[a] * Sx[b]) / den;
    h = h.map((v, a) => v + (x[a] * t) / noise);
    mean = mv(cov, h);
  }
  return mean;
}

const withUnseen = (delta, noise) => { const e = makeEngine(); e.unseenDelta = delta; e.unseenNoise = noise; return e; };

test("'haven't seen' changes nothing unless the model says it is a hint", () => {
  const plain = new Session(E, [[1, "loved"], [2, null], [3, "meh"], [4, null]]), without = new Session(E, [[1, "loved"], [3, "meh"]]);
  assert.deepEqual([...plain.mean], [...without.mean]);
});

test("with unseen_delta, a skipped film is a weak hint, exactly as taste.quiz does it", () => {
  const U = withUnseen(1.0, 2.0), steps = [[5, "loved"], [6, null], [7, "disliked"], [8, null], [9, null], [10, "liked"]];
  const s = new Session(U, steps), want = referenceSession(U, steps);
  want.forEach((v, j) => assert.ok(Math.abs(s.mean[j] - v) < 1e-9, `dim ${j}: ${s.mean[j]} vs ${v}`));
  const base = new Session(U, steps.filter(([, a]) => a != null));
  assert.ok([...s.mean].some((v, j) => Math.abs(v - base.mean[j]) > 1e-6), "the unseen answers should move the profile");
  assert.equal(s.rated, 3);   // still only three real ratings
});

test("a skipped film pulls toward films unlike it, and a weak hint is weaker than a real rating", () => {
  const U = withUnseen(1.0, 2.0), i = 20;
  const hint = new Session(U, [[i, null]]), rated = new Session(U, [[i, "disliked"]]), none = new Session(U);
  const move = (s) => Math.hypot(...[...s.mean].map((v, j) => v - none.mean[j]));
  assert.ok(move(hint) > 0 && move(hint) < move(rated));
});

test("the maintained uncertainties still match a recompute when unseen answers update the covariance", () => {
  const U = withUnseen(1.0, 2.0), r = rng(31), s = new Session(U, [], [], 5), d = U.d, px = U.poolX();
  s.quads();
  for (let q = 0; q < 30; q++) s.answer(s.next(), ANSWERS[Math.floor(r() * ANSWERS.length)]);
  const quad = s.quads();
  for (let j = 0; j < U.pool; j++) {
    let t = 0;
    for (let a = 0; a < d; a++) { let u = 0; for (let b = 0; b < d; b++) u += s.cov[a * d + b] * px[j * d + b]; t += px[j * d + a] * u; }
    assert.ok(Math.abs(quad[j] - t) < 1e-10 * Math.max(1, t));
  }
  const rebuilt = new Session(U, [...s.answers], [], 5);
  assert.deepEqual([...rebuilt.mean], [...s.mean]);
});
