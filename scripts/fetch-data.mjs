#!/usr/bin/env node
// Collects everything the site shows and writes it to data/site-data.json.
//
// A module is any public, non-fork, non-archived repo of the owner that has a
// module.json at the root of its default branch. Nothing has to be registered:
// publish a new module repo and it shows up on the next build.
//
// Env:
//   GITHUB_TOKEN / GH_TOKEN  optional locally, set automatically in Actions
//   YOUTUBE_API_KEY          optional; without it the playlist RSS feed is used
//                            (that feed only lists the newest 15 videos)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(ROOT, "site.config.json"), "utf8"));
const OWNER = config.owner;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const log = (...a) => console.log("[fetch]", ...a);
const warn = (...a) => console.warn("[fetch] warning:", ...a);

async function gh(pathOrUrl) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `https://api.github.com${pathOrUrl}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": `${OWNER}-module-site`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") || "")?.[1];
  return { data: await res.json(), next };
}

async function ghAll(p) {
  const out = [];
  let url = p;
  while (url) {
    const { data, next } = await gh(url);
    out.push(...data);
    url = next;
  }
  return out;
}

async function text(url) {
  const res = await fetch(url, { headers: { "User-Agent": `${OWNER}-module-site` } });
  return res.ok ? res.text() : null;
}

async function json(url) {
  const t = await text(url);
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}

const raw = (repo, branch, file) =>
  `https://raw.githubusercontent.com/${OWNER}/${repo}/${branch}/${file}`;

const versionOf = (tag) => String(tag || "").replace(/^v/i, "");

// "## 1.0.2" / "## [1.0.2] - 2026-10-01" / "## v1.0.2" -> markdown body of that section
function changelogSection(changelog, version) {
  if (!changelog || !version) return null;
  const lines = changelog.split(/\r?\n/);
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`^##\\s+\\[?v?${esc}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join("\n").trim();
  return body || null;
}

// GitHub's generated notes: drop the bare "Full Changelog" line, keep real content.
function cleanReleaseBody(body) {
  if (!body) return null;
  const cleaned = body
    .replace(/^\*\*Full Changelog\*\*:.*$/gim, "")
    .replace(/^##\s*What's Changed\s*$/gim, "")
    .trim();
  return cleaned || null;
}

const zipDownloads = (assets = []) =>
  assets.filter((a) => /\.zip$/i.test(a.name)).reduce((n, a) => n + (a.download_count || 0), 0);

// ---------- YouTube ----------
async function playlistVideos(playlistId) {
  if (!playlistId) return [];
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    const videos = [];
    let pageToken = "";
    do {
      const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${key}${pageToken ? `&pageToken=${pageToken}` : ""}`;
      const data = await json(url);
      if (!data?.items) { warn("YouTube API gave no items, falling back to RSS"); break; }
      for (const it of data.items) {
        const s = it.snippet;
        if (!s?.resourceId?.videoId || /^(Private|Deleted) video$/.test(s.title)) continue;
        videos.push({ id: s.resourceId.videoId, title: s.title, published: s.publishedAt });
      }
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    if (videos.length) return videos;
  }
  // YouTube often refuses this feed from cloud servers such as GitHub's runners, and it lists only the 15 newest
  // videos, so videos pinned in site.config.json are the dependable way to link them.
  let xml = null;
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Accept-Language": "en" },
    });
    if (res.ok) xml = await res.text();
    else warn(`the playlist feed answered HTTP ${res.status}; only videos set in site.config.json will show`);
  } catch (e) { warn(`could not reach the playlist feed (${e.message}); only videos set in site.config.json will show`); }
  if (!xml) return [];
  const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: /<yt:videoId>([^<]+)/.exec(e)?.[1],
    title: decode(/<title>([^<]*)/.exec(e)?.[1] || ""),
    published: /<published>([^<]+)/.exec(e)?.[1],
  })).filter((v) => v.id);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TUTORIAL = /\b(tutorial|instructions?|how to|guide|walkthrough|setup|set up|getting started|explained)\b/i;

function matchVideos(mod, videos) {
  const names = [mod.shortTitle, mod.id.replace(config.slugPrefix || "", "").replace(/-/g, " ")]
    .map(norm).filter(Boolean);
  const hits = videos.filter((v) => names.some((n) => norm(v.title).includes(n)));
  const pick = (want) => hits.find((v) => TUTORIAL.test(v.title) === want) || null;
  return { demo: pick(false), tutorial: pick(true) };
}

// ---------- titles ----------
const SMALL = new Set(["a", "an", "and", "of", "the", "for", "to", "in", "on", "or"]);
function shortTitle(title) {
  let t = config.titlePrefix ? title.replace(new RegExp(config.titlePrefix, "i"), "") : title;
  if (config.titleCase) {
    t = t.split(/\s+/).map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
  }
  return t;
}

// ---------- main ----------
// Per-repo settings live under "projects" (older configs used "modules").
const PROJECTS = { ...(config.modules || {}), ...(config.projects || {}) };
const prettyName = (repoName) => repoName.replace(/^FoundryVTT-/i, "").split(/[-_]+/)
  .map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
const projectSlug = (repoName) => PROJECTS[repoName]?.slug || repoName.replace(/^FoundryVTT-/i, "").toLowerCase();

log(`owner ${OWNER}${TOKEN ? " (authenticated)" : " (unauthenticated: 60 requests/hour)"}`);
const repos = (await ghAll(`/users/${OWNER}/repos?per_page=100&type=owner&sort=pushed`))
  .filter((r) => !r.fork && !r.archived && !r.private && !config.exclude.includes(r.name));

