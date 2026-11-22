// Read a Letterboxd export (.zip, or its ratings/watched/watchlist/diary .csv) or an
// IMDb ratings export (.csv) into film indices. Everything happens on the phone.

/** Minimal .zip reader (stored or deflated entries), enough for a Letterboxd export. */
async function unzip(buf) {
  const dv = new DataView(buf), bytes = new Uint8Array(buf), out = new Map();
  let eocd = -1;
  for (let p = buf.byteLength - 22; p >= Math.max(0, buf.byteLength - 66000); p--) {
    if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error("that doesn't look like a .zip file");
  let p = dv.getUint32(eocd + 16, true);
  for (let n = dv.getUint16(eocd + 10, true); n > 0; n--) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!/(^|\/)(ratings|watched|watchlist|diary)\.csv$/.test(name) || name.includes("deleted/")) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.slice(start, start + size);
    const raw = method === 0 ? data : new Uint8Array(await new Response(
      new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    out.set(name.split("/").pop(), new TextDecoder().decode(raw));
  }
  return out;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (quoted) {
      if (c === '"') { if (text[k + 1] === '"') { field += '"'; k++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head = [], ...body] = rows;
  const keys = head.map((h) => h.replace(/^﻿/, "").trim());
  return { keys, rows: body.filter((r) => r.length > 1).map((r) => Object.fromEntries(keys.map((h, j) => [h, r[j] ?? ""]))) };
}

export function norm(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function titleKey(s) {
  return norm(s).replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/^(the|a|an) /, "")
    .replace(/\s+/g, " ").trim();
}

let matchIndex = null;

/** Find a film by title and year (Letterboxd), allowing the year to be off by one. */
function matchFilm(E, name, yr) {
  if (!matchIndex) {
    matchIndex = new Map();
    for (let i = 0; i < E.n; i++) {
      const key = `${titleKey(E.films.title[i])}|${E.films.year[i]}`;
      const prev = matchIndex.get(key);
      if (prev === undefined || E.films.votes[i] > E.films.votes[prev]) matchIndex.set(key, i);
    }
  }
  const t = titleKey(name), y = Number(yr);
  for (const d of [0, -1, 1]) {
    const i = matchIndex.get(`${t}|${y + d}`);
    if (i !== undefined) return i;
  }
  return undefined;
}

/** { ratings: [[film, stars]], seen: [film], saves: [film], logs: [[film, "YYYY-MM-DD", stars]],
 *  missing, invalidRatings }. Letterboxd diary rows become logs (and ratings too only when
 *  there's no ratings.csv, so films aren't counted twice). */
export async function readImport(file, E, source = "auto") {
  const zipped = /\.zip$/i.test(file.name) || file.type.includes("zip");
  const imdbHelp = "choose the CSV exported from IMDb’s Your Ratings page";
  if (source === "imdb" && zipped) throw new Error(imdbHelp);
  const files = zipped ? await unzip(await file.arrayBuffer()) : new Map([[file.name.toLowerCase(), await file.text()]]);
  const ratings = [], seen = [], saves = [], logs = [];
  const hasRatings = [...files.keys()].some((n) => /ratings/.test(n));
  let missing = 0, invalidRatings = 0;
  for (const [name, text] of files) {
    const { keys, rows } = parseCSV(text);
    if (source === "imdb" || keys.includes("Const") || keys.includes("Your Rating")) {
      if (!keys.includes("Your Rating") || !keys.includes("Const") && !keys.includes("URL")) throw new Error(imdbHelp);
      const importedIds = new Set();
      for (const r of rows) {
        const score = r["Your Rating"].trim();
        if (!/^(?:10|[1-9])$/.test(score)) { invalidRatings++; continue; }
        const ident = r.Const?.trim();
        const match = ident ? /^tt(\d+)$/i.exec(ident)
          : /^https?:\/\/(?:(?:www|m)\.)?imdb\.com\/title\/tt(\d+)(?:[/?#]|$)/i.exec(r.URL?.trim() || "");
        if (!match) { missing++; continue; }
        const id = Number(match[1]);
        if (importedIds.has(id)) continue;
        importedIds.add(id);
        const i = E.byImdb.get(id);
        if (i === undefined) { missing++; continue; }
        ratings.push([i, Number(score) / 2]);
      }
      continue;
    }
    const isDiary = /diary/.test(name);
    for (const r of rows) {
      if (!r.Name) continue;
      const i = matchFilm(E, r.Name, r.Year);
      const stars = Number(r.Rating) || null;
      if (i === undefined) { if (!isDiary) missing++; continue; }
      if (isDiary) {
        const date = (r["Watched Date"] || r.Date || "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) logs.push([i, date, stars]);
        if (hasRatings) continue;
      }
      if (/watchlist/.test(name)) saves.push(i);
      else if (stars) ratings.push([i, Math.min(5, Math.max(0.5, stars))]);
      else seen.push(i);
    }
  }
  return { ratings, seen, saves, logs, missing, invalidRatings };
}
