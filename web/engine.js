// The recommendation engine, running on the phone. Same maths as taste/quiz.py:
// your profile is a Gaussian over taste space, updated in closed form per answer.

// Everyone starts from the same prior, so without a nudge the quiz would open with the
// same films for everybody. A per-person random tilt (Session.weights) varies them; it
// fades out over the first VARY_RATINGS ratings, once your answers make the quiz yours.
// At VARY 2 the first film is one of ~20 big films, two people's first poster walls
// share ~2.5 of 12 films (all 12 without it), and a wall teaches ~80% as much.
const VARY = 2;
const VARY_RATINGS = 20;

export async function loadEngine(base = "data/", onProgress) {
  const files = [
    ["meta.json", "json"], ["films.json", "json"], ["vectors.bin"], ["bias.bin"],
    ["flags.bin"], ["seen.bin"],
  ];
  let done = 0;
  const get = async ([name, kind]) => {
    const r = await fetch(base + name, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    const v = kind === "json" ? await r.json() : await r.arrayBuffer();
    onProgress?.(++done, files.length);
    return v;
  };
  const [meta, films, vec, bias, flags, seen] = await Promise.all(files.map(get));
  return new Engine(meta, films, new Int8Array(vec), new Float32Array(bias),
                    new Uint8Array(flags), new Int8Array(seen));
}

export class Engine {
  constructor(meta, films, vec, bias, flags, seen) {
    Object.assign(this, { meta, films, vec, bias, flags, seen });
    this.n = meta.n;
    this.k = meta.k;
    this.d = meta.k + 1;
    this.pool = meta.pool;
    this.mu = meta.mu;
    this.noise = meta.noise;
    this.scale = Float64Array.from(meta.scale);
    this.value = Object.fromEntries(meta.answers.map((a, j) => [a, meta.values[j]]));
    this.priorMean = Float64Array.from(meta.prior_mean);
    this.priorCov = Float64Array.from(meta.prior_cov.flat());
    this.seenP = Float64Array.from(meta.seen_p);
    this.byImdb = new Map();
    films.imdb.forEach((id, i) => {
      if (id && !this.byImdb.has(id)) this.byImdb.set(id, i);
    });
  }

  /** Predicted stars for every film for a taste vector w = [taste..., generosity]
   *  (withBias false: just the personal part, x . w). */
  project(w, withBias = true) {
    const { n, k, vec, scale, bias } = this;
    const ws = new Float64Array(k);
    for (let j = 0; j < k; j++) ws[j] = w[j] * scale[j];
    const base = withBias ? this.mu + w[k] : w[k];
    const out = new Float32Array(n);
    for (let i = 0, o = 0; i < n; i++, o += k) {
      let s = withBias ? base + bias[i] : base;
      for (let j = 0; j < k; j++) s += vec[o + j] * ws[j];
      out[i] = s;
    }
    return out;
  }

  /** Chance you'd rate it 4+ stars, given a prediction and its uncertainty
   *  (calibrated on held-out ratings: scripts/calibrate_match.py). */
  match(pred, sd) {
    const m = this.meta.match;
    return phi((pred + m.shift - m.threshold) / Math.sqrt(sd * sd + m.tau * m.tau));
  }

  /** Star value of an answer: a button label, or exact stars (imported ratings). */
  stars(a) {
    return typeof a === "number" ? a : this.value[a];
  }

  /** A random number in [0, 1) per question-pool film, fixed by seed (and the film's
   *  IMDb id, so it survives catalog rebuilds). */
  jitter(seed) {
    const out = new Float64Array(this.pool);
    for (let i = 0; i < this.pool; i++) {
      let h = Math.imul((seed ^ this.films.imdb[i]) | 0, 0x9e3779b1);
      h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
      h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
      out[i] = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    return out;
  }

  /** Taste vector of film i, with the constant 1 for rating generosity. */
  x(i) {
    const { k, vec, scale } = this;
    const out = new Float64Array(k + 1);
    for (let j = 0, o = i * k; j < k; j++) out[j] = vec[o + j] * scale[j];
    out[k] = 1;
    return out;
  }
}

export class Session {
  /** list: [[filmIndex, answer], ...]; answer is a label, exact stars, or null (haven't seen).
   *  seen: films watched but not rated (imported) — they only inform "have you seen it?".
   *  seed: varies which films the quiz opens with (see weights()); omit for the plain quiz. */
  constructor(engine, list = [], seen = [], seed = null) {
    this.e = engine;
    this.seen = new Set(seen);
    this.jitter = seed == null ? null : engine.jitter(seed);
    this.cov = engine.priorCov.slice();
    this.h = cholSolve(engine.priorCov, engine.d, engine.priorMean);
    this.mean = engine.priorMean.slice();
    this.answers = new Map();
    for (const [i, a] of list) this.answer(i, a);
  }

  answer(i, label) {
    this.answers.set(i, label);
    if (label == null) return;
    const e = this.e, d = e.d, S = this.cov, x = e.x(i);
    const t = e.stars(label) - e.mu - e.bias[i];
    const Sx = matVec(S, x, d);
    const denom = e.noise + dot(x, Sx);
    for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) S[a * d + b] -= (Sx[a] * Sx[b]) / denom;
    for (let a = 0; a < d; a++) this.h[a] += (x[a] * t) / e.noise;
    this.mean = matVec(S, this.h, d);
  }

  get rated() {
    let n = 0;
    for (const a of this.answers.values()) if (a != null) n++;
    return n;
  }

  /** Predicted stars for every film. */
  scores() {
    return this.e.project(this.mean);
  }

  /** How much your answers lift each film above a typical person's prediction. */
  lifts() {
    const e = this.e;
    return e.project(this.mean.map((v, j) => v - e.priorMean[j]), false);
  }

  /** Where you sit on a taste scale (meta.scales): z, in population standard
   *  deviations from the average person (phi(z) is your percentile toward the right
   *  end), and spread, our uncertainty about z. */
  scalePosition(sc) {
    const k = this.e.k, d = sc.d;
    let v = 0, q = 0;
    for (let a = 0; a < k; a++) {
      v += d[a] * this.mean[a];
      let r = 0;
      for (let b = 0; b < k; b++) r += this.cov[a * this.e.d + b] * d[b];
      q += d[a] * r;
    }
    return { z: (v - sc.mean) / sc.sd, spread: Math.sqrt(q) / sc.sd };
  }

  /** The n most useful films to show together (poster wall): greedy information gain,
   *  counting each pick as probably rated, so the n don't overlap in what they teach. */
  nextBatch(n) {
    const e = this.e, d = e.d, p = this.seenProb(), w = this.weights(), S = this.cov.slice(), picked = new Set();
    for (let k = 0; k < n; k++) {
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < e.pool; i++) {
        if (this.answers.has(i) || picked.has(i)) continue;
        const s = w[i] * p[i] * 0.5 * Math.log1p(quad(S, e.x(i), d) / e.noise);
        if (s > bestScore) { bestScore = s; best = i; }
      }
      if (best < 0) break;
      picked.add(best);
      const x = e.x(best), Sx = matVec(S, x, d), den = e.noise / p[best] + dot(x, Sx);
      for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) S[a * d + b] -= (Sx[a] * Sx[b]) / den;
    }
    return [...picked];
  }

  /** Uncertainty (± stars) of the prediction for film i. */
  sd(i) {
    const e = this.e;
    return Math.sqrt(quad(this.cov, e.x(i), e.d) + (e.flags[i] ? e.meta.content_var : 0));
  }

  /** For each film in items, the biggest film-specific push any single rated film
   *  gives its prediction (taste dims only, as in explain(); the generosity dim
   *  lifts every film alike). Subtracting it keeps films several ratings support. */
  maxPush(items) {
    const e = this.e, d = e.d, k = e.k;
    const rated = [...this.answers].filter(([, a]) => a != null);
    const R = rated.length, M = new Float64Array(k * R);
    rated.forEach(([j, a], r) => {
      const Sx = matVec(this.cov, e.x(j), d), t = (e.stars(a) - e.mu - e.bias[j]) / e.noise;
      for (let q = 0; q < k; q++) M[q * R + r] = Sx[q] * t;
    });
    return items.map((i) => {
      const x = e.x(i);
      let best = 0;
      for (let r = 0; r < R; r++) {
        let s = 0;
        for (let q = 0; q < k; q++) s += x[q] * M[q * R + r];
        if (s > best) best = s;
      }
      return best;
    });
  }

  /** The ratings (of any kind) that most support film i, strongest first: [[j, answer], ...].
   *  Disliking a film can support a pick too. Weak supporters are left out. */
  support(i, top = 3) {
    const e = this.e, k = e.k, Sx = matVec(this.cov, e.x(i), e.d), out = [];
    for (const [j, a] of this.answers) {
      if (a == null) continue;
      const xj = e.x(j);
      let s = 0;
      for (let q = 0; q < k; q++) s += xj[q] * Sx[q];
      const c = (s * (e.stars(a) - e.mu - e.bias[j])) / e.noise;
      if (c > 0) out.push([j, a, c]);
    }
    out.sort((p, q) => q[2] - p[2]);
    const floor = Math.max(0.03, 0.25 * (out[0]?.[2] ?? 0));
    return out.filter((r) => r[2] >= floor).slice(0, top).map(([j, a]) => [j, a]);
  }

  /** Unit taste vector of film i (for measuring how alike two films are). */
  direction(i) {
    const x = this.e.x(i).subarray(0, this.e.k);
    const n = Math.hypot(...x) || 1;
    return x.map((v) => v / n);
  }

  /** Films you liked that pushed film i's prediction up the most (taste dims only),
   *  ignoring pushes under minStars. */
  explain(i, top = 2, minStars = 0.05) {
    const e = this.e, k = e.k, Sx = matVec(this.cov, e.x(i), e.d), out = [];
    for (const [j, a] of this.answers) {
      if (a == null || e.stars(a) < 3.5) continue;
      const xj = e.x(j);
      let s = 0;
      for (let q = 0; q < k; q++) s += xj[q] * Sx[q];
      const c = (s * (e.stars(a) - e.mu - e.bias[j])) / e.noise;
      if (c > minStars) out.push([j, c]);
    }
    return out.sort((a, b) => b[1] - a[1]).slice(0, top).map((r) => r[0]);
  }

  /** P(you've seen it) for each question-pool film, given your answers so far. */
  seenProb() {
    const e = this.e, P = e.pool, sc = e.meta.seen_scale;
    const O = [...new Set([...this.answers.keys(), ...this.seen])].filter((i) => i < P);
    if (!O.length) return e.seenP;
    const m = O.length, A = new Float64Array(m * m), r = new Float64Array(m);
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) A[a * m + b] = e.seen[O[a] * P + O[b]] * sc;
      A[a * m + a] += e.meta.seen_ridge;
      r[a] = (this.answers.get(O[a]) != null || this.seen.has(O[a]) ? 1 : 0) - e.seenP[O[a]];
    }
    const w = cholSolve(A, m, r);
    const est = new Float64Array(P);
    for (let j = 0; j < P; j++) {
      let s = e.seenP[j];
      for (let a = 0; a < m; a++) s += e.seen[j * P + O[a]] * sc * w[a];
      est[j] = Math.min(0.998, Math.max(0.002, s));
    }
    return est;
  }

  /** Weight per question-pool film for picking questions: jitter^v, with v fading from
   *  VARY to 0 over the first VARY_RATINGS ratings (all 1 without a seed). */
  weights() {
    const P = this.e.pool, w = new Float64Array(P).fill(1);
    if (!this.jitter) return w;
    const v = VARY * Math.max(0, 1 - this.rated / VARY_RATINGS);
    for (let i = 0; i < P; i++) w[i] = this.jitter[i] ** v;
    return w;
  }

  /** The next film to ask about: highest P(seen) x information gained if rated
   *  (times weights(), which varies the opening films from person to person). */
  next() {
    const e = this.e, p = this.seenProb(), w = this.weights();
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < e.pool; i++) {
      if (this.answers.has(i)) continue;
      const s = w[i] * p[i] * 0.5 * Math.log1p(quad(this.cov, e.x(i), e.d) / e.noise);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return best;
  }
}

// --- small dense linear algebra -------------------------------------------

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function phi(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - y * Math.exp(-x * x / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function matVec(M, x, d) {
  const out = new Float64Array(d);
  for (let a = 0; a < d; a++) {
    let s = 0;
    for (let b = 0; b < d; b++) s += M[a * d + b] * x[b];
    out[a] = s;
  }
  return out;
}

function quad(M, x, d) {
  let s = 0;
  for (let a = 0; a < d; a++) {
    let r = 0;
    for (let b = 0; b < d; b++) r += M[a * d + b] * x[b];
    s += x[a] * r;
  }
  return s;
}

/** Solve A x = b for symmetric positive-definite A (n x n, row-major). */
export function cholSolve(A, n, b) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let q = 0; q < j; q++) s -= L[i * n + q] * L[j * n + q];
      L[i * n + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * n + j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let q = 0; q < i; q++) s -= L[i * n + q] * y[q];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let q = i + 1; q < n; q++) s -= L[q * n + i] * x[q];
    x[i] = s / L[i * n + i];
  }
  return x;
}
