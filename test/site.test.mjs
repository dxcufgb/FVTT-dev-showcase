// node --test: the generated SEO for a made-up project list, built into a temp folder.
// It checks that a module nobody configured gets a title, a description, a social
// image, JSON-LD, a sitemap entry and a docs mirror on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as seo from "../scripts/lib/seo.mjs";
import { buildDocs, leadText, firstText } from "../scripts/lib/wiki.mjs";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://example.github.io/showcase/";

const NEW = {
  repo: "FoundryVTT-ember-sigils", isModule: true, id: "dxcufgbs-ember-sigils", title: "Dxcufgb's ember sigils", shortTitle: "Ember Sigils",
  description: "Draws glowing sigils under tokens that are concentrating on a spell, so the whole table can see who holds which effect. Each sigil fades out when concentration ends.",
  version: "0.3.0", compatibility: { minimum: "13", verified: "13" },
  manifest: "https://github.com/dxcufgb/FoundryVTT-ember-sigils/releases/latest/download/module.json",
  url: "https://github.com/dxcufgb/FoundryVTT-ember-sigils", foundryPackage: null, branch: "main", topics: ["wip"],
  createdAt: "2026-10-01T00:00:00Z", pushedAt: "2026-10-30T10:00:00Z", license: "MIT",
  requires: [], recommends: [], systems: [{ id: "dnd5e", type: "system" }], downloads: 3,
  readme: "# Dxcufgb's ember sigils\n\n[![Release](https://img.shields.io/x)](https://github.com/x)\n\nDraws glowing sigils under concentrating tokens.\n\n## Features\n\n- Sigils\n",
  releases: [{ tag: "v0.3.0", version: "0.3.0", name: "v0.3.0", date: "2026-10-30T12:00:00Z", url: "https://github.com/dxcufgb/FoundryVTT-ember-sigils/releases/tag/v0.3.0", prerelease: false, downloads: 3, notes: "- feat: sigils fade out" }],
  videos: { demo: { id: "abcdefghijk", title: "Ember Sigils - Demo", published: "2026-10-31T09:00:00Z" }, tutorial: null },
  wikiPages: [
    { name: "Home", md: "# Ember Sigils\n\nGlowing sigils under every token that holds concentration, drawn on the map for everyone at the table.\n", updated: "2026-10-30T10:00:00Z" },
    { name: "Sigil-Styles", md: "# Sigil styles\n\nEvery school of magic has its own sigil: evocation burns orange, necromancy smoulders green and abjuration glows blue. See [[Home]].\n", updated: "2026-10-30T10:00:00Z" },
    { name: "_Sidebar", md: "**Using it**\n- [Sigil styles](Sigil-Styles)\n", updated: "2026-10-30T10:00:00Z" },
  ],
};

