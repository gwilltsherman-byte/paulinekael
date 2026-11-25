// Compare the two shipping Rate-card question policies at the same assumed time budget.
// python scripts/refinement_inputs.py --split val --users 400 | node scripts/compare_quiz.mjs --data site/data
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Session } from "../web/engine.js";
import { appIndices, bucket, loadData } from "./compare_picks.mjs";

function replay(engine, seed, policy, known, held, grade, seconds) {
  const s = new Session(engine, [], [], seed);
  s.quizPolicy = policy;
  let elapsed = 0, queued = null, asked = 0;
  while (elapsed < seconds) {
    const current = queued ?? s.next(held);
    if (current < 0) break;
    const rating = known.get(current), cost = rating == null ? 2 : 4;
    if (elapsed + cost > seconds) break;
    // Rate preloads one card before learning the current answer. Match that
    // behavior in both arms, including at the three-rating policy boundary.
    queued = s.nextBatch(3, held).find((i) => i !== current);
    s.answer(current, rating == null ? null : bucket(rating));
    elapsed += cost;
    asked++;
  }
  const result = { asked, rated: s.rated, seconds: elapsed, liked: null };
  if (s.rated < 3) return result;
  const scores = s.scores();
  const slate = [...grade.keys()].sort((a, b) => scores[b] - scores[a] || a - b).slice(0, 15);
  const { hero, items } = s.refinePicks(slate, [], false);
  result.liked = [hero, ...items].slice(0, 3).filter((i) => grade.get(i) >= 4).length / 3;
  return result;
}

export function compareQuiz(engine, user, seconds = 60) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw Error("A positive time budget is required");
  const known = appIndices(engine, user.known), hidden = appIndices(engine, user.hidden);
  for (const id of hidden.keys()) if (known.has(id)) throw Error("Film appears in quiz and holdout");
  const grade = new Map([...hidden].filter(([id]) => engine.films.votes[id] >= 2000));
  if (grade.size < 3) return null;
  const withheld = new Set(hidden.keys());
  return Object.fromEntries(["information", "decision"].map((policy) =>
    [policy, replay(engine, user.seed, policy, known, withheld, grade, seconds)]));
}

function summary(rows) {
  const paired = rows.filter((r) => r.information.liked != null && r.decision.liked != null);
  const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const diffs = paired.map(({ decision, information }) => decision.liked - information.liked);
  const delta = mean(diffs);
  const se = diffs.length > 1
    ? Math.sqrt(diffs.reduce((sum, d) => sum + (d - delta) ** 2, 0) / (diffs.length - 1) / diffs.length) : null;
  return { eligibleUsers: rows.length, bothReady: paired.length,
    arms: Object.fromEntries(["information", "decision"].map((policy) => [policy, {
      ready: rows.filter((r) => r[policy].liked != null).length,
      averageCards: mean(rows.map((r) => r[policy].asked)),
      averageRatings: mean(rows.map((r) => r[policy].rated)),
      averageSeconds: mean(rows.map((r) => r[policy].seconds)),
      historicalFourPlusShareAmongPaired: mean(paired.map((r) => r[policy].liked)),
      historicalFourPlusShareIncludingUnreadyAsZero: mean(rows.map((r) => r[policy].liked ?? 0)),
    }])),
    pairedDifference: delta, approximate95PercentPairedInterval: se === null ? null : [delta - 1.96 * se, delta + 1.96 * se] };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values } = parseArgs({ options: { data: { type: "string", default: "site/data" },
    seconds: { type: "string", default: "60" } } });
  const engine = loadData(values.data), rows = [];
  let users = 0;
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row = compareQuiz(engine, JSON.parse(line), Number(values.seconds));
    if (row) rows.push(row);
    users++;
  }
  if (!users) throw Error("Pipe MovieLens profiles from refinement_inputs.py to this script");
  console.log(JSON.stringify({ catalogueBuild: engine.meta.build, users, budgetSeconds: Number(values.seconds),
    costSeconds: { rated: 4, unseen: 2 }, metric: "Historical 4+ among three popular withheld films; simulated Rate-card time",
    ...summary(rows) }, null, 2));
}