const COMMIT_SKIP = /^(merge |bump |release |chore\(release\)|v?\d+\.\d+\.\d+$)/i;

const modules = [];
for (const repo of repos) {
  const branch = repo.default_branch;
  const branchManifest = await json(raw(repo.name, branch, "module.json"));
  const isModule = !!branchManifest?.id;
  // Not a Foundry module (a bot, a server, ...): listed only when the config includes it.
  if (!isModule && !PROJECTS[repo.name]?.include) continue;

  const releases = (await ghAll(`/repos/${OWNER}/${repo.name}/releases?per_page=100`))
    .filter((r) => !r.draft);
  const published = releases.filter((r) => !r.prerelease);
  const latest = published[0] || releases[0] || null;

  // The released manifest is the truth for version and compatibility.
  const released = isModule && latest
    ? await json(`https://github.com/${OWNER}/${repo.name}/releases/download/${latest.tag_name}/module.json`)
    : null;
  const m = released?.id ? released : branchManifest || {};
  const pkg = isModule ? null : await json(raw(repo.name, branch, "package.json"));

  const [readme, changelog] = await Promise.all([
    text(raw(repo.name, branch, "README.md")),
    text(raw(repo.name, branch, "CHANGELOG.md")),
  ]);

  const rel = m.relationships || {};
  const hasZips = releases.some((r) => r.assets?.some((a) => /\.zip$/i.test(a.name)));
  const title = m.title || prettyName(repo.name);
  const mod = {
    repo: repo.name,
    isModule,
    id: m.id || projectSlug(repo.name),
    title,
    shortTitle: isModule ? shortTitle(title) : title,
    description: String(m.description || repo.description || pkg?.description || "").replace(/<[^>]+>/g, "").trim(),
    version: m.version || versionOf(latest?.tag_name) || pkg?.version || null,
    compatibility: m.compatibility || {},
    manifest: m.manifest || null,
    url: repo.html_url,
    branch,
    topics: repo.topics || [],
    createdAt: repo.created_at,
    license: repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION" ? repo.license.spdx_id : null,
    requires: (rel.requires || []).map((r) => ({ id: r.id, type: r.type, reason: r.reason || "" })),
    recommends: (rel.recommends || []).map((r) => ({ id: r.id, type: r.type, reason: r.reason || "" })),
    systems: (rel.systems || []).map((s) => ({ id: s.id, minimum: s.compatibility?.minimum || null })),
    downloads: hasZips ? releases.reduce((n, r) => n + zipDownloads(r.assets), 0) : null,
    readme,
    releases: releases.map((r) => {
      const v = versionOf(r.tag_name);
      return {
        tag: r.tag_name,
        version: v,
        name: r.name || r.tag_name,
        date: r.published_at || r.created_at,
        url: r.html_url,
        prerelease: r.prerelease,
        downloads: zipDownloads(r.assets),
        notes: changelogSection(changelog, v) || cleanReleaseBody(r.body),
      };
    }),
  };
  // No CHANGELOG entry and only auto-generated notes: list the commits since
  // the previous release instead (newest 5 releases, the ones the site shows).
  for (let i = 0; i < Math.min(5, mod.releases.length); i++) {
    const r = mod.releases[i], prev = mod.releases[i + 1];
    if (r.notes || !prev) continue;
    try {
      const { data } = await gh(`/repos/${OWNER}/${repo.name}/compare/${encodeURIComponent(prev.tag)}...${encodeURIComponent(r.tag)}`);
      const lines = (data.commits || [])
        .map((c) => c.commit.message.split("\n")[0].trim())
        .filter((s) => s && !COMMIT_SKIP.test(s))
        .reverse();
      if (lines.length) r.notes = lines.map((s) => `- ${s}`).join("\n");
    } catch (e) { warn(`no commit list for ${repo.name} ${r.tag}: ${e.message}`); }
  }

  modules.push(mod);
  log(`${mod.shortTitle} ${mod.version ?? "(no version)"} — ${mod.releases.length} releases, ${mod.downloads ?? "no"} downloads`);
}

// Included repos that are not public yet: listed from the config alone
// (title, description, content/<slug>.md). They fill in once the repo is public.
for (const [name, p] of Object.entries(PROJECTS)) {
  if (!p.include || modules.some((m) => m.repo === name) || config.exclude.includes(name)) continue;
  const title = p.title || prettyName(name);
  modules.push({
    repo: name, isModule: false, notPublic: true,
    id: projectSlug(name), title, shortTitle: title,
    description: p.description || "", version: null, compatibility: {}, manifest: null,
    url: `https://github.com/${OWNER}/${name}`, branch: "main", topics: [], createdAt: null, license: null,
    requires: [], recommends: [], systems: [], downloads: null, readme: null, releases: [],
  });
  log(`${title} — not public yet, listed from site.config.json`);
}

const videos = await playlistVideos(config.youtubePlaylist);
log(`${videos.length} playlist videos`);
// Auto-matched by title. Videos set in site.config.json win; build.mjs applies
// them, so editing the config never needs a re-fetch.
for (const mod of modules) mod.videos = matchVideos(mod, videos);

const when = (m) => m.releases[0]?.date || m.createdAt || "";
modules.sort((a, b) => when(b).localeCompare(when(a)));
await mkdir(path.join(ROOT, "data"), { recursive: true });
await writeFile(
  path.join(ROOT, "data", "site-data.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), owner: OWNER, playlist: videos, modules }, null, 2)
);
log(`wrote data/site-data.json with ${modules.length} projects`);
