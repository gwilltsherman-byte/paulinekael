// Paired offline proxy using the shipping JS session and recommendation refinement.
// Input: one {seed, known, hidden} per line, with [IMDb ID, stars] rows. See
// refinement_inputs.py. A historic 4+ is evidence about a watched film, not a
// measure of what someone would pick or watch when presented with these results.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Engine, Session } from "../web/engine.js";

const defaults = { seconds: 60, rate: 4, unseen: 2, compare: 4 };
export const bucket = (r) => r >= 4.5 ? "loved" : r >= 3.5 ? "liked" : r >= 2.5 ? "meh" : "disliked";

export function loadData(dir) {
  const json = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  const binary = (name, Type) => {
    const buffer = readFileSync(join(dir, name));
    return new Type(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  };
  return new Engine(json("meta.json"), json("films.json"), binary("vectors.bin", Int8Array),
    binary("bias.bin", Float32Array), binary("flags.bin", Uint8Array), binary("seen.bin", Int8Array));
}

function quiz(session, known, withheld, spent, limit, times) {
  while (spent < limit) {
    const i = session.next(withheld);
    if (i < 0) break;
    const stars = known.get(i), cost = stars == null ? times.unseen : times.rate;
    if (spent + cost > limit) break;
    session.answer(i, stars == null ? null : bucket(stars));
    spent += cost;
  }
  return spent;
}

export function appIndices(engine, entries) {
  const rows = new Map();
  for (const [id, stars] of entries) {
    if (!Number.isFinite(stars) || stars < 0.5 || stars > 5) throw Error("Invalid input rating");
    const i = engine.byImdb.get(id);
    if (i !== undefined) rows.set(i, stars);
  }
  return rows;
}

function topThree(session, slate, records, hidden) {
  if (session.rated < 3) return null;
  const { hero, items } = session.refinePicks(slate, records, false);
  const picks = [hero, ...items].slice(0, 3);
  return picks.filter((i) => hidden.get(i) >= 4).length / 3;
}

export function compareUser(engine, { seed, known: observed, hidden: heldOut }, times = defaults) {
  if (Object.keys(defaults).some((k) => !Number.isFinite(times[k]) || times[k] <= 0)
      || times.compare > times.seconds) throw Error("Invalid time budget or action cost");
  const known = appIndices(engine, observed), hidden = appIndices(engine, heldOut);
  for (const i of known.keys()) if (hidden.has(i)) throw Error("Film appears in quiz and holdout");
  const session = new Session(engine, [], [], seed), withheld = new Set(hidden.keys());
  // Reserve the final decision window. The ordinary quiz can use this time for
  // another rating or skip. An offered comparison costs time even when declined.
  const elapsed = quiz(session, known, withheld, 0, times.seconds - times.compare, times);
  const predictions = session.scores();
  // Compare the actual ranker on a fixed, score-ordered slate of at most 15
  // hidden popular films, not a replay of Home's complete retrieval/diversity.
  const slate = [...withheld].filter((i) => engine.films.votes[i] >= 2000)
    .sort((a, b) => predictions[b] - predictions[a] || a - b).slice(0, 15);
  if (slate.length < 3) return null;
  const { pair } = session.refinePicks(slate);
  const baseline = new Session(engine, [...session.answers], [], seed);
  const baselineTime = quiz(baseline, known, withheld, elapsed, times.seconds, times);
  const baselineScore = topThree(baseline, slate, [], hidden);
  if (!pair) return { baselineScore, refinedScore: baselineScore, offered: false, answered: false,
    baselineTime, refinedTime: baselineTime };
  const [a, b] = pair;
  if (session.answers.get(a) == null || session.answers.get(b) == null) throw Error("Asked about an unrated film");
  const [ra, rb] = [known.get(a), known.get(b)], [ia, ib] = pair.map((i) => engine.films.imdb[i]);
  // Exact historical stars break ties between previously supplied coarse rating
  // buttons. Equal stars give no preference; never use a hidden label to answer.
  const winner = ra === rb ? null : ra > rb ? ia : ib;
  const record = [Math.min(ia, ib), Math.max(ia, ib), winner, session.rated];
  const refinedTime = quiz(session, known, withheld, elapsed + times.compare, times.seconds, times);
  return { baselineScore, refinedScore: topThree(session, slate, [record], hidden), offered: true,
    answered: winner !== null, baselineTime, refinedTime };
}

async function main() {
  const options = { data: { type: "string", default: "site/data" } };
  for (const [key, value] of Object.entries(defaults)) options[key] = { type: "string", default: String(value) };
  const { values } = parseArgs({ options });
  const times = Object.fromEntries(Object.keys(defaults).map((k) => [k, Number(values[k])]));
  const engine = loadData(values.data), results = [];
  let total = 0;
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    total++;
    const row = compareUser(engine, JSON.parse(line), times);
    if (row) results.push(row);
  }
  if (!total) throw Error("No held-out users supplied; pipe the output of refinement_inputs.py to this script");
  const ready = results.filter((r) => r.baselineScore !== null && r.refinedScore !== null);
  const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const deltas = ready.map((r) => r.refinedScore - r.baselineScore);
  const difference = mean(deltas);
  const se = deltas.length > 1 ? Math.sqrt(deltas.reduce((sum, d) => sum + (d - difference) ** 2, 0)
    / (deltas.length - 1) / deltas.length) : null;
  console.log(JSON.stringify({ metric: "historical 4+ share of top three held-out films (paired ready users)",
    catalogueBuild: engine.meta.build, assumedSeconds: times, totalUsers: total, eligibleSlates: results.length, bothReady: ready.length,
    comparisonsOffered: results.filter((r) => r.offered).length, comparisonsAnswered: results.filter((r) => r.answered).length,
    baseline: mean(ready.map((r) => r.baselineScore)), refined: mean(ready.map((r) => r.refinedScore)),
    meanPairedDifference: difference,
    approximate95PercentPairedInterval: se === null ? null : [difference - 1.96 * se, difference + 1.96 * se],
    improvedUsers: deltas.filter((v) => v > 0).length, worsenedUsers: deltas.filter((v) => v < 0).length }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
