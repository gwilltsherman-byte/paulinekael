import test from "node:test";
import assert from "node:assert/strict";
import { decodeTaste, encodeTaste, parseTasteLink, tasteLink } from "../web/share.js";

const DIM = 65;
const vec = Float64Array.from({ length: DIM }, (_, j) => Math.sin(j * 1.3) * 1.7);

/** The encoder as app.js had it before share.js (platform byte order, as on every phone). */
function oldEncode(w) {
  const q = new Int16Array(w.length);
  w.forEach((v, j) => { q[j] = Math.max(-32767, Math.min(32767, Math.round(v * 4096))); });
  return btoa(String.fromCharCode(...new Uint8Array(q.buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("encodeTaste gives exactly the links the app already made (old links keep working)", () => {
  assert.equal(encodeTaste(vec), oldEncode(vec));
});

test("a taste survives a round trip to within the 16-bit step", () => {
  const back = decodeTaste(encodeTaste(vec));
  assert.equal(back.length, DIM);
  back.forEach((v, j) => assert.ok(Math.abs(v - vec[j]) <= 1 / 8192 + 1e-12));
});

test("values beyond the range are clamped, not wrapped", () => {
  const back = decodeTaste(encodeTaste([100, -100, 0]));
  assert.deepEqual([...back], [32767 / 4096, -32767 / 4096, 0]);
});

test("a shared link opens as the friend it was made for", () => {
  const link = tasteLink("https://x.test/", "Ana", 42, vec), hash = link.slice(link.indexOf("#"));
  const got = parseTasteLink(hash, DIM);
  assert.equal(got.name, "Ana");
  assert.equal(got.rated, 42);
  assert.equal(got.code, encodeTaste(vec));
});

test("a name with ~ (which separates the parts) still works", () => {
  const link = tasteLink("https://x.test/", "A~B", 7, vec);
  assert.ok(!/#t=[^~]*~[^~]*~[^~]*~/.test(link), "the name's ~ must be escaped");
  assert.equal(parseTasteLink(link.slice(link.indexOf("#")), DIM).name, "A~B");
});

test("names with spaces, accents and emoji round trip; long ones are cut at 20 characters", () => {
  for (const name of ["Mary Ann", "José", "李雷", "🎬 Film Fan"]) {
    const hash = tasteLink("", name, 5, vec);
    assert.equal(parseTasteLink(hash, DIM).name, name);
  }
  const long = parseTasteLink(tasteLink("", "🎬".repeat(30), 5, vec), DIM).name;
  assert.equal([...long].length, 20);
  assert.equal(parseTasteLink(tasteLink("", "x".repeat(50), 5, vec), DIM).name.length, 20);
});

test("control characters are dropped from names; a name with nothing left is refused", () => {
  assert.equal(parseTasteLink(`#t=Bo%0Ab~3~${encodeTaste(vec)}`, DIM).name, "Bob");
  assert.equal(parseTasteLink(`#t=%0A%09~3~${encodeTaste(vec)}`, DIM), null);
  assert.equal(parseTasteLink(`#t=%20%20~3~${encodeTaste(vec)}`, DIM), null);
});

test("anything that isn't a usable link is null, and never throws", () => {
  const good = encodeTaste(vec);
  const bad = [
    "", "#", "#t=", "#f=123", `#t=Ana~5`, `#t=Ana~x~${good}`, `#t=Ana~5~`, `#t=Ana~5~${good}~extra`,
    `#t=%E0~5~${good}`,                 // not valid percent-encoding (this one used to throw)
    `#t=Ana~5~${good.slice(0, 20)}`,    // cut off: wrong size
    `#t=Ana~5~${good}AA`,               // too long
    "#t=Ana~5~AAA",                     // not a multiple of two bytes
    "#t=Ana~5~!!!!", "#t=Ana~5~a b",
  ];
  for (const h of bad) assert.equal(parseTasteLink(h, DIM), null, h);
});

test("a link made for a different model (another vector size) is refused", () => {
  assert.equal(parseTasteLink(tasteLink("", "Ana", 5, vec), DIM + 32), null);
  assert.ok(parseTasteLink(tasteLink("", "Ana", 5, vec), DIM));
});

test("the number of films rated is limited to something sane", () => {
  assert.equal(parseTasteLink(`#t=Ana~99999999999~${encodeTaste(vec)}`, DIM).rated, 99999);
});
