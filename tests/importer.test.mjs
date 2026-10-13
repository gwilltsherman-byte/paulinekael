import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { norm, readImport } from "../web/importer.js";

// A few films, as the app holds them: columns plus a map from IMDb id to row.
const FILMS = [
  [111161, "The Shawshank Redemption", 1994, 2_900_000],
  [211915, "Amélie", 2001, 700_000],
  [468569, "The Dark Knight", 2008, 2_800_000],
  [1, "Heat", 1995, 700_000],
  [2, "Heat", 1995, 100],                 // a worse-known film with the same title and year
  [3, "Law & Order", 1990, 5_000],
  [4, "A Quiet Place", 2018, 600_000],
];
const E = {
  n: FILMS.length,
  films: { title: FILMS.map((f) => f[1]), year: FILMS.map((f) => f[2]), votes: FILMS.map((f) => f[3]) },
  byImdb: new Map(FILMS.map((f, i) => [f[0], i])),
};
const at = (title, year) => FILMS.findIndex((f) => f[1] === title && f[2] === year);
const csv = (...lines) => lines.join("\n");
const file = (name, text, type = "text/csv") => new File([text], name, { type });

/** A .zip with the given [name, text, method] entries (method 0 stored, 8 deflated). */
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text, method = 8] of entries) {
    const raw = Buffer.from(text), data = method === 8 ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

test("norm drops accents and capitals", () => {
  assert.equal(norm("Amélie"), "amelie");
  assert.equal(norm("ÅNGSTRÖM"), "angstrom");
});

test("IMDb export: exact ids, ratings out of 10 become stars", async () => {
  const r = await readImport(file("ratings.csv", csv(
    "Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors",
    "tt0111161,10,2024-01-02,The Shawshank Redemption,u,movie,9.3,142,1994,Drama,1,1994-09-23,x",
    "tt0468569,9,2024-01-03,The Dark Knight,u,movie,9,152,2008,Action,1,2008-07-18,x",
    "tt0000000,7,2024-01-04,Unknown,u,movie,5,90,1990,Drama,1,1990-01-01,x")), E);
  assert.deepEqual(r.ratings, [[at("The Shawshank Redemption", 1994), 5], [at("The Dark Knight", 2008), 4.5]]);
  assert.equal(r.missing, 1);
  assert.deepEqual(r.seen, []);
});

test("Letterboxd ratings.csv: title and year, ratings out of 5, half stars kept", async () => {
  const r = await readImport(file("ratings.csv", csv("Date,Name,Year,Letterboxd URI,Rating", "2024-01-01,The Dark Knight,2008,u,4.5", "2024-01-01,Amélie,2001,u,0.5")), E);
  assert.deepEqual(r.ratings, [[at("The Dark Knight", 2008), 4.5], [at("Amélie", 2001), 0.5]]);
});

test("titles match without accents, 'The', '&', punctuation, or with a year off by one", async () => {
  const r = await readImport(file("ratings.csv", csv(
    "Date,Name,Year,Letterboxd URI,Rating",
    "d,Amelie,2001,u,4", "d,Dark Knight,2008,u,4", "d,Law and Order,1990,u,3", "d,Quiet Place,2018,u,4",
    "d,Shawshank Redemption,1993,u,5",       // year off by one
    "d,Shawshank Redemption,1990,u,5")), E);   // off by four: not it
  assert.equal(r.ratings.length, 5);
  assert.equal(r.missing, 1);
});

test("two films with the same title and year: the better-known one", async () => {
  const r = await readImport(file("ratings.csv", csv("Date,Name,Year,Letterboxd URI,Rating", "d,Heat,1995,u,4")), E);
  assert.deepEqual(r.ratings, [[0 + at("Heat", 1995), 4]]);
  assert.equal(E.films.votes[r.ratings[0][0]], 700_000);
});

test("watched.csv has films without ratings; watchlist.csv is saves", async () => {
  const z = zip([["watched.csv", csv("Date,Name,Year,Letterboxd URI", "d,Heat,1995,u", "d,Amelie,2001,u")], ["watchlist.csv", csv("Date,Name,Year,Letterboxd URI", "d,The Dark Knight,2008,u")]]);
  const r = await readImport(file("letterboxd.zip", z, "application/zip"), E);
  assert.deepEqual(r.seen.sort(), [at("Heat", 1995), at("Amélie", 2001)].sort());
  assert.deepEqual(r.saves, [at("The Dark Knight", 2008)]);
  assert.deepEqual(r.ratings, []);
});

test("a diary with a ratings.csv adds dated logs but not second ratings; without one, it rates", async () => {
  const diary = csv("Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date", "d,Heat,1995,u,4,,,2024-03-05", "d,Heat,1995,u,,Yes,,2024-06-01");
  const ratings = csv("Date,Name,Year,Letterboxd URI,Rating", "d,Heat,1995,u,4");
  const both = await readImport(file("x.zip", zip([["diary.csv", diary], ["ratings.csv", ratings]]), "application/zip"), E);
  assert.deepEqual(both.logs, [[at("Heat", 1995), "2024-03-05", 4], [at("Heat", 1995), "2024-06-01", null]]);
  assert.equal(both.ratings.length, 1);
  const alone = await readImport(file("x.zip", zip([["diary.csv", diary]]), "application/zip"), E);
  assert.equal(alone.logs.length, 2);
  assert.deepEqual(alone.ratings, [[at("Heat", 1995), 4]]);
  assert.equal(alone.seen.length, 1);   // the unrated rewatch
});

test("zips: stored and deflated entries, files in folders, deleted/ ignored", async () => {
  const body = csv("Date,Name,Year,Letterboxd URI,Rating", "d,Heat,1995,u,3");
  for (const method of [0, 8]) {
    const r = await readImport(file("export.zip", zip([["letterboxd-me-2024/ratings.csv", body, method], ["letterboxd-me-2024/deleted/ratings.csv", csv("Date,Name,Year,Letterboxd URI,Rating", "d,Amelie,2001,u,5"), method], ["letterboxd-me-2024/profile.csv", "x"]]), "application/zip"), E);
    assert.deepEqual(r.ratings, [[at("Heat", 1995), 3]], `method ${method}`);
  }
});

test("CSV details: quotes, commas and newlines inside fields, a BOM, CRLF line ends", async () => {
  const text = "﻿Date,Name,Year,Letterboxd URI,Rating\r\n" + 'd,"Law & Order",1990,"u,with,commas",4\r\n' + 'd,"""Heat""",1995,u,3\r\n';
  const r = await readImport(file("ratings.csv", text), E);
  // "Law & Order" came through the quoted field, and a title that itself has quotation
  // marks ("Heat") still finds the film, since matching ignores punctuation.
  assert.deepEqual(r.ratings, [[at("Law & Order", 1990), 4], [at("Heat", 1995), 3]]);
  assert.equal(r.missing, 0);
});

test("ratings are kept inside 0.5 to 5; blank or zero ratings are 'watched', not rated", async () => {
  const r = await readImport(file("ratings.csv", csv("Const,Your Rating", "tt0111161,12", "tt0468569,0", "tt0211915,")), E);
  assert.deepEqual(r.ratings, [[at("The Shawshank Redemption", 1994), 5]]);
  assert.deepEqual(r.seen.sort(), [at("The Dark Knight", 2008), at("Amélie", 2001)].sort());
});

test("things that aren't exports are refused or empty, never a crash", async () => {
  await assert.rejects(readImport(file("x.zip", Buffer.from("this is not a zip file at all, just text"), "application/zip"), E), /zip/);
  const r = await readImport(file("notes.csv", "hello,world\n1,2"), E);
  assert.deepEqual([r.ratings, r.seen, r.saves, r.logs, r.missing], [[], [], [], [], 0]);
  const empty = await readImport(file("ratings.csv", ""), E);
  assert.equal(empty.ratings.length, 0);
});
