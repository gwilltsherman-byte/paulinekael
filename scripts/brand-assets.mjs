// Regenerate the committed brand assets. Requires the development-only sharp package.
// node scripts/brand-assets.mjs [absolute path to sharp's entry point]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { APP_MARK, BRAND, WORDMARK } from "../web/brand.js";

const { default: sharp } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : "sharp");
const root = new URL("../web/", import.meta.url);
const svg = (w, h, body, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${body}</svg>\n`;
const mark = `<path fill="${BRAND.gold}" d="${WORDMARK.k}"/>`;
const lettering = `${mark}<path fill="${BRAND.paper}" fill-rule="evenodd" d="${WORDMARK.ael}"/>`;
const background = (w, h, fill = BRAND.ink) => `<path fill="${fill}" d="M0 0H${w}V${h}H0Z"/>`;
const wordmark = svg(490, 128, lettering, "Kael");
const frame = `<path fill="${APP_MARK.colors.mark}" fill-rule="evenodd" d="${APP_MARK.path}"/>`;
const icon = svg(APP_MARK.field, APP_MARK.field, `${background(APP_MARK.field, APP_MARK.field, APP_MARK.colors.field)}${frame}`, "Kael");
// Enlarge the same frame optically for the browser tab.
const F = APP_MARK.favicon;
const favicon = svg(F.field, F.field, `<rect width="${F.field}" height="${F.field}" rx="${F.radius}" fill="${APP_MARK.colors.field}"/><g transform="translate(16 16) scale(${F.scale}) translate(-32 -32)">${frame}</g>`, "Kael");
const share = svg(1200, 630, `${background(1200, 630)}<g transform="translate(183.5 206.2) scale(1.7)">${lettering}</g>`, "Kael — a personal picture of cinema");

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
