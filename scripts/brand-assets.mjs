// Regenerate the committed brand assets. Requires the development-only sharp package.
// node scripts/brand-assets.mjs [absolute path to sharp's entry point]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { APP_MARK, BRAND, WORDMARK } from "../web/brand.js";

const { default: sharp } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : "sharp");
const root = new URL("../web/", import.meta.url);
const svg = (w, h, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${body}</svg>\n`;
const lettering = `<path fill="${BRAND.gold}" d="${WORDMARK.k}"/><path fill="${BRAND.paper}" d="${WORDMARK.ael}"/>`;
const background = (w, h, fill = BRAND.ink) => `<path fill="${fill}" d="M0 0H${w}V${h}H0Z"/>`;
const wordmark = svg(WORDMARK.width, WORDMARK.height, lettering, "Kael");
// The gold ticket and its ink K, turned together about the middle of the field.
const F = APP_MARK.field;
const ticket = `<g transform="rotate(${APP_MARK.angle} ${F / 2} ${F / 2})"><path fill="${BRAND.gold}" d="${APP_MARK.ticket}"/><path fill="${BRAND.ink}" d="${APP_MARK.letter}"/></g>`;
const icon = svg(F, F, `${background(F, F)}${ticket}`, "Kael");
// The browser tab: the K alone, larger and sturdier.
const V = APP_MARK.favicon;
const favicon = svg(V.field, V.field, `<rect width="${V.field}" height="${V.field}" rx="${V.radius}" fill="${BRAND.ink}"/><path fill="${BRAND.gold}" d="${V.letter}"/>`, "Kael");
// Link previews: the ticket beside the wordmark, centred on ink. The turned ticket is about
// 0.7 of the field wide; the lockup is that, a gap, then the wordmark.
const S = { w: 1200, h: 630, mark: 0.42, word: 1.45, gap: 44 };
const markW = 0.7 * F * S.mark, wordW = WORDMARK.width * S.word, left = (S.w - markW - S.gap - wordW) / 2;
const share = svg(S.w, S.h, `${background(S.w, S.h)}`
  + `<g transform="translate(${(left + markW / 2 - (F / 2) * S.mark).toFixed(1)} ${(S.h / 2 - (F / 2) * S.mark).toFixed(1)}) scale(${S.mark})">${ticket}</g>`
  + `<g transform="translate(${(left + markW + S.gap).toFixed(1)} ${((S.h - WORDMARK.height * S.word) / 2).toFixed(1)}) scale(${S.word})">${lettering}</g>`,
  "Kael — a personal picture of cinema");

async function png(source, width, height, file) {
  await sharp(Buffer.from(source)).resize(width, height).png().toFile(new URL(file, root).pathname);
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

// A changed manifest alone can still reuse an old cached image. Give install and
// browser-tab artwork an explicit revision while retaining the existing filenames.
const revision = `?v=${APP_MARK.version}`;
const page = new URL("index.html", root);
await writeFile(page, (await readFile(page, "utf8")).replace(
  /href="icons\/(kael-(?:apple-touch\.png|favicon\.png|favicon\.svg))(?:\?[^\"]*)?"/g,
  (_, file) => `href="icons/${file}${revision}"`,
));
const manifestURL = new URL("manifest.webmanifest", root);
await writeFile(manifestURL, (await readFile(manifestURL, "utf8")).replace(
  /("src"\s*:\s*")([^\"]+)(")/g,
  (_, before, source, after) => before + source.replace(/\?.*$/, "") + revision + after,
));
console.log("Generated Kael wordmark, mark, favicons, install icons and share artwork.");
