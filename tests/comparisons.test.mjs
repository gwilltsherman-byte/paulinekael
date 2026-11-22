import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { Session } from "../web/engine.js";
import { makeEngine } from "./helpers.mjs";

const engine = makeEngine({ n: 80, pool: 30 });
const ratings = [[0, "liked"], [1, "liked"], [2, "liked"], [3, null]];
const shortlist = Array.from({ length: 15 }, (_, j) => j + 4);
const ids = (films) => films.map((i) => engine.films.imdb[i]);
const top3 = (result) => [result.hero, ...result.items.slice(0, 2)];
const session = () => new Session(engine, ratings);
const record = (s, pair, winner) => [...ids(pair), winner === null ? null : engine.films.imdb[winner], s.rated];

test("only a comparison with a different hero or top-three selection is offered", () => {
  const s = session(), before = s.refinePicks(shortlist), pair = before.pair;
  assert.ok(pair && pair.every((i) => s.answers.get(i) === "liked"));
  const original = [...s.scores()], originalMean = [...s.mean], originalCov = [...s.cov];
  const [left, right] = pair.map((winner) => s.refinePicks(shortlist, [record(s, pair, winner)]));
  const a = top3(left), b = top3(right);
  assert.ok(a[0] !== b[0] || a.some((i) => !b.includes(i)));
  for (const result of [left, right]) {
    assert.deepEqual(new Set([result.hero, ...result.items]), new Set(shortlist));
    assert.equal(result.pair, null);
  }
  assert.deepEqual([...s.scores()], original);
  assert.deepEqual([...s.mean], originalMean);
  assert.deepEqual([...s.cov], originalCov);
  assert.equal(s.rated, 3);
  // With no comparison, preserve the original hero and match-ordered shelf.
  const match = (i) => engine.match(original[i], s.sd(i));
  const sort = (films) => films.slice().sort((a, b) => match(b) - match(a));
  assert.equal(before.hero, sort(shortlist.slice(0, 6))[0]);
  assert.deepEqual(before.items, sort(shortlist.filter((i) => i !== before.hero)));
});

test("skip and uncertain recognition never change ranking or ask a declined pair again", () => {
  const s = session(), before = s.refinePicks(shortlist), skipped = record(s, before.pair, null);
  const after = s.refinePicks(shortlist, [skipped]);
  assert.equal(after.pair, null);
  assert.equal(after.hero, before.hero);
  assert.deepEqual(after.items, before.items);
  s.answer(19, "liked");
  const next = s.refinePicks(shortlist, [skipped]).pair;
  assert.ok(!next || next.some((i) => !before.pair.includes(i)));

  const variedRatings = new Session(engine, [[0, "loved"], [1, "disliked"], [2, "meh"], [3, null]], [4]);
  assert.equal(variedRatings.refinePicks(shortlist).pair, null);
  assert.equal(s.refinePicks(shortlist, [], false).pair, null);
  const stable = [4, 5, 6, 7, 8];
  s.direction = () => new Float64Array(engine.k).fill(1);
  assert.equal(s.refinePicks(stable).pair, null, "indistinguishable shortlist needs no comparison");
});

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/\nstart\(\);\s*$/, "");
const key = "mt.comparisons.v1", stored = new Map();
const plain = (value) => JSON.parse(JSON.stringify(value));

function makeApp() {
  const localStorage = {
    getItem: (k) => stored.get(k) ?? null,
    setItem: (k, value) => stored.set(k, value),
    removeItem: (k) => stored.delete(k),
  };
  const context = vm.createContext({
    Session, localStorage,
    document: { getElementById: () => ({ querySelector: () => null }) },
    location: { reload() {} },
  });
  vm.runInContext(source + `
    globalThis.setup = (engine, s, shortlist) => {
      E = engine; S = s; view = "home";
      refresh = () => { home = S.refinePicks(shortlist, comparisons); };
      refresh(); let undo;
      toast = (msg, handler) => { undo = handler; };
      return {
        get current() { return home; },
        async choose(choice) { openSheet = async () => choice; await comparePicks(); },
        undo() { undo(); },
        clean: clean.comparisons,
        async restore(data, choice) {
          openSheet = async () => choice;
          await restoreBackup({ text: async () => JSON.stringify({ app: "kael", data }) });
        }
      };
    };`, context);
  return context.setup(engine, session(), shortlist);
}

test("comparison choices, skip and undo survive the relevant save/restore flows", async () => {
  stored.clear();
  let app = makeApp();
  const before = app.current, pair = before.pair, winner = engine.films.imdb[pair[0]];
  await app.choose("pick:" + winner);
  const saved = JSON.parse(stored.get(key));
  assert.deepEqual(saved, [[...ids(pair).sort((a, b) => a - b), winner, 3]]);
  const expected = plain(app.current);
  const reloaded = makeApp();
  assert.deepEqual(plain(reloaded.current), expected);
  app.undo();
  assert.deepEqual(JSON.parse(stored.get(key)), []);
  await app.choose("skip");
  assert.equal(makeApp().current.pair, null);
  const skipped = JSON.parse(stored.get(key));
  assert.equal(skipped[0][2], null);
  await makeApp().restore({ [key]: [saved[0], [4, 4, 9, 3]] }, "merge");
  assert.deepEqual(JSON.parse(stored.get(key)), skipped, "local answer wins merge");
  await makeApp().restore({ [key]: [saved[0], saved[0], [5, 7, 3, 2]] }, "replace");
  assert.deepEqual(JSON.parse(stored.get(key)), saved);
  await makeApp().restore({}, "replace");
  assert.equal(stored.has(key), false, "legacy backup clears on explicit replace");
});
