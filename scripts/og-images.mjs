#!/usr/bin/env node
// Draws the 1200×630 social preview image of every project (Open Graph / Twitter),
// from the list build.mjs writes to _site/og-manifest.json:
//   - a screenshot (assets/modules/<slug>.webp…) or the demo video's thumbnail, with
//     a name banner in the site's style;
//   - otherwise a title card: the project's logo (or the site's sigil), name and summary.
// Run after build.mjs: `node scripts/og-images.mjs`.
// `--assets` also redraws the committed site-wide images (assets/img/og-default.png,
// assets/img/favicon-192.png).
//
// Uses Chrome through playwright-core: CHROME_PATH, else the installed Google Chrome
// (ubuntu-latest runners have it). If no browser starts, every project gets a copy of
// og-default.png, so the tags never point at a missing file.

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.env.OUT_DIR || path.join(ROOT, "_site"));
const DEFAULT = "assets/img/og-default.png";
const FAVICON = "assets/img/favicon-192.png";
const W = 1200;
const H = 630;

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const font = async (pkg, file) => `data:font/woff2;base64,${(await readFile(path.join(ROOT, "node_modules", "@fontsource", pkg, "files", file))).toString("base64")}`;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
const dataUri = (buf, ext) => `data:${MIME[ext] || "application/octet-stream"};base64,${buf.toString("base64")}`;

async function localImage(rel) {
  if (!rel) return null;
  try { return dataUri(await readFile(path.join(ROOT, rel)), path.extname(rel).slice(1).toLowerCase()); } catch { return null; }
}

// maxresdefault is missing for some videos (YouTube then answers 404 with a grey 120×90 image)
async function thumbnail(id) {
  if (!id) return null;
  for (const name of ["maxresdefault", "sddefault", "hqdefault"]) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(id)}/${name}.jpg`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 4000) return dataUri(buf, "jpg");
    } catch { /* try the next size, then the title card */ }
  }
  return null;
}

const SIGIL = `<svg class="sigil" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 58 18v28L32 61 6 46V18Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 13 49 23v18L32 51 15 41V23Z" fill="currentColor" opacity=".18"/><path d="M32 13v38M15 23l34 18M49 23 15 41" stroke="currentColor" stroke-width="2" opacity=".55"/></svg>`;

async function css() {
  const faces = [
    ["Alegreya", "alegreya", "alegreya-latin-400-normal.woff2", 400],
    ["Alegreya SC", "alegreya-sc", "alegreya-sc-latin-700-normal.woff2", 700],
    ["Alegreya SC", "alegreya-sc", "alegreya-sc-latin-800-normal.woff2", 800],
    ["Signika", "signika", "signika-latin-500-normal.woff2", 500],
    ["Signika", "signika", "signika-latin-600-normal.woff2", 600],
  ];
  const ff = (await Promise.all(faces.map(async ([name, pkg, file, w]) => `@font-face{font-family:"${name}";font-weight:${w};src:url(${await font(pkg, file)}) format("woff2")}`))).join("");
  return `${ff}
*{box-sizing:border-box}html,body{margin:0}
body{width:${W}px;height:${H}px;overflow:hidden;position:relative;color:#e9e2d2;font-family:Signika,sans-serif;
  background-color:#1b1d24;
  background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px),
    radial-gradient(ellipse 80% 70% at 50% -10%,rgba(255,100,0,.22),transparent 70%);
  background-size:64px 64px,64px 64px,100% 100%}
.bars::before,.bars::after{content:"";position:absolute;left:0;right:0;height:8px;background:#e3a43a;z-index:3}
.bars::before{top:0}.bars::after{bottom:0}
.shot{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,16,21,0) 35%,rgba(15,16,21,.55) 55%,rgba(15,16,21,.96) 78%)}
.banner{position:absolute;left:0;right:0;bottom:8px;padding:0 64px 44px;z-index:2}
.name{font:800 76px/1.02 "Alegreya SC",serif;color:#fbf1dc;text-shadow:0 3px 0 #000,0 0 30px rgba(0,0,0,.6);margin:0}
.kind{margin-top:14px;font:600 28px/1.2 Signika,sans-serif;color:#e3a43a;display:flex;align-items:center;gap:16px}
.brand{position:absolute;top:36px;left:44px;z-index:2;display:flex;align-items:center;gap:14px;padding:10px 18px 10px 14px;border-radius:8px;
  background:rgba(27,29,36,.86);font:700 26px/1 "Alegreya SC",serif;color:#e9e2d2}
.brand .sigil{width:38px;height:38px;color:#ff6400}
.wip{display:inline-block;padding:6px 14px;border-radius:4px;font:700 22px/1 Signika,sans-serif;letter-spacing:.06em;color:#2a1b10;
  background:repeating-linear-gradient(-45deg,#e3a43a 0 10px,#cf8d24 10px 20px);box-shadow:0 0 0 2px #2a1b10}
.card{position:absolute;inset:8px 0;display:flex;align-items:center;gap:56px;padding:0 72px}
.tile{flex:none;width:340px;height:340px;border-radius:4px;display:grid;place-items:center;position:relative;
  background:radial-gradient(ellipse at 30% 20%,#2e323d,#1b1d24 75%);box-shadow:0 0 0 2px #e3a43a,0 20px 40px rgba(0,0,0,.6)}
.tile img{max-width:84%;max-height:84%}
.tile .sigil{width:62%;color:#ff6400;opacity:.85}
.tile .initials{position:absolute;font:800 84px/1 "Alegreya SC",serif;color:#fbf1dc;text-shadow:0 3px 0 #000}
.text{min-width:0}
.text .name{font-size:72px}
.summary{margin:20px 0 0;font:400 30px/1.35 Alegreya,serif;color:#e9e2d2;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.rule{height:6px;width:420px;margin:22px 0 0;background:#922610;clip-path:polygon(0 0,100% 50%,0 100%)}
.site{position:absolute;right:56px;bottom:40px;z-index:2;display:flex;align-items:center;gap:12px;font:700 26px/1 "Alegreya SC",serif;color:#a8a191}
.site .sigil{width:34px;height:34px;color:#ff6400}
.fav{width:192px;height:192px;background:none}
`;
}

