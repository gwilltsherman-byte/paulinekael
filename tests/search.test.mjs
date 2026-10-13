import test from "node:test";
import assert from "node:assert/strict";
import { Titles } from "../web/search.js";

const FILMS = [   // [title, votes]
  ["The Godfather", 2_000_000], ["Godfather", 3_000], ["The Godfather Part II", 1_400_000], ["Tokyo Godfathers", 60_000],
  ["Up", 1_100_000], ["Up in the Air", 400_000], ["Once Upon a Time in... Hollywood", 1_300_000], ["Upgrade", 250_000],
  ["Heat", 700_000], ["Heathers", 80_000], ["The Heat", 200_000], ["Wheat", 500],
  ["WALL·E", 1_200_000], ["The Wolf of Wall Street", 1_600_000], ["Amélie", 700_000], ["Spider-Man", 800_000],
  ["Pulp Fiction", 2_200_000], ["Pulp", 3_000], ["The Lord of the Rings", 30_000], ["The Lord of the Rings: The Fellowship of the Ring", 1_900_000],
  ["C++ for Beginners", 100], ["Se7en", 1_700_000],
];
const T = new Titles(FILMS.map(([t]) => t), FILMS.map(([, v]) => v));
const find = (q, n = 30) => T.find(q, n).map((i) => FILMS[i][0]);

test("an empty or blank query finds nothing", () => {
  assert.deepEqual(find(""), []);
  assert.deepEqual(find("   "), []);
});

test("a title that is the query beats ones that only contain it", () => {
  assert.equal(find("heat")[0], "Heat");
  assert.ok(find("heat").indexOf("Heat") < find("heat").indexOf("Wheat"));
  assert.equal(find("up")[0], "Up");
});

test("'the' and 'a' don't count when matching the start", () => {
  assert.equal(find("godfather")[0], "The Godfather");
  assert.equal(find("the godfather")[0], "The Godfather");
  assert.equal(find("heat")[1], "The Heat");
});

test("a famous film that starts with the words beats an obscure exact title", () => {
  assert.equal(find("pulp")[0], "Pulp Fiction");
  assert.equal(find("lord of the rings")[0], "The Lord of the Rings: The Fellowship of the Ring");
});

test("words that start words rank above words buried inside others", () => {
  const r = find("up");
  assert.ok(r.indexOf("Once Upon a Time in... Hollywood") < r.indexOf("Upgrade") || r.indexOf("Upgrade") >= 0);   // both found
  assert.ok(find("hea").indexOf("Heathers") < find("hea").indexOf("Wheat"));
});

test("accents and capitals don't matter", () => {
  assert.equal(find("amelie")[0], "Amélie");
  assert.equal(find("AMÉLIE")[0], "Amélie");
});

test("punctuation: 'wall-e', 'wall e' and 'spiderman' find the film", () => {
  assert.equal(find("wall e")[0], "WALL·E");
  assert.equal(find("wall-e")[0], "WALL·E");
  assert.equal(find("spiderman")[0], "Spider-Man");
  assert.equal(find("spider man")[0], "Spider-Man");
  assert.equal(find("se7en")[0], "Se7en");
});

test("characters that mean something in a regular expression are just characters", () => {
  assert.equal(find("c++")[0], "C++ for Beginners");
  assert.doesNotThrow(() => find("(["));
  assert.doesNotThrow(() => find("a.b*"));
  assert.deepEqual(find("zzzqqq"), []);
});

test("limit caps the list and keeps the best", () => {
  assert.equal(find("godfather", 2).length, 2);
  assert.deepEqual(find("godfather", 2), find("godfather").slice(0, 2));
});

test("warm() indexes in slices, and find() finishes what is left", () => {
  const titles = Array.from({ length: 1000 }, (_, i) => (i === 700 ? "Heat" : `Film number ${i}`)), votes = titles.map(() => 1000);
  const t = new Titles(titles, votes);
  assert.equal(t.warm(0), false);
  assert.equal(t.at, 256);                                // with no time to spare: one slice, never none
  let more = 0;
  while (!t.warm(0)) more++;
  assert.equal(more, 2);                                  // 512, 768, then the last 232
  assert.equal(t.at, 1000);
  const fresh = new Titles(titles, votes);
  assert.equal(fresh.at, 0);
  assert.equal(titles[fresh.find("heat")[0]], "Heat");    // find() warms the rest itself
  assert.equal(fresh.at, 1000);
});