let out;
let html;
test("a new module gets its SEO without any configuration", async (t) => {
  out = await mkdtemp(path.join(tmpdir(), "showcase-"));
  if (!process.env.KEEP) t.after(() => rm(out, { recursive: true, force: true }));
  else console.log("kept", out);
  const data = path.join(out, "data.json");
  await writeFile(data, JSON.stringify({ generatedAt: "2026-11-01T00:00:00Z", owner: "dxcufgb", playlist: [], modules: [NEW] }));
  const env = { ...process.env, DATA_FILE: data, OUT_DIR: path.join(out, "site"), SITE_URL: SITE, CHROME_PATH: process.env.TEST_CHROME_PATH || "/nonexistent/chrome" };
  await run(process.execPath, [path.join(ROOT, "scripts/build.mjs")], { env });
  await run(process.execPath, [path.join(ROOT, "scripts/og-images.mjs")], { env });
  const site = path.join(out, "site");
  html = await readFile(path.join(site, "projects/ember-sigils/index.html"), "utf8");

  const title = /<title>([^<]+)<\/title>/.exec(html)[1];
  assert.match(title, /^Ember Sigils – Foundry VTT module for D&amp;D 5e$/);
  const desc = /<meta name="description" content="([^"]+)"/.exec(html)[1];
  assert.ok(desc.length >= 120 && desc.length <= seo.DESC_MAX, `description length ${desc.length}: ${desc}`);
  assert.match(desc, /work in progress/i, "WIP is said honestly");
  assert.match(html, /<html lang="en">/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}projects/ember-sigils/">`));
  assert.match(html, new RegExp(`<meta property="og:image" content="${SITE}og/ember-sigils.png">`));
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, "exactly one h1");
  await access(path.join(site, "og/ember-sigils.png"));

  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { const j = JSON.parse(m[1]); return j["@graph"] || [].concat(j); });
  const app = ld.find((x) => x["@type"] === "SoftwareApplication");
  assert.ok(app, "SoftwareApplication");
  assert.equal(app.applicationCategory, "GameApplication");
  assert.equal(app.operatingSystem, "Foundry VTT v13");
  assert.equal(app.softwareVersion, "0.3.0");
  assert.equal(app.offers.price, "0");
  assert.equal(app.downloadUrl, NEW.manifest);
  const video = ld.find((x) => x["@type"] === "VideoObject");
  assert.ok(video, "VideoObject");
  assert.equal(video.uploadDate, "2026-10-31T09:00:00.000Z");
  assert.equal(video.embedUrl, "https://www.youtube.com/embed/abcdefghijk");
  assert.ok(ld.find((x) => x["@type"] === "BreadcrumbList"));

  const sitemap = await readFile(path.join(site, "sitemap.xml"), "utf8");
  assert.match(sitemap, new RegExp(`<loc>${SITE}projects/ember-sigils/</loc><lastmod>2026-10-30T12:00:00.000Z</lastmod>`));
  assert.match(sitemap, new RegExp(`<loc>${SITE}projects/ember-sigils/docs/sigil-styles/</loc>`));
  const robots = await readFile(path.join(site, "robots.txt"), "utf8");
  assert.match(robots, new RegExp(`Sitemap: ${SITE}sitemap.xml`));

  const docs = await readFile(path.join(site, "projects/ember-sigils/docs/sigil-styles/index.html"), "utf8");
  assert.match(docs, /<title>Sigil styles – Ember Sigils docs<\/title>/);
  assert.match(docs, /See <a href="(\.\.\/)+projects\/ember-sigils\/docs\/">Home<\/a>/, "wiki links point at the mirror");

  const home = await readFile(path.join(site, "index.html"), "utf8");
  assert.match(home, /href="\.\/projects\/ember-sigils\/"/, "home links to the new module");
  assert.ok(/"@type":"WebSite"/.test(home.replace(/\s/g, "")) && /"@type":"Person"/.test(home.replace(/\s/g, "")));
  const notFound = await readFile(path.join(site, "404.html"), "utf8");
  assert.match(notFound, /<meta name="robots" content="noindex">/);
});

test("titles stay short and descriptions stay in range", () => {
  const mod = { ...NEW, wip: { note: null }, docs: null, hasVideos: true };
  assert.ok(seo.projectTitle(mod).length <= seo.TITLE_MAX);
  const long = { ...mod, shortTitle: "An Extremely Long Module Name For Testing Titles" };
  assert.ok(seo.projectTitle(long).length <= seo.TITLE_MAX);
  const d = seo.projectDescription(mod, firstText(NEW.readme));
  assert.ok(d.length <= seo.DESC_MAX && d.length >= 120, d);
  assert.doesNotMatch(d, /\[\]|\]\(/, "no markdown left over");
});

test("README badges and code never reach a description", () => {
  assert.equal(firstText("[![a](b)](c)\n[![d](e)](f)\\\n\nReal words about the module go here.\n"), "Real words about the module go here.");
  assert.equal(leadText("Call `game.modules.get(\"x\").api.open()` to open it.\n\n```js\nfoo();\n```\n"), "Call to open it.");
  const docs = buildDocs(NEW.wikiPages);
  assert.deepEqual(docs.pages.map((p) => p.slug), ["", "sigil-styles"]);
  assert.equal(docs.pages[1].feature, true);
});
