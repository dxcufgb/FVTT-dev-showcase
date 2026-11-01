#!/usr/bin/env node
// Renders the static site into _site/ from data/site-data.json + site.config.json.
//
// Per-module extras, all optional:
//   assets/modules/<slug>.(webp|png|jpg|jpeg|gif)  card image (fills the card)
//   assets/modules/<slug>-logo.(png|svg|webp)      card logo (centred on the default background)
//   content/<slug>.md                              replaces the README on the module page
//   site.config.json → projects["<repo>"]           include, kind, title, summary, description, image, videos,
//                                                   wip, details, stripReadmeSections, hidden, seoTitle,
//                                                   seoDescription, foundryPackage, operatingSystem, wiki
//
// Search engine pages are generated here too: titles, descriptions, canonical links,
// Open Graph / Twitter tags, JSON-LD, the docs mirror of each GitHub wiki,
// sitemap.xml and robots.txt. scripts/og-images.mjs then draws the social images
// listed in _site/og-manifest.json.

import { readFile, writeFile, mkdir, cp, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Marked } from "marked";
import * as seo from "./lib/seo.mjs";
import { buildDocs, firstSentence, firstText } from "./lib/wiki.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// DATA_FILE / OUT_DIR: the tests build a made-up project list into a temp folder
const OUT = path.resolve(process.env.OUT_DIR || path.join(ROOT, "_site"));
const config = JSON.parse(await readFile(path.join(ROOT, "site.config.json"), "utf8"));
const data = JSON.parse(await readFile(process.env.DATA_FILE || path.join(ROOT, "data", "site-data.json"), "utf8"));
const OWNER = data.owner;
// Per-repo settings live under "projects" (older configs used "modules").
const PROJECTS = { ...(config.modules || {}), ...(config.projects || {}) };
const DIR = "projects"; // URL folder for the project list and pages
// Absolute address of the site, for canonical links, social tags and the sitemap.
// In Actions, configure-pages gives it (SITE_URL); otherwise site.config.json.
// every description handed out so far, so a docs page never repeats another page's
const usedDescriptions = new Set();
const SITE = (process.env.SITE_URL || config.siteUrl || `https://${OWNER}.github.io/`).replace(/\/?$/, "/");
const abs = (p = "") => SITE + p.replace(/^\.?\//, "");
const OG_DEFAULT = "assets/img/og-default.png";

const exists = (p) => access(p).then(() => true, () => false);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const fmtNum = (n) => (n == null ? "—" : new Intl.NumberFormat("en-US").format(n));
const major = (v) => (v == null ? null : String(v).split(".")[0]);

function foundryRange(c = {}) {
  const lo = major(c.minimum), hi = major(c.maximum) || major(c.verified);
  if (!lo && !hi) return "Unknown";
  if (!lo || lo === hi) return `v${hi || lo}`;
  return `v${lo}–v${hi}`;
}

// ---------- markdown ----------
// GitHub-style heading ids, so "#section" links from the wikis keep working.
function slugger() {
  const seen = new Map();
  return (text) => {
    let id = String(text).toLowerCase().trim().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    return n ? `${id}-${n}` : id;
  };
}

// Links to a listed project's GitHub wiki go to its docs mirror on this site.
function docsHref(mod, pageName, hash = "", base = "") {
  const key = String(pageName || "Home").replace(/\.md$/i, "").replace(/\s+/g, "-").toLowerCase();
  const page = mod.docs?.pages.find((p) => p.name.toLowerCase() === key || (key === "home" && p.slug === ""));
  if (!page) return null;
  return `${base}${DIR}/${mod.slug}/docs/${page.slug ? `${page.slug}/` : ""}${hash || ""}`;
}
function mapWikiUrl(href, base) {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)\/wiki\/?([^#?]*)(#.*)?$/i.exec(href);
  if (!m) return null;
  const target = byRepo.get(`${m[1]}/${m[2]}`.toLowerCase());
  return target ? docsHref(target, decodeURIComponent(m[3] || "Home"), m[4], base) : null;
}

// opts: base (relative path to the site root), wiki (rendering a wiki page),
// minDepth (headings never above this level, e.g. release notes under an h2)
function markdownFor(mod, opts = {}) {
  const { base = "", wiki = false, minDepth = 1 } = opts;
  const md = new Marked({ gfm: true });
  const blob = `https://github.com/${OWNER}/${mod.repo}/blob/${mod.branch}/`;
  const rawBase = wiki ? `https://raw.githubusercontent.com/wiki/${OWNER}/${mod.repo}/` : `https://raw.githubusercontent.com/${OWNER}/${mod.repo}/${mod.branch}/`;
  const relative = (u) => u && !/^([a-z]+:|#|\/\/)/i.test(u);
  const slug = slugger();
  md.use({
    extensions: [{
      // [[Page]] and [[Page|label]] wiki links
      name: "wikilink", level: "inline",
      start: (src) => src.indexOf("[["),
      tokenizer(src) {
        const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
        if (m) return { type: "wikilink", raw: m[0], page: m[1].trim(), label: (m[2] || m[1]).trim() };
      },
      renderer(t) {
        const href = docsHref(mod, t.page, "", base) || `${mod.url}/wiki/${encodeURIComponent(t.page.replace(/\s+/g, "-"))}`;
        return `<a href="${esc(href)}">${esc(t.label)}</a>`;
      },
    }],
    walkTokens(t) {
      if (t.type === "link") {
        const mapped = /^https?:/i.test(t.href) ? mapWikiUrl(t.href, base) : null;
        if (mapped) t.href = mapped;
        else if (wiki && relative(t.href) && !/\.[a-z0-9]{2,4}(#|$)/i.test(t.href)) {
          const [page, hash] = t.href.split(/(?=#)/);
          t.href = docsHref(mod, page, hash, base) || `${mod.url}/wiki/${t.href}`;
        } else if (relative(t.href)) t.href = (wiki ? rawBase : blob) + t.href.replace(/^\.?\//, "");
      }
      if (t.type === "image" && relative(t.href)) t.href = rawBase + t.href.replace(/^\.?\//, "");
    },
    renderer: {
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const ext = /^https?:/.test(href) ? ' rel="noopener" target="_blank"' : "";
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}${ext}>${text}</a>`;
      },
      heading({ tokens, depth, text }) {
        const level = Math.min(6, Math.max(minDepth, depth));
        return `<h${level} id="${esc(slug(text))}">${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
    },
  });
  const tidy = (html) => html
    .replace(/(<img[^>]+src=")(?!https?:|data:|\/\/)\.?\/?([^"]+)"/g, `$1${rawBase}$2"`)
    .replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>")
    .replace(/<img /g, '<img loading="lazy" decoding="async" ');
  return {
    render: (src) => tidy(md.parse(src || "")),
    tidy,
    lexer: (src) => md.lexer(src || ""),
    parser: (tokens) => md.parser(tokens),
  };
}

// README → page body: drop the H1, the badge row and sections that the page already covers.
function readmeHtml(mod, mdk) {
  const strip = [...(config.stripReadmeSections || []), ...(PROJECTS[mod.repo]?.stripReadmeSections || []),
    // the generated Features and Documentation lists link the docs mirror instead
    ...(mod.docs ? ["Documentation"] : [])]
    // without an install box on the page, keep the README's own install steps
    .filter((x) => mod.manifest || !/^install/i.test(x))
    .map((s) => s.toLowerCase());
  const tokens = mdk.lexer(mod.readme);
  const kept = [];
  let skipping = false, sawH1 = false;
  for (const t of tokens) {
    if (t.type === "heading" && t.depth <= 2) {
      skipping = t.depth === 2 && strip.some((s) => t.text.toLowerCase().replace(/[^\w\s&]/g, "").trim().startsWith(s.toLowerCase()));
      if (t.depth === 1 && !sawH1) { sawH1 = true; continue; }
    }
    if (skipping) continue;
    // the "Dxcufgb's Workshop" promo badge links here, so leave it off the site
    if ((t.type === "paragraph" || t.type === "html") && /workshop-badge\.png/.test(t.raw)) continue;
    if (t.type === "paragraph" && t.raw.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)|!\[[^\]]*\]\([^)]*\)|\\|\s/g, "") === "") continue;
    kept.push(t);
  }
  kept.links = tokens.links;
  return mdk.tidy(mdk.parser(kept));
}

// ---------- prepare modules ----------
const slugOf = (mod) => mod.id.replace(config.slugPrefix || "", "") || mod.repo.toLowerCase();
const IMG_EXT = ["webp", "png", "jpg", "jpeg", "gif"];

// A video in site.config.json can be an id, any YouTube link, or { "id", "title" }.
const playlist = data.playlist || [];
function toVideo(v) {
  if (!v) return null;
  const s = typeof v === "string" ? v : v.id || v.url || "";
  const id = /(?:[?&]v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/.exec(s)?.[1] || (/^[\w-]{11}$/.test(s.trim()) ? s.trim() : null);
  if (!id) { console.warn(`[build] warning: "${s}" is not a YouTube video id or link`); return null; }
  const o = typeof v === "object" ? v : {};
  const p = playlist.find((x) => x.id === id) || {};
  return { id, title: o.title || p.title || "", uploadDate: o.uploadDate || o.published || p.published || null, duration: o.duration || null };
}

// WIP: "wip": true (or a sentence to show instead of the default note) in
// site.config.json, or the topic "wip" on the module's GitHub repo.
// "wip": false in the config hides the badge even if the topic is set.
function wipOf(m, over) {
  const topic = (m.topics || []).some((t) => /^(wip|work-in-progress)$/i.test(t));
  const v = over.wip ?? topic;
  return v ? { note: typeof v === "string" && v.trim() ? v.trim() : null } : null;
}

// Pixel size of a PNG (width/height attributes stop the layout jumping while it loads).
async function pngSize(file) {
  try {
    const b = await readFile(file);
    if (b.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch { return null; }
}

const modules = [];
const byRepo = new Map(); // "owner/repo" (lower case) → project, for wiki links across projects
for (const m of data.modules) {
  const over = PROJECTS[m.repo] || {};
  if (over.hidden) continue;
  const slug = slugOf(m);
  let image = over.image || null;
  for (const ext of IMG_EXT) {
    if (!image && (await exists(path.join(ROOT, "assets", "modules", `${slug}.${ext}`)))) image = `assets/modules/${slug}.${ext}`;
  }
  const set = over.videos || {};
  const videos = {
    // videos matched in the playlist by fetch-data.mjs get their upload date from it
    demo: toVideo(set.demo) || toVideo(m.videos?.demo) || null,
    tutorial: toVideo(set.tutorial) || toVideo(m.videos?.tutorial) || null,
    more: [].concat(set.more || []).map(toVideo).filter(Boolean),
  };
  const video = videos.demo || videos.tutorial || videos.more[0] || null;
  const customMd = path.join(ROOT, "content", `${slug}.md`);
  // Header line on the module page: the description's first sentence, without
  // parentheses. The full description is usually the README's opening anyway.
  const summary = over.summary || (over.description || m.description || "")
    .replace(/\s*\([^)]*\)/g, "")
    .split(/(?<=[.!?])\s+|:\s+/)[0]
    .replace(/[.:]$/, "") + ".";
  // Until the first release, the version in module.json is only planned and the
  // manifest link (releases/latest) does not resolve yet.
  const released = m.releases.length > 0;
  // A logo (transparent PNG/SVG/WebP) sits centred on the card's default background
  // instead of filling the card like a screenshot. "logo" in the config, or
  // assets/modules/<slug>-logo.(png|svg|webp) by name.
  let logo = over.logo || null;
  for (const ext of ["png", "svg", "webp"]) {
    if (!logo && (await exists(path.join(ROOT, "assets", "modules", `${slug}-logo.${ext}`)))) logo = `assets/modules/${slug}-logo.${ext}`;
  }
  const docs = over.wiki === false ? null : buildDocs(m.wikiPages);
  const pageUrl = abs(`${DIR}/${slug}/`);
  modules.push({
    ...m,
    owner: OWNER,
    logo,
    logoSize: logo && /\.png$/i.test(logo) && !/^https?:/.test(logo) ? await pngSize(path.join(ROOT, logo)) : null,
    docs,
    pageUrl,
    ogImage: abs(`og/${slug}.png`),
    seoTitle: over.seoTitle || null,
    seoDescription: over.seoDescription || null,
    operatingSystem: over.operatingSystem || null,
    // true/false or a URL in the config overrides the automatic check
    foundryPackage: over.foundryPackage === false ? null
      : typeof over.foundryPackage === "string" ? over.foundryPackage
      : over.foundryPackage === true ? `https://foundryvtt.com/packages/${m.id}` : m.foundryPackage || null,
    ...(released ? {} : { version: null }),
    installable: !!m.manifest && released,
    ...(over.description ? { description: over.description } : {}),
    // "wiki": false hides the docs and link, a URL points the link elsewhere; otherwise the
    // wiki's pages are mirrored on the site and the GitHub wiki is linked from the docs pages
    wikiUrl: over.wiki === false ? null : typeof over.wiki === "string" ? over.wiki : docs ? `${m.url}/wiki` : null,
    kind: over.kind || (m.isModule === false ? "Project" : "Foundry VTT module"),
    details: over.details || {},
    summary,
    videos,
    wip: wipOf(m, over),
    ...(over.title ? { shortTitle: over.title } : {}),
    slug,
    image,
    thumb: video ? `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg` : null,
    thumbFallback: video ? `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg` : null,
    customMd: (await exists(customMd)) ? await readFile(customMd, "utf8") : null,
    latestDate: m.releases[0]?.date || m.createdAt,
  });
  byRepo.set(`${OWNER}/${m.repo}`.toLowerCase(), modules.at(-1));
}
for (const mod of modules) {
  mod.hasVideos = !!(mod.videos.demo || mod.videos.tutorial || mod.videos.more.length);
  mod.metaTitle = seo.projectTitle(mod);
  mod.metaDescription = seo.projectDescription(mod, firstText(mod.readme || ""));
  usedDescriptions.add(mod.metaDescription);
}

// ---------- layout ----------
// "Opens another site in a new tab": an arrow out of a box, plus the same words for screen readers.
const EXTERNAL = `<svg class="ext-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.25 2.75 7.5 8.5M11.5 9.5v3.25a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75v-7.5a.75.75 0 0 1 .75-.75H6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sr-only"> (opens in a new tab)</span>`;
const SIGIL = `<svg class="sigil" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 58 18v28L32 61 6 46V18Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 13 49 23v18L32 51 15 41V23Z" fill="currentColor" opacity=".18"/><path d="M32 13v38M15 23l34 18M49 23 15 41" stroke="currentColor" stroke-width="2" opacity=".55"/></svg>`;

// ---------- fonts ----------
// The site's fonts are served from the site itself (no render-blocking request to
// Google Fonts). Files come from the @fontsource packages; without them (a bare
// checkout without npm install) the pages fall back to Google Fonts.
const FONT_FACES = [
  ["Alegreya", "alegreya", 400, "normal"], ["Alegreya", "alegreya", 500, "normal"], ["Alegreya", "alegreya", 700, "normal"],
  ["Alegreya", "alegreya", 400, "italic"],
  ["Alegreya SC", "alegreya-sc", 500, "normal"], ["Alegreya SC", "alegreya-sc", 700, "normal"], ["Alegreya SC", "alegreya-sc", 800, "normal"],
  ["Signika", "signika", 400, "normal"], ["Signika", "signika", 500, "normal"], ["Signika", "signika", 600, "normal"],
];
const fontFile = ([, pkg, w, st]) => `${pkg}-latin-${w}-${st}.woff2`;
const fontSrc = (f) => path.join(ROOT, "node_modules", "@fontsource", f[1], "files", fontFile(f));
const SELF_FONTS = (await Promise.all(FONT_FACES.map((f) => exists(fontSrc(f))))).every(Boolean);
// Above the fold: the headings (Alegreya SC 800) and the interface text (Signika 400).
const PRELOAD_FONTS = FONT_FACES.filter((f) => (f[1] === "alegreya-sc" && f[2] === 800) || (f[1] === "signika" && f[2] === 400));

function layout({ metaTitle, description, depth, active, body, image, imageAlt, pagePath, jsonld = [], ogType = "website", noindex = false, preload = [] }) {
  const base = depth ? "../".repeat(depth) : "./";
  const full = metaTitle || config.siteTitle;
  const desc = description || config.tagline;
  const url = pagePath == null ? null : abs(pagePath);
  const img = image || abs(OG_DEFAULT);
  const nav = (href, label, key) =>
    `<a href="${base}${href}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`;
  const verify = config.verification || {};
  const head = [
    url && `<link rel="canonical" href="${esc(url)}">`,
    noindex ? `<meta name="robots" content="noindex">` : `<meta name="robots" content="index, follow, max-image-preview:large">`,
    verify.google && `<meta name="google-site-verification" content="${esc(verify.google)}">`,
    verify.bing && `<meta name="msvalidate.01" content="${esc(verify.bing)}">`,
    `<meta property="og:type" content="${ogType}">`,
    `<meta property="og:site_name" content="${esc(config.siteTitle)}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:title" content="${esc(full)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    url && `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(imageAlt || full)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(full)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    `<meta name="twitter:image:alt" content="${esc(imageAlt || full)}">`,
  ].filter(Boolean).join("\n");
  const fonts = SELF_FONTS
    ? PRELOAD_FONTS.map((f) => `<link rel="preload" href="${base}assets/fonts/${fontFile(f)}" as="font" type="font/woff2" crossorigin>`).join("\n")
    : `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,500;0,700;1,400&family=Alegreya+SC:wght@500;700;800&family=Signika:wght@400;500;600&display=swap">`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc)}">
${head}
<meta name="theme-color" content="#1b1d24">
<link rel="icon" href="${base}assets/img/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${base}assets/img/favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${base}assets/img/favicon-192.png">
${fonts}
${preload.map((p) => `<link rel="preload" as="image" href="${esc(p)}" fetchpriority="high">`).join("\n")}
<link rel="stylesheet" href="${base}assets/css/site.css">
<script src="${base}assets/js/site.js" defer></script>
${seo.jsonLdScript(jsonld)}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <a class="brand" href="${base}">${SIGIL}<span>${esc(config.siteTitle)}</span></a>
  <nav aria-label="Main">
    ${nav("", "Releases", "home")}
    ${nav(`${DIR}/`, "Projects", "projects")}
    <a class="ext" href="https://www.youtube.com/playlist?list=${esc(config.youtubePlaylist)}" rel="noopener" target="_blank">Videos${EXTERNAL}</a>
    <a class="ext" href="https://github.com/${OWNER}" rel="noopener" target="_blank">GitHub${EXTERNAL}</a>
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="footer">
  <p>Made by <a href="https://github.com/${OWNER}">${esc(OWNER)}</a> for Foundry Virtual Tabletop. Not affiliated with Foundry Gaming LLC or Wizards of the Coast.</p>
  <p>Data refreshed ${fmtDate(data.generatedAt)}. <a href="${esc(config.kofi)}" rel="noopener" target="_blank">Ko-fi</a></p>
</footer>
</body>
</html>
`;
}

const ANVIL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 6h14c0 2.6-2 4.3-5 4.7V13h2l1 2v3H5v-3l1-2h2v-2.3C4.6 10.3 2 8.6 2 6Zm15 0h5c-.8 1.9-2.6 3-5 3Z" fill="currentColor"/></svg>`;
const WIP_TEXT = "Work in progress: may be very buggy and can change a lot between versions.";
const wipBadge = (mod) =>
  mod.wip ? `<span class="wip" title="${esc(mod.wip.note || WIP_TEXT)}">${ANVIL}WIP</span>` : "";

// eager: the first cards are above the fold, the rest load as they scroll in
function cardImage(mod, base, eager = false) {
  const load = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  const src = (p) => esc(p.startsWith("http") ? p : base + p);
  if (mod.logo) {
    const dim = mod.logoSize ? ` width="${mod.logoSize.width}" height="${mod.logoSize.height}"` : "";
    return `<div class="card-logo"><img src="${src(mod.logo)}" alt="${esc(mod.shortTitle)} logo"${dim} ${load} decoding="async"></div>`;
  }
  if (mod.image) return `<img src="${src(mod.image)}" alt="${esc(mod.shortTitle)} in Foundry VTT" width="640" height="360" ${load} decoding="async">`;
  if (mod.thumb) return `<img src="${esc(mod.thumb)}" data-fallback="${esc(mod.thumbFallback)}" alt="${esc(mod.shortTitle)} in Foundry VTT, from its demo video" width="1280" height="720" ${load} decoding="async">`;
  return `<div class="card-sigil">${SIGIL}<span>${esc(mod.shortTitle.split(" ").map((w) => w[0]).join(""))}</span></div>`;
}

// Projects that belong together: same required module or game system, one names the
// other in its README or wiki, or the same kind of project.
function related(mod, n = 3) {
  const text = (m) => `${m.readme || ""} ${(m.docs?.pages || []).map((p) => p.md).join(" ")}`.toLowerCase();
  const mine = text(mod);
  const score = (o) => {
    let s = 0;
    const share = (a, b) => a.some((x) => b.includes(x));
    if (share((mod.requires || []).map((r) => r.id), (o.requires || []).map((r) => r.id))) s += 3;
    if (share((mod.systems || []).map((x) => x.id), (o.systems || []).map((x) => x.id))) s += 2;
    if (mine.includes(o.shortTitle.toLowerCase()) || mine.includes(o.id) || text(o).includes(mod.shortTitle.toLowerCase())) s += 4;
    if ((mod.isModule === false) === (o.isModule === false)) s += 1;
    return s;
  };
  return modules.filter((o) => o !== mod).map((o) => [score(o), o])
    .sort((a, b) => b[0] - a[0] || String(b[1].latestDate || "").localeCompare(String(a[1].latestDate || ""))).slice(0, n).map(([, o]) => o);
}

const releaseNotes = (mdk, r) =>
  r.notes ? mdk.render(r.notes) : `<p class="muted">No notes for this release. <a href="${esc(r.url)}">See it on GitHub</a>.</p>`;

// ---------- home ----------
const homeDescription = () => {
  const mods = modules.filter((m) => m.isModule !== false && !m.wip).sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).map((m) => m.shortTitle);
  const lead = `Free Foundry VTT v13 modules by ${OWNER}: `;
  const tail = " and more, with demo videos, docs and install links.";
  return lead + seo.listNames(mods, seo.DESC_MAX - lead.length - tail.length).replace(/ and ([^,]+)$/, ", $1") + tail;
};
const isModule = (m) => m.isModule !== false;

function projectIndex(base) {
  const group = (label, list) => list.length ? `<div class="index-group">
    <h3>${label}</h3>
    <ul>${list.map((m) => `<li><a href="${base}${DIR}/${esc(m.slug)}/">${esc(m.shortTitle)}</a>${m.wip ? ` <span class="muted">(work in progress)</span>` : ""}<span class="index-summary">${esc(m.summary)}</span></li>`).join("")}</ul>
  </div>` : "";
  const sorted = [...modules].sort((a, b) => a.shortTitle.localeCompare(b.shortTitle));
  return `<section class="all-projects" aria-labelledby="all-h">
  <h2 id="all-h" class="section-title">All projects</h2>
  <div class="project-index parchment">
    ${group("Foundry VTT modules", sorted.filter(isModule))}
    ${group("Bots and server tools", sorted.filter((m) => !isModule(m)))}
  </div>
</section>`;
}

function home() {
  const n = config.latestReleaseCount || 10;
  const all = modules.flatMap((m) => m.releases.filter((r) => !r.prerelease).map((r) => ({ ...r, mod: m })))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
  const totalDl = modules.some((m) => m.downloads != null) ? modules.reduce((s, m) => s + (m.downloads || 0), 0) : null;
  const newest = all[0];
  const description = homeDescription();

  const entries = all.map((r) => {
    const mdk = markdownFor(r.mod, { base: "./", minDepth: 4 });
    return `<li class="chron-entry">
  <time datetime="${esc(r.date)}">${fmtDate(r.date)}</time>
  <article class="chron-card parchment">
    <header>
      <h3><a href="${DIR}/${esc(r.mod.slug)}/">${esc(r.mod.shortTitle)}</a>${wipBadge(r.mod)}</h3>
      <a class="tag" href="${esc(r.url)}" rel="noopener" target="_blank" title="Release on GitHub">${esc(r.version.match(/^\d/) ? "v" + r.version : r.version)}<span class="sr-only"> of ${esc(r.mod.shortTitle)} on GitHub</span></a>
    </header>
    <div class="notes prose" data-clamp>${releaseNotes(mdk, r)}</div>
  </article>
</li>`;
  }).join("\n");

  return layout({
    depth: 0,
    active: "home",
    metaTitle: `${config.siteTitle} – Foundry VTT v13 modules`,
    description,
    pagePath: "",
    imageAlt: `${config.siteTitle}: Foundry VTT modules by ${OWNER}`,
    jsonld: [seo.websiteLd(SITE, config, description), seo.personLd(SITE, config)],
    body: `
<section class="hero">
  <div class="hero-inner">
    <h1>${esc(config.siteTitle)}</h1>
    <p class="lede">${esc(config.tagline)}</p>
    <dl class="hero-stats">
      <div><dt>Projects</dt><dd>${modules.length}</dd></div>
      <div><dt>Downloads</dt><dd>${fmtNum(totalDl)}</dd></div>
      ${newest ? `<div><dt>Last release</dt><dd><a href="${DIR}/${esc(newest.mod.slug)}/">${esc(newest.mod.shortTitle)} ${esc(newest.version)}</a></dd></div>` : ""}
    </dl>
    <p class="hero-cta"><a class="btn" href="${DIR}/">Browse all projects</a></p>
  </div>
</section>
<section class="chronicle" aria-labelledby="chron-h">
  <h2 id="chron-h" class="section-title">Latest releases</h2>
  <ol class="chron-list">
${entries}
  </ol>
</section>
${projectIndex("./")}`,
  });
}

// ---------- module grid ----------
function moduleCard(mod, base, eager) {
  return `<li class="card parchment" data-title="${esc(mod.shortTitle.toLowerCase())}" data-search="${esc((mod.shortTitle + " " + mod.description + " " + mod.topics.join(" ") + " " + mod.kind + (mod.wip ? " wip work in progress" : "")).toLowerCase())}" data-date="${esc(mod.latestDate)}" data-downloads="${mod.downloads}">
  <a class="card-link" href="${esc(mod.slug)}/" tabindex="-1" aria-hidden="true">
    <div class="card-media">${cardImage(mod, base, eager)}${wipBadge(mod)}</div>
  </a>
  <div class="card-body">
    <h2 class="card-title"><a href="${esc(mod.slug)}/">${esc(mod.shortTitle)}</a></h2>
    <hr class="taper">
    <p class="card-summary">${esc(mod.description)}</p>
    <hr class="taper">
    <dl class="props">
      <div><dt>Version</dt><dd>${mod.version ? esc(mod.version) : "Not released yet"}</dd></div>
      ${mod.manifest ? `<div><dt>Foundry</dt><dd>${esc(foundryRange(mod.compatibility))}</dd></div>` : `<div><dt>Type</dt><dd>${esc(mod.kind)}</dd></div>`}
      <div><dt>Downloads</dt><dd>${fmtNum(mod.downloads)}</dd></div>
    </dl>
  </div>
</li>`;
}

function modulesPage() {
  const names = modules.filter(isModule).sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).map((m) => m.shortTitle);
  const lead = `All ${modules.length} projects by ${OWNER} for Foundry VTT v13: modules like `;
  const tail = ", plus a Discord bot and server tools.";
  const description = lead + seo.listNames(names, seo.DESC_MAX - lead.length - tail.length) + tail;
  const url = abs(`${DIR}/`);
  return layout({
    depth: 1,
    active: "projects",
    metaTitle: `Foundry VTT modules and tools by ${OWNER}`,
    description,
    pagePath: `${DIR}/`,
    jsonld: [
      seo.itemListLd(SITE, modules, url),
      seo.breadcrumbLd([["Home", SITE], ["Projects", url]]),
    ],
    body: `
<section class="page-head">
  <h1>Projects</h1>
  <p class="lede">Foundry VTT modules, and the bot and servers that run next to Foundry. Newest release first.</p>
  <div class="toolbar" hidden>
    <label class="field"><span>Find</span><input type="search" id="filter" placeholder="Tokens, dice, backup…" autocomplete="off"></label>
    <label class="field"><span>Sort by</span>
      <select id="sort"><option value="date">Latest release</option><option value="downloads">Downloads</option><option value="title">Name</option></select>
    </label>
  </div>
</section>
<ul class="grid" id="grid">
${modules.map((m, i) => moduleCard(m, "../", i < 3)).join("\n")}
</ul>
<p class="empty" id="empty" hidden>No project matches that search. Clear the field to see them all.</p>`,
  });
}

// ---------- module page ----------
// Demo and Tutorial tabs always show; More only when videos are set for it.
const PLAY_ICON = `<svg viewBox="0 0 68 48" aria-hidden="true"><path d="M66.5 7.7A8.5 8.5 0 0 0 60.5 1.7C55.2.3 34 .3 34 .3s-21.2 0-26.5 1.4a8.5 8.5 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6c5.3 1.4 26.5 1.4 26.5 1.4s21.2 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3Z"/><path d="M45 24 27 14v20Z" fill="#fff"/></svg>`;

function playerHtml(mod, v, label, first) {
  const load = first ? 'fetchpriority="high"' : 'loading="lazy"';
  return `<div class="player" data-video="${esc(v.id)}">
  <img src="https://i.ytimg.com/vi/${esc(v.id)}/maxresdefault.jpg" data-fallback="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="${esc(mod.shortTitle)} ${label.toLowerCase()} video: ${esc(v.title || "thumbnail")}" width="1280" height="720" ${load} decoding="async">
  <button class="play" type="button" aria-label="Play ${esc(v.title || `the ${label.toLowerCase()} video`)}">${PLAY_ICON}</button>
  <noscript><a href="https://www.youtube.com/watch?v=${esc(v.id)}">Watch the ${esc(mod.shortTitle)} ${label.toLowerCase()} on YouTube</a></noscript>
</div>`;
}

function videoTabs(mod) {
  const { demo, tutorial, more } = mod.videos;
  const tabs = [
    { key: "demo", label: "Demo", has: !!demo },
    { key: "tutorial", label: "Tutorial", has: !!tutorial },
    ...(more.length ? [{ key: "more", label: "More", has: true, count: more.length }] : []),
  ];
  return { tabs, start: (tabs.find((t) => t.has) || tabs[0]).key };
}

function videoBlock(mod) {
  const { demo, tutorial, more } = mod.videos;
  const { tabs, start } = videoTabs(mod);
  const playlistUrl = `https://www.youtube.com/playlist?list=${esc(config.youtubePlaylist)}`;
  const empty = (what) => `<div class="video-empty">
  ${SIGIL}
  <p>The ${what} video for ${esc(mod.shortTitle)} is not out yet.</p>
  <p><a href="${playlistUrl}" rel="noopener" target="_blank">See all module videos on YouTube</a></p>
</div>`;

  const panel = (t, inner) =>
    `<div class="video-panel" role="tabpanel" id="video-${t.key}" aria-labelledby="tab-${t.key}"${t.key === start ? "" : " hidden"}>${inner}</div>`;

  const panels = tabs.map((t) => {
    const first = t.key === start;
    if (t.key === "demo") return panel(t, demo ? playerHtml(mod, demo, "Demo", first) : empty("demo"));
    if (t.key === "tutorial") return panel(t, tutorial ? playerHtml(mod, tutorial, "Tutorial", first) : empty("tutorial"));
    const reel = more.length > 1
      ? `<ul class="reel" aria-label="More videos">${more.map((v, i) => `<li><button type="button" class="reel-item" data-video="${esc(v.id)}" aria-pressed="${i === 0}">
  <img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" width="320" height="180" loading="lazy" decoding="async">
  <span>${esc(v.title || `Video ${i + 1}`)}</span>
</button></li>`).join("")}</ul>`
      : "";
    return panel(t, playerHtml(mod, more[0], "Video", first) + reel);
  }).join("\n");

  return `<section class="videos${tabs.some((t) => t.has) ? "" : " no-videos"}" aria-label="Videos">
  <div class="video-tabs" role="tablist" aria-label="Videos">${tabs.map((t) =>
    `<button type="button" role="tab" id="tab-${t.key}" aria-controls="video-${t.key}" aria-selected="${t.key === start}"${t.has ? "" : ' class="is-empty"'}>${t.label}${t.count > 1 ? ` <span class="count">${t.count}</span>` : ""}</button>`).join("")}</div>
  <div class="video-stage">
${panels}
  </div>
</section>`;
}

function statBlock(mod, base) {
  const line = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : "");
  const rel = (list) => list.map((r) => `<span title="${esc(r.reason)}">${esc(seo.moduleLabel(r.id))}</span>`).join(", ");
  const sys = mod.systems.map((s) => `${esc(seo.systemLabel(s.id))}${s.minimum ? ` ${esc(s.minimum)}+` : ""}`).join(", ");
  const c = mod.compatibility || {};
  const ext = (href, text) => `<li><a href="${esc(href)}" rel="noopener" target="_blank">${text}</a></li>`;
  return `<aside class="statblock parchment" aria-label="${esc(mod.shortTitle)} details">
  <h2>${esc(mod.shortTitle)}</h2>
  <p class="statblock-sub">${esc(mod.kind)}${mod.manifest ? `, ${esc(sys || "system agnostic")}` : ""}</p>
  <hr class="taper">
  <dl class="props">
    ${line("Status", mod.wip ? "Work in progress" : "")}
    ${line("Version", mod.version ? esc(mod.version) : "Not released yet")}
    ${line("Foundry", mod.manifest ? `${esc(foundryRange(c))}${c.verified ? ` <span class="muted">(verified ${esc(c.verified)})</span>` : ""}` : "")}
    ${line("Systems", mod.manifest ? esc(sys || "Any game system") : "")}
    ${line("Downloads", mod.downloads == null ? "" : fmtNum(mod.downloads))}
    ${line("Released", mod.releases[0] ? fmtDate(mod.releases[0].date) : "")}
    ${Object.entries(mod.details).map(([k, v]) => line(esc(k), esc(v))).join("\n    ")}
  </dl>
  ${mod.requires.length || mod.recommends.length || mod.license ? `<hr class="taper"><dl class="props">
    ${line("Requires", rel(mod.requires))}
    ${line("Works with", rel(mod.recommends))}
    ${line("License", esc(mod.license || ""))}
  </dl>` : ""}
  ${mod.installable ? `<h3>Install</h3>
  <p class="install-help">In Foundry, open <b>Add-on Modules</b>, choose <b>Install Module</b> and paste this into <b>Manifest URL</b>.</p>
  <div class="manifest"><input readonly value="${esc(mod.manifest)}" aria-label="${esc(mod.shortTitle)} manifest URL" id="manifest-${esc(mod.slug)}"><button type="button" class="copy" data-copy="#manifest-${esc(mod.slug)}">Copy</button></div>` : ""}
  <h3>Links</h3>
  ${mod.notPublic ? `<p class="install-help">The source is not public yet. Follow the <a href="https://github.com/${OWNER}" rel="noopener" target="_blank">${esc(OWNER)} GitHub profile</a> to see it when it is.</p>` : `<ul class="links">
    ${mod.docs ? `<li><a href="${base}${DIR}/${esc(mod.slug)}/docs/">${esc(mod.shortTitle)} documentation</a></li>` : mod.wikiUrl ? ext(mod.wikiUrl, `${esc(mod.shortTitle)} guides on the wiki`) : ""}
    ${mod.foundryPackage ? ext(mod.foundryPackage, `${esc(mod.shortTitle)} on foundryvtt.com`) : ""}
    ${ext(mod.url, "Source code on GitHub")}
    ${ext(`${mod.url}/issues`, "Report a bug or ask for a feature")}
    ${ext(`${mod.url}/releases`, "All releases and downloads")}
  </ul>`}
  <p class="kofi"><a href="${esc(config.kofi)}" rel="noopener" target="_blank"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Zm13 1h1.5a2.5 2.5 0 0 1 0 5H17" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 14.2 8.3 12a1.3 1.3 0 0 1 2.2-1.5 1.3 1.3 0 0 1 2.2 1.5Z" fill="currentColor"/></svg>Enjoying it? Buy me a coffee on Ko-fi</a></p>
</aside>`;
}

// "Dice Trails is a free, open-source Foundry VTT v13 module for Dice So Nice."
function introSentence(mod) {
  const { kind, qualifier } = seo.audience(mod);
  const free = mod.notPublic ? "" : "free, open-source ";
  const a = /^[aeiou]/i.test(free || kind) ? "an" : "a";
  return `<p class="intro"><strong>${esc(mod.shortTitle)}</strong> is ${a} ${free}${esc(kind)}${qualifier ? ` ${esc(qualifier)}` : ""}${mod.wip ? ", still a work in progress" : ""}.</p>`;
}

function featuresHtml(mod, base) {
  if (!mod.docs) return "";
  const href = (p) => `${base}${DIR}/${mod.slug}/docs/${p.slug ? `${p.slug}/` : ""}`;
  const features = mod.docs.pages.filter((p) => p.feature);
  const others = mod.docs.pages.filter((p) => !p.feature && p.slug);
  return `${features.length ? `<h2 id="features">Features</h2>
<ul class="features">${features.map((p) => `<li><a href="${href(p)}"><strong>${esc(p.title)}</strong></a>${p.text ? `: ${esc(firstSentence(p.text))}` : ""}</li>`).join("")}</ul>` : ""}
<h2 id="documentation">Documentation</h2>
<p>The full ${esc(mod.shortTitle)} guide: <a href="${href(mod.docs.home || { slug: "" })}">overview</a>${others.map((p) => `, <a href="${href(p)}">${esc(p.title.toLowerCase() === "api" ? "API for module authors" : p.title)}</a>`).join("")}.</p>`;
}

function modulePage(mod) {
  const base = "../../";
  const mdk = markdownFor(mod, { base });
  const readme = mod.customMd ? mdk.render(mod.customMd)
    : mod.readme ? readmeHtml(mod, mdk)
    : `<p>${esc(mod.description)}</p>`;
  const notes = markdownFor(mod, { base, minDepth: 3 });
  const history = mod.releases.filter((r) => !r.prerelease).slice(0, 5).map((r) => `<li>
  <details${r === mod.releases[0] ? " open" : ""}>
    <summary><span class="ver">${esc(r.version)}</span> <time datetime="${esc(r.date)}">${fmtDate(r.date)}</time></summary>
    <div class="prose">${releaseNotes(notes, r)}</div>
  </details>
</li>`).join("\n");
  const rel = related(mod);
  const { start } = videoTabs(mod);
  const firstVideo = start === "more" ? mod.videos.more[0] : mod.videos[start];

  return layout({
    depth: 2,
    active: "projects",
    metaTitle: mod.metaTitle,
    description: mod.metaDescription,
    pagePath: `${DIR}/${mod.slug}/`,
    image: mod.ogImage,
    imageAlt: `${mod.shortTitle}: ${mod.summary}`,
    preload: firstVideo ? [`https://i.ytimg.com/vi/${firstVideo.id}/maxresdefault.jpg`] : [],
    jsonld: [
      seo.softwareLd(SITE, mod, mod.metaDescription),
      ...["demo", "tutorial"].map((k) => mod.videos[k] && seo.videoLd(mod, mod.videos[k], k === "demo" ? "Demo" : "Tutorial")),
      ...mod.videos.more.map((v) => seo.videoLd(mod, v, "Video")),
      seo.breadcrumbLd([["Home", SITE], ["Projects", abs(`${DIR}/`)], [mod.shortTitle, mod.pageUrl]]),
      seo.personLd(SITE, config),
    ],
    body: `
<nav class="crumbs" aria-label="Breadcrumb"><a href="${base}">Home</a> <span aria-hidden="true">/</span> <a href="../">Projects</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(mod.shortTitle)}</span></nav>
<section class="module-head">
  <h1>${esc(mod.shortTitle)}</h1>
  <p class="lede">${esc(mod.summary)}</p>
  ${mod.wip ? `<p class="wip-note">${wipBadge(mod)}<span>${esc(mod.wip.note || WIP_TEXT)}${mod.notPublic ? "" : ` <a href="${esc(mod.url)}/issues" rel="noopener" target="_blank">Report bugs on GitHub</a>.`}</span></p>` : ""}
</section>
${videoBlock(mod)}
<div class="module-layout">
  <article class="parchment prose readme">${introSentence(mod)}${readme}${featuresHtml(mod, base)}</article>
  ${statBlock(mod, base)}
</div>
${history ? `<section class="history" aria-labelledby="hist-h">
  <h2 id="hist-h" class="section-title">Changelog</h2>
  <ol class="history-list parchment">${history}</ol>
  ${mod.releases.length > 5 ? `<p class="more"><a href="${esc(mod.url)}/releases" rel="noopener" target="_blank">Older ${esc(mod.shortTitle)} releases on GitHub</a></p>` : ""}
</section>` : ""}
${rel.length ? `<section class="related" aria-labelledby="rel-h">
  <h2 id="rel-h" class="section-title">Related projects</h2>
  <ul class="related-list">${rel.map((o) => `<li class="parchment"><a href="../${esc(o.slug)}/">${esc(o.shortTitle)}</a>${o.wip ? ` <span class="muted">(work in progress)</span>` : ""}<p>${esc(o.summary)}</p></li>`).join("")}</ul>
</section>` : ""}`,
  });
}

// ---------- docs mirror ----------
function docsPage(mod, page) {
  const isIndex = page.slug === "";
  const depth = isIndex ? 3 : 4;
  const base = "../".repeat(depth);
  const path = `${DIR}/${mod.slug}/docs/${isIndex ? "" : `${page.slug}/`}`;
  const url = abs(path);
  const mdk = markdownFor(mod, { base, wiki: true, minDepth: 2 });
  // The page's own "# Title" becomes the page heading; any other h1 is shown as h2.
  const body = mdk.render(page.md.replace(/^\s*#\s+.+\n/, ""));
  const h1 = isIndex ? `${mod.shortTitle} documentation` : page.title;
  const description = seo.docsDescription(mod, page.title, page.lead || page.text, isIndex, page.name, usedDescriptions);
  usedDescriptions.add(description);
  const metaTitle = seo.docsTitle(mod, page.title, isIndex);
  const href = (p) => `${base}${DIR}/${mod.slug}/docs/${p.slug ? `${p.slug}/` : ""}`;
  const navLink = (p) => `<li><a href="${href(p)}"${p === page ? ' aria-current="page"' : ""}>${esc(p.title)}</a></li>`;
  const wikiPage = `${mod.url}/wiki/${isIndex ? "" : encodeURIComponent(page.name)}`;
  return {
    path,
    url,
    title: metaTitle,
    description,
    html: layout({
      depth,
      active: "projects",
      metaTitle,
      description,
      pagePath: path,
      image: mod.ogImage,
      imageAlt: `${mod.shortTitle}: ${mod.summary}`,
      ogType: "article",
      jsonld: [
        seo.docsLd(SITE, mod, { ...page, title: h1 }, url, description),
        seo.breadcrumbLd([["Home", SITE], ["Projects", abs(`${DIR}/`)], [mod.shortTitle, mod.pageUrl],
          ...(isIndex ? [["Documentation", url]] : [["Documentation", abs(`${DIR}/${mod.slug}/docs/`)], [page.title, url]])]),
      ],
      body: `
<nav class="crumbs" aria-label="Breadcrumb"><a href="${base}">Home</a> <span aria-hidden="true">/</span> <a href="${base}${DIR}/">Projects</a> <span aria-hidden="true">/</span> <a href="${base}${DIR}/${esc(mod.slug)}/">${esc(mod.shortTitle)}</a> <span aria-hidden="true">/</span> ${isIndex ? `<span aria-current="page">Documentation</span>` : `<a href="${href({ slug: "" })}">Documentation</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(page.title)}</span>`}</nav>
<section class="module-head">
  <h1>${esc(h1)}</h1>
  ${mod.wip ? `<p class="wip-note">${wipBadge(mod)}<span>${esc(mod.wip.note || WIP_TEXT)}</span></p>` : ""}
</section>
<div class="module-layout">
  <article class="parchment prose readme">${body}
  <p class="source-note">This page mirrors the <a href="${esc(wikiPage)}" rel="noopener" target="_blank">${esc(mod.shortTitle)} wiki on GitHub</a>.</p></article>
  <nav class="statblock parchment docs-nav" aria-label="${esc(mod.shortTitle)} documentation">
    <h2><a href="${base}${DIR}/${esc(mod.slug)}/">${esc(mod.shortTitle)}</a></h2>
    <p class="statblock-sub">Documentation</p>
    <hr class="taper">
    <ul class="links">${mod.docs.home ? navLink(mod.docs.home) : ""}</ul>
    ${mod.docs.groups.map((g) => `${g.label ? `<h3>${esc(g.label)}</h3>` : ""}<ul class="links">${g.pages.map(navLink).join("")}</ul>`).join("\n    ")}
    ${mod.installable ? `<h3>Install</h3><div class="manifest"><input readonly value="${esc(mod.manifest)}" aria-label="${esc(mod.shortTitle)} manifest URL" id="manifest-${esc(mod.slug)}"><button type="button" class="copy" data-copy="#manifest-${esc(mod.slug)}">Copy</button></div>` : ""}
    <p class="kofi"><a href="${esc(config.kofi)}" rel="noopener" target="_blank">Enjoying it? Buy me a coffee on Ko-fi</a></p>
  </nav>
</div>`,
    }),
  };
}

// ---------- write ----------
// LINK_INDEX=1 spells out index.html in links, for hosts that don't serve
// folder URLs (opening the files straight from disk, some preview hosts).
const finish = (html) => process.env.LINK_INDEX
  ? html.replace(/href="((?!https?:|mailto:|#)[^"]*\/)"/g, 'href="$1index.html"').replace(/href="\.\/"/g, 'href="./index.html"')
  : html;
const _writeFile = writeFile;
const writePage = (file, html) => _writeFile(file, file.endsWith(".html") ? finish(html) : html);

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, DIR), { recursive: true });
await cp(path.join(ROOT, "assets"), path.join(OUT, "assets"), { recursive: true });
if (SELF_FONTS) {
  await mkdir(path.join(OUT, "assets", "fonts"), { recursive: true });
  for (const f of FONT_FACES) await cp(fontSrc(f), path.join(OUT, "assets", "fonts", fontFile(f)));
  const faces = FONT_FACES.map((f) => `@font-face{font-family:"${f[0]}";font-style:${f[3]};font-weight:${f[2]};font-display:swap;src:url("../fonts/${fontFile(f)}") format("woff2")}`).join("\n");
  const css = await readFile(path.join(ROOT, "assets", "css", "site.css"), "utf8");
  await _writeFile(path.join(OUT, "assets", "css", "site.css"), `${faces}\n${css}`);
}
await _writeFile(path.join(OUT, ".nojekyll"), "");

