// Things that must stay true between the app's files, which nothing else would notice
// until a phone went offline or kept stale data.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const read = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
const shellFiles = JSON.parse(read("sw.js").match(/const SHELL_FILES = (\[[^\]]*\])/)[1]);
const modules = readdirSync(new URL("../web/", import.meta.url)).filter((f) => f.endsWith(".js") && f !== "sw.js");

test("every file the service worker keeps for offline use exists", () => {
  for (const f of shellFiles) assert.ok(f === "./" || existsSync(new URL(`../web/${f}`, import.meta.url)), `${f} is in SHELL_FILES but not in web/`);
});

test("every module the app imports is kept for offline use (a missing one breaks the first offline launch)", () => {
  for (const f of modules) {
    for (const [, dep] of read(f).matchAll(/from "\.\/([\w-]+\.js)"/g)) assert.ok(shellFiles.includes(dep), `${f} imports ${dep}, which sw.js doesn't list`);
  }
  assert.ok(shellFiles.includes("app.js") && shellFiles.includes("index.html") && shellFiles.includes("app.css"));
});

test("the page's module preloads are real, listed files", () => {
  const html = read("index.html");
  const preloaded = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(preloaded.length >= 4);
  for (const f of preloaded) assert.ok(shellFiles.includes(f) && existsSync(new URL(`../web/${f}`, import.meta.url)), f);
});

test("the manifest's icons exist", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  for (const i of [...m.icons, ...m.shortcuts.flatMap((s) => s.icons ?? [])]) assert.ok(existsSync(new URL(`../web/${i.src}`, import.meta.url)), i.src);
  assert.equal(m.id, "./");
});

test("data files are only fetched with ?v=<build>, since netlify.toml caches them for a year", () => {
  for (const f of ["app.js", "engine.js"]) {
    for (const [, arg] of read(f).matchAll(/\bfetch\(([^)]*)\)/g)) {
      assert.ok(arg.includes("?v=") || arg.includes("meta.json"), `${f}: fetch(${arg}) is not versioned`);
    }
  }
  // ...and the file that names the build is the one thing that is never cached that long.
  const toml = read("netlify.toml");
  assert.ok(!/for = "\/data\/meta\.json"[^[]*immutable/.test(toml));
  assert.ok(!/for = "\/data\/\*"/.test(toml), "a blanket /data/* rule would cover meta.json");
});

test("the Content-Security-Policy keeps scripts to this site and allows what the app uses", () => {
  const csp = read("netlify.toml").match(/Content-Security-Policy = "([^"]+)"/)[1];
  const dir = (name) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
  assert.equal(dir("script-src"), "script-src 'self'");
  assert.ok(dir("img-src").includes("https://image.tmdb.org") && dir("img-src").includes("data:") && dir("img-src").includes("blob:"));
  assert.ok(dir("frame-src").includes("https://www.youtube-nocookie.com"));
  assert.equal(dir("object-src"), "object-src 'none'");
  assert.equal(dir("frame-ancestors"), "frame-ancestors 'none'");
  assert.ok(!/script-src[^;]*unsafe/.test(csp));
});

test("the page has no inline scripts or event handlers for the policy to block", () => {
  const html = read("index.html");
  assert.ok(![...html.matchAll(/<script\b([^>]*)>/g)].some(([, a]) => !/src=|type="application\/ld\+json"/.test(a)), "inline <script>");
  assert.ok(!/\son(click|load|error|change|submit)=/i.test(html), "inline event handler");
});