const initials = (name) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3);

function pictureCard(item, picture) {
  return `<img class="shot" src="${picture}" alt="">
<div class="shade"></div>
<div class="brand">${SIGIL}Dxcufgb's Workshop</div>
<div class="banner"><h1 class="name">${esc(item.name)}</h1>
<div class="kind">${esc(item.kind)}${item.wip ? ` <span class="wip">WIP</span>` : ""}</div></div>`;
}

function titleCard(item, logo) {
  const art = logo ? `<img src="${logo}" alt="">` : `${SIGIL}<span class="initials">${esc(initials(item.name))}</span>`;
  return `<div class="card"><div class="tile">${art}</div>
<div class="text"><h1 class="name">${esc(item.name)}</h1>
<div class="kind">${esc(item.kind)}${item.wip ? ` <span class="wip">WIP</span>` : ""}</div>
<div class="rule"></div>
<p class="summary">${esc(item.summary || "")}</p></div></div>
<div class="site">${SIGIL}Dxcufgb's Workshop</div>`;
}

function defaultCard(site, tagline) {
  return `<div class="card"><div class="tile">${SIGIL}</div>
<div class="text"><h1 class="name">${esc(site)}</h1>
<div class="kind">Foundry VTT v13 modules and tools</div>
<div class="rule"></div>
<p class="summary">${esc(tagline)}</p></div></div>`;
}

async function launch() {
  const { chromium } = await import("playwright-core");
  const options = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" };
  return chromium.launch(options);
}

async function main() {
  const assets = process.argv.includes("--assets");
  const manifest = JSON.parse(await readFile(path.join(OUT, "og-manifest.json"), "utf8"));
  const config = JSON.parse(await readFile(path.join(ROOT, "site.config.json"), "utf8"));
  await mkdir(path.join(OUT, "og"), { recursive: true });

  let browser;
  try {
    browser = await launch();
  } catch (err) {
    console.warn(`[og] no browser (${err.message.split("\n")[0]}); every project gets ${DEFAULT}`);
    for (const item of manifest.items) await copyFile(path.join(ROOT, DEFAULT), path.join(OUT, item.file));
    return;
  }
  try {
    const style = await css();
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const render = async (body, file, { bars = true, size } = {}) => {
      if (size) await page.setViewportSize(size);
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body class="${bars ? "bars" : "fav"}">${body}</body></html>`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await mkdir(path.dirname(file), { recursive: true });
      await page.screenshot({ path: file, type: "png", omitBackground: !bars });
      if (size) await page.setViewportSize({ width: W, height: H });
    };

    if (assets) {
      await render(defaultCard(config.siteTitle, config.tagline || ""), path.join(ROOT, DEFAULT));
      const svg = await readFile(path.join(ROOT, "assets/img/favicon.svg"), "utf8");
      await render(`<img src="${dataUri(Buffer.from(svg), "svg")}" width="192" height="192" alt="">`, path.join(ROOT, FAVICON), { bars: false, size: { width: 192, height: 192 } });
      console.log(`[og] redrew ${DEFAULT} and ${FAVICON}`);
    }

    let pictures = 0;
    for (const item of manifest.items) {
      const picture = (await localImage(item.screenshot)) || (await thumbnail(item.video));
      const body = picture ? pictureCard(item, picture) : titleCard(item, await localImage(item.logo));
      if (picture) pictures++;
      await render(body, path.join(OUT, item.file));
    }
    console.log(`[og] ${manifest.items.length} social images (${pictures} from a screenshot or video, ${manifest.items.length - pictures} title cards)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
