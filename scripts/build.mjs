#!/usr/bin/env node
// Renders the static site into _site/ from data/site-data.json + site.config.json.
//
// Per-module extras, all optional:
//   assets/modules/<slug>.(webp|png|jpg|jpeg|gif)  card + header image
//   content/<slug>.md                              replaces the README on the module page
//   site.config.json → projects["<repo>"]           include, kind, title, summary, description, image, videos,
//                                                   wip, details, stripReadmeSections, hidden

import { readFile, writeFile, mkdir, cp, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Marked } from "marked";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "_site");
const config = JSON.parse(await readFile(path.join(ROOT, "site.config.json"), "utf8"));
const data = JSON.parse(await readFile(path.join(ROOT, "data", "site-data.json"), "utf8"));
const OWNER = data.owner;
// Per-repo settings live under "projects" (older configs used "modules").
const PROJECTS = { ...(config.modules || {}), ...(config.projects || {}) };
const DIR = "projects"; // URL folder for the project list and pages

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
function markdownFor(mod) {
  const md = new Marked({ gfm: true });
  const blob = `https://github.com/${OWNER}/${mod.repo}/blob/${mod.branch}/`;
  const rawBase = `https://raw.githubusercontent.com/${OWNER}/${mod.repo}/${mod.branch}/`;
  const relative = (u) => u && !/^([a-z]+:|#|\/\/)/i.test(u);
  md.use({
    walkTokens(t) {
      if (t.type === "link" && relative(t.href)) t.href = blob + t.href.replace(/^\.?\//, "");
      if (t.type === "image" && relative(t.href)) t.href = rawBase + t.href.replace(/^\.?\//, "");
    },
    renderer: {
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const ext = /^https?:/.test(href) ? ' rel="noopener" target="_blank"' : "";
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}${ext}>${text}</a>`;
      },
    },
  });
  const tidy = (html) => html
    .replace(/(<img[^>]+src=")(?!https?:|data:|\/\/)\.?\/?([^"]+)"/g, `$1${rawBase}$2"`)
    .replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>")
    .replace(/<img /g, '<img loading="lazy" ');
  return {
    render: (src) => tidy(md.parse(src || "")),
    tidy,
    lexer: (src) => md.lexer(src || ""),
    parser: (tokens) => md.parser(tokens),
  };
}

// README → page body: drop the H1, the badge row and sections that the page already covers.
function readmeHtml(mod, mdk) {
  const strip = [...(config.stripReadmeSections || []), ...(PROJECTS[mod.repo]?.stripReadmeSections || [])]
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
  return { id, title: (typeof v === "object" && v.title) || playlist.find((p) => p.id === id)?.title || "" };
}

// WIP: "wip": true (or a sentence to show instead of the default note) in
// site.config.json, or the topic "wip" on the module's GitHub repo.
// "wip": false in the config hides the badge even if the topic is set.
function wipOf(m, over) {
  const topic = (m.topics || []).some((t) => /^(wip|work-in-progress)$/i.test(t));
  const v = over.wip ?? topic;
  return v ? { note: typeof v === "string" && v.trim() ? v.trim() : null } : null;
}

const modules = [];
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
    demo: toVideo(set.demo) || m.videos?.demo || null,
    tutorial: toVideo(set.tutorial) || m.videos?.tutorial || null,
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
  modules.push({
    ...m,
    ...(over.description ? { description: over.description } : {}),
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
}

// ---------- layout ----------
const SIGIL = `<svg class="sigil" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 58 18v28L32 61 6 46V18Z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 13 49 23v18L32 51 15 41V23Z" fill="currentColor" opacity=".18"/><path d="M32 13v38M15 23l34 18M49 23 15 41" stroke="currentColor" stroke-width="2" opacity=".55"/></svg>`;

function layout({ title, description, depth, active, body, image }) {
  const base = depth ? "../".repeat(depth) : "./";
  const full = title ? `${title} — ${config.siteTitle}` : config.siteTitle;
  const nav = (href, label, key) =>
    `<a href="${base}${href}"${active === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description || config.tagline)}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description || config.tagline)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ""}
<meta name="theme-color" content="#1b1d24">
<link rel="icon" href="${base}assets/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,500;0,700;1,400&family=Alegreya+SC:wght@500;700;800&family=Signika:wght@400;500;600&display=swap">
<link rel="stylesheet" href="${base}assets/css/site.css">
<script src="${base}assets/js/site.js" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
  <a class="brand" href="${base}">${SIGIL}<span>${esc(config.siteTitle)}</span></a>
  <nav aria-label="Main">
    ${nav("", "Releases", "home")}
    ${nav(`${DIR}/`, "Projects", "projects")}
    <a href="https://www.youtube.com/playlist?list=${esc(config.youtubePlaylist)}" rel="noopener" target="_blank">Videos</a>
    <a href="https://github.com/${OWNER}" rel="noopener" target="_blank">GitHub</a>
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

function cardImage(mod, base) {
  if (mod.image) return `<img src="${esc(mod.image.startsWith("http") ? mod.image : base + mod.image)}" alt="" loading="lazy">`;
  if (mod.thumb) return `<img src="${esc(mod.thumb)}" data-fallback="${esc(mod.thumbFallback)}" alt="" loading="lazy">`;
  return `<div class="card-sigil">${SIGIL}<span>${esc(mod.shortTitle.split(" ").map((w) => w[0]).join(""))}</span></div>`;
}

const releaseNotes = (mdk, r) =>
  r.notes ? mdk.render(r.notes) : `<p class="muted">No notes for this release. <a href="${esc(r.url)}">See it on GitHub</a>.</p>`;

// ---------- home ----------
function home() {
  const n = config.latestReleaseCount || 10;
  const all = modules.flatMap((m) => m.releases.filter((r) => !r.prerelease).map((r) => ({ ...r, mod: m })))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, n);
  const totalDl = modules.some((m) => m.downloads != null) ? modules.reduce((s, m) => s + (m.downloads || 0), 0) : null;
  const newest = all[0];

  const entries = all.map((r) => {
    const mdk = markdownFor(r.mod);
    return `<li class="chron-entry">
  <time datetime="${esc(r.date)}">${fmtDate(r.date)}</time>
  <article class="chron-card parchment">
    <header>
      <h3><a href="${DIR}/${esc(r.mod.slug)}/">${esc(r.mod.shortTitle)}</a>${wipBadge(r.mod)}</h3>
      <a class="tag" href="${esc(r.url)}" rel="noopener" target="_blank" title="Release on GitHub">${esc(r.version.match(/^\d/) ? "v" + r.version : r.version)}</a>
    </header>
    <div class="notes prose" data-clamp>${releaseNotes(mdk, r)}</div>
  </article>
</li>`;
  }).join("\n");

  return layout({
    depth: 0,
    active: "home",
    description: config.tagline,
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
</section>`,
  });
}

// ---------- module grid ----------
function moduleCard(mod, base) {
  return `<li class="card parchment" data-title="${esc(mod.shortTitle.toLowerCase())}" data-search="${esc((mod.shortTitle + " " + mod.description + " " + mod.topics.join(" ") + " " + mod.kind + (mod.wip ? " wip work in progress" : "")).toLowerCase())}" data-date="${esc(mod.latestDate)}" data-downloads="${mod.downloads}">
  <a class="card-link" href="${esc(mod.slug)}/" aria-label="${esc(mod.shortTitle)}${mod.wip ? " (work in progress)" : ""}">
    <div class="card-media">${cardImage(mod, base)}${wipBadge(mod)}</div>
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
  return layout({
    depth: 1,
    active: "projects",
    title: "Projects",
    description: `All ${modules.length} Foundry VTT modules and tools by ${OWNER}.`,
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
${modules.map((m) => moduleCard(m, "../")).join("\n")}
</ul>
<p class="empty" id="empty" hidden>No project matches that search. Clear the field to see them all.</p>`,
  });
}

// ---------- module page ----------
// Demo and Tutorial tabs always show; More only when videos are set for it.
const PLAY_ICON = `<svg viewBox="0 0 68 48" aria-hidden="true"><path d="M66.5 7.7A8.5 8.5 0 0 0 60.5 1.7C55.2.3 34 .3 34 .3s-21.2 0-26.5 1.4a8.5 8.5 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.5 8.5 0 0 0 6 6c5.3 1.4 26.5 1.4 26.5 1.4s21.2 0 26.5-1.4a8.5 8.5 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3Z"/><path d="M45 24 27 14v20Z" fill="#fff"/></svg>`;

function playerHtml(v, label) {
  return `<div class="player" data-video="${esc(v.id)}">
  <img src="https://i.ytimg.com/vi/${esc(v.id)}/maxresdefault.jpg" data-fallback="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="">
  <button class="play" type="button" aria-label="Play ${esc(v.title || `the ${label.toLowerCase()} video`)}">${PLAY_ICON}</button>
  <noscript><a href="https://www.youtube.com/watch?v=${esc(v.id)}">Watch on YouTube</a></noscript>
</div>`;
}

function videoBlock(mod) {
  const { demo, tutorial, more } = mod.videos;
  const tabs = [
    { key: "demo", label: "Demo", has: !!demo },
    { key: "tutorial", label: "Tutorial", has: !!tutorial },
    ...(more.length ? [{ key: "more", label: "More", has: true, count: more.length }] : []),
  ];
  const start = (tabs.find((t) => t.has) || tabs[0]).key;
  const playlistUrl = `https://www.youtube.com/playlist?list=${esc(config.youtubePlaylist)}`;
  const empty = (what) => `<div class="video-empty">
  ${SIGIL}
  <p>The ${what} video for ${esc(mod.shortTitle)} is not out yet.</p>
  <p><a href="${playlistUrl}" rel="noopener" target="_blank">See all videos on YouTube</a></p>
</div>`;

  const panel = (t, inner) =>
    `<div class="video-panel" role="tabpanel" id="video-${t.key}" aria-labelledby="tab-${t.key}"${t.key === start ? "" : " hidden"}>${inner}</div>`;

  const panels = tabs.map((t) => {
    if (t.key === "demo") return panel(t, demo ? playerHtml(demo, "Demo") : empty("demo"));
    if (t.key === "tutorial") return panel(t, tutorial ? playerHtml(tutorial, "Tutorial") : empty("tutorial"));
    const reel = more.length > 1
      ? `<ul class="reel" aria-label="More videos">${more.map((v, i) => `<li><button type="button" class="reel-item" data-video="${esc(v.id)}" aria-pressed="${i === 0}">
  <img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" loading="lazy">
  <span>${esc(v.title || `Video ${i + 1}`)}</span>
</button></li>`).join("")}</ul>`
      : "";
    return panel(t, playerHtml(more[0], "More") + reel);
  }).join("\n");

  return `<section class="videos${tabs.some((t) => t.has) ? "" : " no-videos"}" aria-label="Videos">
  <div class="video-tabs" role="tablist" aria-label="Videos">${tabs.map((t) =>
    `<button type="button" role="tab" id="tab-${t.key}" aria-controls="video-${t.key}" aria-selected="${t.key === start}"${t.has ? "" : ' class="is-empty"'}>${t.label}${t.count > 1 ? ` <span class="count">${t.count}</span>` : ""}</button>`).join("")}</div>
  <div class="video-stage">
${panels}
  </div>
</section>`;
}

function statBlock(mod) {
  const line = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : "");
  const rel = (list) => list.map((r) => `<span title="${esc(r.reason)}">${esc(r.id)}</span>`).join(", ");
  const sys = mod.systems.map((s) => `${esc(s.id)}${s.minimum ? ` ${esc(s.minimum)}+` : ""}`).join(", ");
  const c = mod.compatibility || {};
  return `<aside class="statblock parchment" aria-label="Module details">
  <h2>${esc(mod.shortTitle)}</h2>
  <p class="statblock-sub">${esc(mod.kind)}${mod.manifest ? `, ${esc(sys || "system agnostic")}` : ""}</p>
  <hr class="taper">
  <dl class="props">
    ${line("Status", mod.wip ? "Work in progress" : "")}
    ${line("Version", mod.version ? esc(mod.version) : "Not released yet")}
    ${line("Foundry", mod.manifest ? `${esc(foundryRange(c))}${c.verified ? ` <span class="muted">(verified ${esc(c.verified)})</span>` : ""}` : "")}
    ${line("Downloads", mod.downloads == null ? "" : fmtNum(mod.downloads))}
    ${line("Released", mod.releases[0] ? fmtDate(mod.releases[0].date) : "")}
    ${Object.entries(mod.details).map(([k, v]) => line(esc(k), esc(v))).join("\n    ")}
  </dl>
  ${mod.requires.length || mod.recommends.length || mod.license ? `<hr class="taper"><dl class="props">
    ${line("Requires", rel(mod.requires))}
    ${line("Works with", rel(mod.recommends))}
    ${line("License", esc(mod.license || ""))}
  </dl>` : ""}
  ${mod.manifest ? `<h3>Install</h3>
  <p class="install-help">In Foundry, open <b>Add-on Modules</b>, choose <b>Install Module</b> and paste this into <b>Manifest URL</b>.</p>
  <div class="manifest"><input readonly value="${esc(mod.manifest)}" aria-label="Manifest URL" id="manifest-${esc(mod.slug)}"><button type="button" class="copy" data-copy="#manifest-${esc(mod.slug)}">Copy</button></div>` : ""}
  <h3>Links</h3>
  ${mod.notPublic ? `<p class="install-help">The source is not public yet. Follow the <a href="https://github.com/${OWNER}" rel="noopener" target="_blank">GitHub profile</a> to see it when it is.</p>` : `<ul class="links">
    <li><a href="${esc(mod.url)}" rel="noopener" target="_blank">Source on GitHub</a></li>
    <li><a href="${esc(mod.url)}/issues" rel="noopener" target="_blank">Report a bug</a></li>
    <li><a href="${esc(mod.url)}/releases" rel="noopener" target="_blank">All releases</a></li>
  </ul>`}
  <p class="kofi"><a href="${esc(config.kofi)}" rel="noopener" target="_blank"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Zm13 1h1.5a2.5 2.5 0 0 1 0 5H17" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 14.2 8.3 12a1.3 1.3 0 0 1 2.2-1.5 1.3 1.3 0 0 1 2.2 1.5Z" fill="currentColor"/></svg>Enjoying it? Buy me a coffee on Ko-fi</a></p>
</aside>`;
}

function modulePage(mod) {
  const mdk = markdownFor(mod);
  const body = mod.customMd ? mdk.render(mod.customMd)
    : mod.readme ? readmeHtml(mod, mdk)
    : `<p>${esc(mod.description)}</p>`;
  const history = mod.releases.filter((r) => !r.prerelease).slice(0, 5).map((r) => `<li>
  <details${r === mod.releases[0] ? " open" : ""}>
    <summary><span class="ver">${esc(r.version)}</span> <time datetime="${esc(r.date)}">${fmtDate(r.date)}</time></summary>
    <div class="prose">${releaseNotes(mdk, r)}</div>
  </details>
</li>`).join("\n");

  return layout({
    depth: 2,
    active: "projects",
    title: mod.shortTitle,
    description: mod.description,
    image: mod.thumbFallback,
    body: `
<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Projects</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(mod.shortTitle)}</span></nav>
<section class="module-head">
  <h1>${esc(mod.shortTitle)}</h1>
  <p class="lede">${esc(mod.summary)}</p>
  ${mod.wip ? `<p class="wip-note">${wipBadge(mod)}<span>${esc(mod.wip.note || WIP_TEXT)}${mod.notPublic ? "" : ` <a href="${esc(mod.url)}/issues" rel="noopener" target="_blank">Report bugs on GitHub</a>.`}</span></p>` : ""}
</section>
${videoBlock(mod)}
<div class="module-layout">
  <article class="parchment prose readme">${body}</article>
  ${statBlock(mod)}
</div>
${history ? `<section class="history" aria-labelledby="hist-h">
  <h2 id="hist-h" class="section-title">Changelog</h2>
  <ol class="history-list parchment">${history}</ol>
  ${mod.releases.length > 5 ? `<p class="more"><a href="${esc(mod.url)}/releases" rel="noopener" target="_blank">Older releases on GitHub</a></p>` : ""}
</section>` : ""}`,
  });
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
await _writeFile(path.join(OUT, ".nojekyll"), "");
await writePage(path.join(OUT, "index.html"), home());
await writePage(path.join(OUT, DIR, "index.html"), modulesPage());
for (const mod of modules) {
  await mkdir(path.join(OUT, DIR, mod.slug), { recursive: true });
  await writePage(path.join(OUT, DIR, mod.slug, "index.html"), modulePage(mod));
}
await writePage(path.join(OUT, "404.html"), layout({
  depth: 0, title: "Page not found",
  body: `<section class="page-head"><h1>This page is not on the map</h1><p class="lede">The link may be old or mistyped. <a href="./">Go to the latest releases</a> or <a href="./${DIR}/">see all projects</a>.</p></section>`,
// 404.html is served at any depth, so it needs absolute links. In Actions,
// BASE_PATH comes from actions/configure-pages ("/" or "/<repo>/").
}).replace(/(href|src)="\.\//g, `$1="${(process.env.BASE_PATH || config.basePath || "/").replace(/\/?$/, "/")}`));
console.log(`[build] ${modules.length} module pages written to _site/`);
