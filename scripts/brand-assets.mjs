// Regenerate the committed brand assets. Requires the development-only sharp package.
// node scripts/brand-assets.mjs [absolute path to sharp's entry point]
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { BRAND, TICKET, WORDMARK } from "../web/brand.js";

const { default: sharp } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : "sharp");
const root = new URL("../web/", import.meta.url);
const svg = (w, h, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${body}</svg>\n`;
const mark = `<path fill="${BRAND.gold}" d="${WORDMARK.k}"/>`;
const lettering = `${mark}<path fill="${BRAND.paper}" fill-rule="evenodd" d="${WORDMARK.ael}"/>`;
const background = (w, h, fill = BRAND.ink) => `<path fill="${fill}" d="M0 0H${w}V${h}H0Z"/>`;
const wordmark = svg(490, 128, lettering, "Kael");
// A bright red ticket stub on white, with the K and the two tear-line notches cut through it.
function ticket(transform) {
  const { width: w, height: h, radius, notch, tear } = TICKET;
  const cuts = `<circle cx="${-w / 2}" cy="${tear}" r="${notch}"/><circle cx="${w / 2}" cy="${tear}" r="${notch}"/>`
    + `<g transform="translate(-58 -136) scale(1.42)"><path d="${WORDMARK.k}"/></g>`;
  return `<mask id="stub"><g transform="${transform}"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${radius}" fill="#fff"/>`
    + `<g fill="#000">${cuts}</g></g></mask><path fill="${BRAND.red}" mask="url(#stub)" d="M0 0H9999V9999H0Z"/>`;
}
// The tilted ticket, corners included, stays inside the central 80% circle that maskable icons keep.
const icon = svg(512, 512, `${background(512, 512, BRAND.white)}${ticket("translate(256 256) rotate(-9) scale(.92)")}`, "Kael");
// A larger, upright ticket keeps the K legible in a 16px browser tab.
const favicon = svg(160, 160, `${background(160, 160, BRAND.white)}${ticket("translate(80 80) scale(.42)")}`, "Kael");
const share = svg(1200, 630, `${background(1200, 630)}<g transform="translate(183.5 206.2) scale(1.7)">${lettering}</g>`, "Kael — a personal picture of cinema");

// Keep artwork provenance inside each PNG when assets are regenerated.
const origin = "Original Kael geometric wordmark and split-K artwork. Authored as vector paths in web/brand.js; rasterized by scripts/brand-assets.mjs using sharp. No stock or generated imagery.";
async function png(source, width, height, file) {
  const pixels = await sharp(Buffer.from(source)).resize(width, height).png().toBuffer();
  const text = Buffer.from(`impeccable:prompt\0${origin}`, "latin1");
  const chunk = Buffer.alloc(text.length + 12);
  chunk.writeUInt32BE(text.length);
  chunk.write("tEXt", 4);
  text.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  await writeFile(new URL(file, root), Buffer.concat([pixels.subarray(0, -12), chunk, pixels.subarray(-12)]));
}

await mkdir(new URL("brand/", root), { recursive: true });
await mkdir(new URL("icons/", root), { recursive: true });
await writeFile(new URL("brand/kael-wordmark.svg", root), wordmark);
await writeFile(new URL("brand/kael-mark.svg", root), icon);
await writeFile(new URL("icons/kael-favicon.svg", root), favicon);
for (const [name, size] of [["kael-192", 192], ["kael-512", 512], ["kael-apple-touch", 180]]) {
  await png(icon, size, size, `icons/${name}.png`);
}
await png(favicon, 32, 32, "icons/kael-favicon.png");
await png(share, 1200, 630, "icons/kael-share.png");
console.log("Generated Kael wordmark, mark, favicons, install icons and share artwork.");
