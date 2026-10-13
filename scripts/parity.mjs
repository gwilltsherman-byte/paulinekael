// Check the phone engine (web/engine.js) against the Python engine on one scripted session.
//   node scripts/parity.mjs   (after python -m taste.web --out site and python scripts/parity_fixture.py)
import { readFileSync } from "node:fs";
import { Engine, Session } from "../web/engine.js";

const dir = new URL("../site/data/", import.meta.url);
const bin = (f, T) => new T(readFileSync(new URL(f, dir)).buffer.slice(0));
const json = (f) => JSON.parse(readFileSync(new URL(f, dir)));
const e = new Engine(json("meta.json"), json("films.json"), bin("vectors.bin", Int8Array),
  bin("bias.bin", Float32Array), bin("flags.bin", Uint8Array), bin("seen.bin", Int8Array));
const want = JSON.parse(readFileSync(new URL("../data/processed/parity_expected.json", import.meta.url)));

const s = new Session(e, want.answers.map(([id, a]) => [e.byImdb.get(id), a]));
const sc = s.scores();
const order = [...sc.keys()].sort((a, b) => sc[b] - sc[a]).slice(0, 10);
const got = order.map((i) => e.films.imdb[i]);
const overlap = got.filter((id) => want.top_imdb.includes(id)).length;
const errs = want.top_imdb.map((id, r) => Math.abs(sc[e.byImdb.get(id)] - want.top_mean[r]));
const sdErr = want.top_imdb.map((id, r) => Math.abs(s.sd(e.byImdb.get(id)) - want.top_sd[r]));
const push = s.maxPush(want.top_imdb.map((id) => e.byImdb.get(id)));
const pushErr = Math.max(...push.map((v, r) => Math.abs(v - want.top_push[r])));
console.log(`single-film push: max |Δ| ${pushErr.toFixed(4)} stars ${pushErr < 0.01 ? "✓" : "✗"}`);
const next = e.films.imdb[s.next()];
const expl = s.explain(e.byImdb.get(want.top_imdb[0]), 2, 0).map((i) => e.films.imdb[i]);
console.log(`top-10 overlap ${overlap}/10; max |Δ predicted stars| ${Math.max(...errs).toFixed(4)}; max |Δ sd| ${Math.max(...sdErr).toFixed(4)}`);
console.log(`next question: python ${want.next_imdb} js ${next} ${want.next_imdb === next ? "✓" : "✗"}`);
console.log(`explanation: python ${want.explain_top1} js ${expl} ${String(want.explain_top1) === String(expl) ? "✓" : "✗"}`);
console.log("top titles:", order.slice(0, 5).map((i) => `${e.films.title[i]} (${e.films.year[i]}) ${sc[i].toFixed(2)}`).join(" | "));
