// Evaluate the shipped, quantized JS probability curve on real held-out viewers.
// python scripts/refinement_inputs.py --split test --users 400 | node scripts/check_match_export.mjs --data site/data
// Each film in the withheld set was actually rated; coverage is reported at each
// checkpoint because some viewers won't reach 20 answers before the prompt cap.
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { Session } from "../web/engine.js";
import { appIndices, bucket, loadData } from "./compare_picks.mjs";

const checkpoints = [0, 3, 5, 10, 20], maxPrompts = 400;
const edges = [0, .2, .4, .6, .7, .8, .9, 1];
const zero = () => ({count: 0, predicted: 0, liked: 0});
const groups = new Map(checkpoints.map(n => [n, {
  users: 0, films: 0, squaredError: 0, bins: edges.slice(1).map(zero), highByUser: [],
}]));

function record(session, hidden) {
  const group = groups.get(session.rated), high = zero(), scores = session.scores();
  group.users++;
  for (const [i, rating] of hidden) {
    const p = session.e.match(scores[i], session.sd(i)), liked = Number(rating >= 4);
    const bin = group.bins[edges.slice(1).findIndex(upper => p < upper || upper === 1)];
    bin.count++;
    bin.predicted += p;
    bin.liked += liked;
    group.films++;
    group.squaredError += (p - liked) ** 2;
    if (p >= .8 && p < .9) {
      high.count++;
      high.predicted += p;
      high.liked += liked;
    }
  }
  group.highByUser.push(high);
}

function runQuiz(engine, row) {
  const known = appIndices(engine, row.known), hidden = appIndices(engine, row.hidden);
  if (!hidden.size || [...known.keys()].some(i => hidden.has(i))) throw Error("Invalid holdout");
  const session = new Session(engine, [], [], row.seed);
  record(session, hidden);
  for (let q = 0; q < maxPrompts && session.rated < checkpoints.at(-1); q++) {
    const i = session.next(hidden);
    if (i < 0) break;
    const rating = known.get(i);
    session.answer(i, rating == null ? null : bucket(rating));
    if (rating != null && groups.has(session.rated)) record(session, hidden);
  }
}

// Resample people, keeping their films together, for a gap interval in the 80–90% band.
function gapInterval(highByUser, seed) {
  const gaps = [];
  let state = seed;
  for (let b = 0; b < 1000; b++) {
    let count = 0, gap = 0;
    for (let i = 0; i < highByUser.length; i++) {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      const u = highByUser[Math.floor((state / 2 ** 32) * highByUser.length)];
      count += u.count;
      gap += u.liked - u.predicted;
    }
    if (count) gaps.push(gap / count);
  }
  gaps.sort((a, b) => a - b);
  return gaps.length ? [.025, .975].map(q => round(gaps[Math.floor(q * gaps.length)])) : null;
}

const round = n => Number(n.toFixed(6));
const {values} = parseArgs({options: {data: {type: "string", default: "site/data"}}});
const engine = loadData(values.data);
let users = 0, split = null;
for await (const line of createInterface({input: process.stdin, crlfDelay: Infinity})) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (split && split !== row.split) throw Error("Supply a single held-out split");
  split = row.split;
  runQuiz(engine, row);
  users++;
}
if (!users) throw Error("Pipe the output of refinement_inputs.py to this script");
const results = checkpoints.map(ratings => {
  const {users, films, squaredError, bins, highByUser} = groups.get(ratings);
  const high = bins[5];
  return {
    ratings, users, withheldFilms: films, brier: films ? round(squaredError / films) : null,
    expectedCalibrationError: films ? round(bins.reduce((s, b) => s + Math.abs(b.predicted - b.liked), 0) / films) : null,
    band80to90: {films: high.count, meanForecast: high.count ? round(high.predicted / high.count) : null,
      observedFourPlus: high.count ? round(high.liked / high.count) : null,
      observedMinusForecast95Interval: gapInterval(highByUser, 123456789 + ratings)},
  };
});
console.log(JSON.stringify({
  dataset: "MovieLens 32M", split, users, catalogueBuild: engine.meta.build,
  method: "Refinement input split, user-seeded quiz, withheld titles excluded from questions; outcome is a historical rating of 4+.",
  maxPrompts, reliabilityBinEdges: edges, results,
}, null, 2));