const pages = []; // for the sitemap and the metadata check
const newest = (list) => list.map((m) => m.latestDate).filter(Boolean).sort().at(-1);
const add = (path, html, lastmod, meta) => { pages.push({ path, url: abs(path), lastmod, ...meta }); return html; };

await writePage(path.join(OUT, "index.html"), add("", home(), newest(modules), { title: `${config.siteTitle} – Foundry VTT v13 modules`, description: homeDescription() }));
await writePage(path.join(OUT, DIR, "index.html"), add(`${DIR}/`, modulesPage(), newest(modules), {}));
const og = [];
for (const mod of modules) {
  await mkdir(path.join(OUT, DIR, mod.slug), { recursive: true });
  const lastmod = mod.releases[0]?.date || mod.pushedAt || mod.createdAt;
  await writePage(path.join(OUT, DIR, mod.slug, "index.html"), add(`${DIR}/${mod.slug}/`, modulePage(mod), lastmod, { title: mod.metaTitle, description: mod.metaDescription }));
  for (const page of mod.docs?.pages || []) {
    const d = docsPage(mod, page);
    await mkdir(path.join(OUT, d.path), { recursive: true });
    await writePage(path.join(OUT, d.path, "index.html"), add(d.path, d.html, page.updated || lastmod, { title: d.title, description: d.description }));
  }
  const v = mod.videos.demo || mod.videos.tutorial || mod.videos.more[0];
  const kindLine = [isModule(mod) ? `Foundry VTT v${seo.audience(mod).version} module` : mod.kind, mod.version && `v${mod.version}`].filter(Boolean).join(" · ");
  og.push({ file: `og/${mod.slug}.png`, name: mod.shortTitle, kind: kindLine, summary: mod.summary, wip: !!mod.wip, video: v?.id || null, screenshot: mod.image && !/^https?:/.test(mod.image) ? mod.image : null, logo: mod.logo && !/^https?:/.test(mod.logo) ? mod.logo : null });
}
await writePage(path.join(OUT, "404.html"), layout({
  depth: 0, metaTitle: `Page not found – ${config.siteTitle}`, noindex: true,
  body: `<section class="page-head"><h1>This page is not on the map</h1><p class="lede">The link may be old or mistyped. <a href="./">Go to the latest releases</a> or <a href="./${DIR}/">see all projects</a>.</p></section>
${projectIndex("./")}`,
// 404.html is served at any depth, so it needs absolute links. In Actions,
// BASE_PATH comes from actions/configure-pages ("/" or "/<repo>/").
}).replace(/(href|src)="\.\//g, `$1="${(process.env.BASE_PATH || config.basePath || "/").replace(/\/?$/, "/")}`));

await _writeFile(path.join(OUT, "sitemap.xml"), seo.sitemapXml(pages));
// Only the domain root's robots.txt counts for search engines; this copy documents the
// sitemap for anyone looking, the one that matters lives in the <owner>.github.io repo.
await _writeFile(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${abs("sitemap.xml")}\n`);
await _writeFile(path.join(OUT, "og-manifest.json"), JSON.stringify({ site: config.siteTitle, items: og }, null, 2));

// Every page needs its own title and description, within the lengths search results show.
const problems = [];
const seen = (key) => { const m = new Map(); for (const p of pages) if (p[key]) m.set(p[key], [...(m.get(p[key]) || []), p.path]); return [...m].filter(([, v]) => v.length > 1); };
for (const p of pages) {
  if (p.title && p.title.length > seo.TITLE_MAX) problems.push(`title over ${seo.TITLE_MAX} characters (${p.title.length}): ${p.path}`);
  if (p.description && (p.description.length < seo.DESC_MIN - 20 || p.description.length > seo.DESC_MAX)) problems.push(`description ${p.description.length} characters: ${p.path}`);
}
for (const [t, where] of seen("title")) problems.push(`same title on ${where.join(", ")}: ${t}`);
for (const [d, where] of seen("description")) problems.push(`same description on ${where.join(", ")}`);
for (const p of problems) console.warn(`[build] seo: ${p}`);
console.log(`[build] ${modules.length} project pages, ${pages.length} pages in sitemap.xml, ${og.length} social images to draw`);
