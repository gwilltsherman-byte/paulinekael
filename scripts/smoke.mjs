// Checks a freshly built app before it is published: the data files are all there and
// the right size for the film count, nothing is NaN, and the phone engine can run a quiz
// on them. publish.yml runs it between the build and the push, so a broken build leaves
// the live site as it was.
//
//   node scripts/smoke.mjs site/data
//
// Set REQUIRE_POSTERS=1 (the workflow does when there is a TMDB token) to also insist
// that posters and streaming data came through.
import { existsSync, readFileSync, statSync } from "node:fs";
import { Engine, Session } from "../web/engine.js";

const dir = `${process.argv[2] || "site/data"}/`;
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); return ok; };
const json = (f) => JSON.parse(readFileSync(dir + f, "utf8"));
const bin = (f, T) => { const b = readFileSync(dir + f); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

const MIN_FILMS = 100_000;   // the app ships ~149,000; far fewer means the catalog step broke
for (const f of ["meta.json", "films.json", "vectors.bin", "bias.bin", "flags.bin", "seen.bin", "posters.json", "extras.json", "directors.json", "quick.json"]) {
  check(existsSync(dir + f) && statSync(dir + f).size > 0, `${f} is missing or empty`);
}
if (problems.length) fail();

const meta = json("meta.json"), films = json("films.json");
const { n, k, pool } = meta;
check(Number.isInteger(n) && n >= MIN_FILMS, `only ${n} films (expected at least ${MIN_FILMS})`);
check(typeof meta.build === "string" && meta.build.length >= 8, "meta.json has no build stamp");
check(meta.match && meta.match.tau > 0, "meta.json has no match calibration");
check(meta.scales.length > 0 && meta.scales.every((s) => s.d.length === k), "taste scales missing or the wrong size");
for (const c of ["title", "year", "genres", "imdb", "votes", "score"]) check(films[c]?.length === n, `films.${c} has ${films[c]?.length} entries, not ${n}`);
check(statSync(dir + "vectors.bin").size === n * k, "vectors.bin is not n x k bytes");
check(statSync(dir + "bias.bin").size === n * 4, "bias.bin is not n float32s");
check(statSync(dir + "flags.bin").size === n, "flags.bin is not n bytes");
check(statSync(dir + "seen.bin").size === pool * pool, "seen.bin is not pool x pool bytes");
const thisYear = new Date().getFullYear();
check(films.year.every((y) => y === 0 || (y >= 1870 && y <= thisYear + 3)), "some film years are out of range");
check(new Set(films.imdb).size > 0.99 * n, "IMDb ids repeat");
check(films.title.filter((t) => !t).length < 0.001 * n, "many films have no title");
const posters = json("posters.json"), extras = json("extras.json");
check(posters.length === n, `posters.json has ${posters.length} entries, not ${n}`);
if (problems.length) fail();

const shown = posters.filter(Boolean).length;
const popular = films.votes.reduce((c, v) => c + (v >= 1000), 0);
const streaming = Object.keys(extras.films).length;
if (process.env.REQUIRE_POSTERS) {
  check(shown > 0.5 * popular, `only ${shown} films have a poster (${popular} have 1,000+ votes): the TMDB lookup failed and there was no cache`);
  check(streaming > 0.3 * popular, `only ${streaming} films have streaming/trailer data: the TMDB lookup failed and there was no cache`);
  check(Object.keys(extras.providers).length > 10, "no streaming services listed");
}

// The quick-start bundle must be exactly the first `pool` rows of the full files: a new visitor
// starts from it, and their answers carry straight over when the rest arrives.
const quick = json("quick.json"), P = pool;
const fullVec = bin("vectors.bin", Int8Array), fullBias = bin("bias.bin", Float32Array), fullFlags = bin("flags.bin", Uint8Array);
const q = { vec: Buffer.from(quick.vec, "base64"), bias: Buffer.from(quick.bias, "base64"), flags: Buffer.from(quick.flags, "base64") };
check(quick.films.imdb.length === P && quick.posters.length === P, "quick.json doesn't hold exactly the question pool");
check(Object.keys(films).every((c) => JSON.stringify(quick.films[c]) === JSON.stringify(films[c].slice(0, P))), "quick.json films differ from films.json");
check(q.vec.length === P * k && q.vec.every((b, i) => (b << 24 >> 24) === fullVec[i]), "quick.json vectors differ from vectors.bin");
check(new Float32Array(q.bias.buffer.slice(q.bias.byteOffset, q.bias.byteOffset + P * 4)).every((v, i) => v === fullBias[i]), "quick.json bias differs from bias.bin");
check(q.flags.every((b, i) => b === fullFlags[i]), "quick.json flags differ from flags.bin");
check(JSON.stringify(quick.posters) === JSON.stringify(posters.slice(0, P)), "quick.json posters differ from posters.json");
if (problems.length) fail();

// Run a quiz on it, as the phone does.
const e = new Engine(meta, films, bin("vectors.bin", Int8Array), bin("bias.bin", Float32Array), bin("flags.bin", Uint8Array), bin("seen.bin", Int8Array));
const s = new Session(e, [], [], 12345);
const labels = ["loved", "liked", "meh", "disliked", null];
for (let q = 0; q < 12; q++) {
  const i = s.next();
  if (!check(Number.isInteger(i) && i >= 0 && i < pool, `the quiz asked for film ${i}, outside the question pool`)) break;
  s.answer(i, labels[q % labels.length]);
}
const batch = s.nextBatch(12);
check(batch.length === 12 && new Set(batch).size === 12, "the poster wall did not get 12 different films");
const scores = s.scores();
let bad = 0, best = -Infinity;
for (let i = 0; i < n; i++) { if (!Number.isFinite(scores[i])) bad++; else best = Math.max(best, scores[i]); }
check(bad === 0, `${bad} predicted ratings are NaN or infinite`);
check(best > 3.5 && best < 6, `the best predicted rating is ${best.toFixed(2)}`);
const m = e.match(best, s.sd(scores.indexOf(best)));
check(m > 0 && m < 1, `match for the best film is ${m}`);
check(s.rated === 10, `expected 10 rated of 12 answers, got ${s.rated}`);

if (problems.length) fail();
console.log(`smoke test passed: ${n.toLocaleString()} films, ${shown.toLocaleString()} posters, ${streaming.toLocaleString()} with streaming data, build ${meta.build}`);

function fail() {
  console.error(`smoke test failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
