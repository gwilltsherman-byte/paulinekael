// A small made-up model for testing the engine without the real data files: random
// taste vectors and a random positive-definite prior, from a fixed seed.
import { Engine } from "../web/engine.js";

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

export function makeEngine({ n = 400, k = 6, pool = 120, seed = 7 } = {}) {
  const r = rng(seed), d = k + 1;
  const vec = Int8Array.from({ length: n * k }, () => Math.round((r() * 2 - 1) * 127));
  const bias = Float32Array.from({ length: n }, () => (r() - 0.5) * 1.2);
  const flags = Uint8Array.from({ length: n }, (_, i) => (i >= pool && i % 3 === 0 ? 1 : 0));
  // "Seen it" covariance: a Gram matrix, so it is positive semi-definite like the real one.
  const V = Array.from({ length: pool }, () => Array.from({ length: 5 }, () => r() * 2 - 1));
  const gram = (a, b) => V[a].reduce((t, v, q) => t + v * V[b][q], 0);
  const top = Math.max(...V.map((_, a) => gram(a, a)));
  const seen = Int8Array.from({ length: pool * pool }, (_, q) => Math.round((127 * gram(Math.floor(q / pool), q % pool)) / top));
  // prior covariance A A' + 0.3 I
  const A = Array.from({ length: d }, () => Array.from({ length: d }, () => (r() - 0.5) * 0.8));
  const cov = A.map((row, i) => A.map((col, j) => row.reduce((s, v, q) => s + v * col[q], 0) + (i === j ? 0.3 : 0)));
  const meta = {
    n, k, pool, mu: 3.5, noise: 0.8, scale: Array.from({ length: k }, () => 0.01 + r() * 0.02),
    answers: ["disliked", "meh", "liked", "loved"], values: [1.5, 3, 4, 4.75],
    prior_mean: Array.from({ length: d }, () => (r() - 0.5) * 0.2), prior_cov: cov,
    seen_p: Array.from({ length: pool }, () => 0.05 + r() * 0.5), seen_scale: 0.004, seen_ridge: 0.02,
    content_var: 0.3, match: { threshold: 3.75, tau: 0.68, shift: 0.16 }, genres: [], scales: [], build: "test",
  };
  const films = { imdb: Array.from({ length: n }, (_, i) => 1000 + i), title: Array.from({ length: n }, (_, i) => `Film ${i}`),
    year: Array.from({ length: n }, () => 2000), votes: Array.from({ length: n }, () => 5000), genres: Array.from({ length: n }, () => 0),
    score: Array.from({ length: n }, () => 70) };
  return new Engine(meta, films, vec, bias, flags, seen);
}
