import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the production presentation and share helpers with a fixed forecast.
const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace(/\nstart\(\);\s*$/, "");

function profile(rated, { forecast = .85, contentOnly = false } = {}) {
  let shared;
  const ctx = vm.createContext({
    document: {}, localStorage: { getItem: () => null },
    location: { origin: "https://example.test", pathname: "/kael/" },
    navigator: { share: async (args) => { shared = args; } },
  });
  vm.runInContext(`${source}
    E = { match: () => ${forecast}, flags: [${contentOnly ? 1 : 0}],
          films: { title: ["City Lights"], year: [1931], imdb: [21749] } };
    S = { rated: ${rated}, answers: new Map(), sd: () => 0.3, scores: () => [4.5] };
    home = {sc: [4.5]};
    globalThis.api = {
      pill: () => matchPill(0, 4.5, true), share: () => shareFilm(0),
      shelf: shared => shelfHtml({items: [0], title: "Picks", shared}),
    };`, ctx);
  return { ...ctx.api, shared: () => shared };
}

test("early profiles get accessible qualitative estimates in badges and shared links", async () => {
  for (const n of [3, 5, 10, 19]) {
    const p = profile(n);
    assert.match(p.pill(), /aria-label="Promising pick\. Early estimate from your ratings\./);
    assert.doesNotMatch(p.pill(), /%/);
    await p.share();
    assert.match(p.shared().text, /promising pick for me/);
    assert.doesNotMatch(p.shared().text, /%/);
  }
  assert.match(profile(5, { forecast: .5 }).pill(), /Possible pick/);
  assert.match(profile(5, { forecast: .25 }).pill(), /Long shot/);
});

test("uncalibrated film estimates stay qualitative even with a long profile", () => {
  const p = profile(40, { contentOnly: true });
  assert.doesNotMatch(p.pill(), /%/);
  assert.match(p.pill(), /Estimated from film details/);
});

test("joint picks do not present the viewer's probability as a shared forecast", () => {
  const p = profile(20);
  assert.match(p.shelf(false), /85% match/);
  assert.doesNotMatch(p.shelf(true), /% match/);
  assert.match(p.shelf(true), /City Lights/);
});

test("profiles without enough ratings show no prediction; mature estimates explain their target", async () => {
  assert.equal(profile(2).pill(), "");
  const mature = profile(20);
  assert.match(mature.pill(), /≈85% match/);
  assert.match(mature.pill(), /four stars or higher/);
  await mature.share();
  assert.match(mature.shared().text, /≈85% match for me/);
});
