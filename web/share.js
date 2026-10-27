// Links between phones. A friend's taste is #t=<name>~<films rated>~<taste code> and a
// film is #f=<IMDb id> (see app.js). Parsing never throws: a link that is cut off,
// edited, or made for an older model is ignored.

const NAME_MAX = 20;

/** A taste vector as short URL-safe text (16-bit fixed point, little-endian). */
export function encodeTaste(w) {
  const dv = new DataView(new ArrayBuffer(w.length * 2));
  w.forEach((v, j) => dv.setInt16(j * 2, Math.max(-32767, Math.min(32767, Math.round(v * 4096))), true));
  return btoa(String.fromCharCode(...new Uint8Array(dv.buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The vector encodeTaste made. Throws if the text isn't one. */
export function decodeTaste(code) {
  const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  if (bin.length % 2) throw new Error("not a taste code");
  const dv = new DataView(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer);
  return Float64Array.from({ length: bin.length / 2 }, (_, j) => dv.getInt16(j * 2, true) / 4096);
}

/** The link that shares a person's taste. encodeURIComponent leaves "~" alone, but "~"
 *  separates the parts, so it is escaped too. */
export function tasteLink(base, name, rated, mean) {
  return `${base}#t=${encodeURIComponent(name).replace(/~/g, "%7E")}~${rated}~${encodeTaste(mean)}`;
}

/** {name, rated, code} from a "#t=..." hash, or null if it isn't a usable taste link
 *  for a model whose taste vectors have dim numbers. */
export function parseTasteLink(hash, dim) {
  const m = /^#t=([^~]+)~(\d+)~([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  let name;
  try { name = decodeURIComponent(m[1]); } catch { return null; }
  name = [...name.replace(/[\u0000-\u001f\u007f]/g, "").trim()].slice(0, NAME_MAX).join("");
  if (!name) return null;
  try { if (decodeTaste(m[3]).length !== dim) return null; } catch { return null; }
  return { name, rated: Math.min(Number(m[2]), 99999), code: m[3] };
}
