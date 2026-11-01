// Titles, descriptions, structured data (JSON-LD) and the sitemap.
// Everything here is generated from the project data, so a new module gets it
// without any per-page work. build.mjs imports these; test/seo.test.mjs checks them.

export const TITLE_MAX = 60;
export const DESC_MIN = 140;
export const DESC_MAX = 160;

const KNOWN_MODULES = {
  "dice-so-nice": "Dice So Nice",
  sequencer: "Sequencer",
  "midi-qol": "Midi-QOL",
  "lib-wrapper": "libWrapper",
  socketlib: "socketlib",
};
const KNOWN_SYSTEMS = { dnd5e: "D&D 5e", pf2e: "Pathfinder 2e" };

const clean = (s = "") => String(s).replace(/\s+/g, " ").trim();
// Parenthesised lists ("(Druid, Magic Smoke, ...)") read badly in search results.
const dropParens = (s = "") => clean(String(s).replace(/\s*\([^)]*\)/g, ""));

export function moduleLabel(id) {
  return KNOWN_MODULES[id] || id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
export function systemLabel(id) {
  return KNOWN_SYSTEMS[id] || id;
}

// "Server tool" → "server tool", but "Discord bot" keeps its capital.
const PROPER = /^(Discord|Foundry|GitHub|Spotify|YouTube)\b/;
export const kindWords = (kind = "") => (PROPER.test(kind) ? kind : kind.charAt(0).toLowerCase() + kind.slice(1));

// What the project is, in words people search for: "Foundry VTT v13 module for Dice So Nice".
export function audience(mod) {
  if (mod.isModule === false) return { kind: `${kindWords(mod.kind)} for Foundry VTT`, qualifier: "" };
  const v = String(mod.compatibility?.verified || mod.compatibility?.minimum || "13").split(".")[0];
  const sys = (mod.systems || []).map((s) => systemLabel(s.id));
  const req = (mod.requires || []).filter((r) => r.type !== "system").map((r) => moduleLabel(r.id));
  const qualifier = sys.length ? `for ${sys.join(" and ")}` : req.length ? `for ${req.join(" and ")}` : "";
  return { kind: `Foundry VTT v${v} module`, qualifier, version: v };
}

// "Dice Trails – Foundry VTT module for Dice So Nice"; shorter variants when it doesn't fit.
export function projectTitle(mod) {
  if (mod.seoTitle) return mod.seoTitle;
  const name = mod.shortTitle;
  const { qualifier } = audience(mod);
  const options = mod.isModule === false
    ? [`${name} – ${mod.kind} for Foundry VTT`, `${name} – ${mod.kind}`, name]
    : [`${name} – Foundry VTT module ${qualifier}`.trim(), `${name} – Foundry VTT module`, `${name} – FoundryVTT`, name];
  return options.find((t) => t.length <= TITLE_MAX) || name.slice(0, TITLE_MAX);
}

export function docsTitle(mod, pageTitle, isIndex) {
  const what = mod.isModule === false ? mod.kind : "Foundry VTT module";
  const options = isIndex
    ? [`${mod.shortTitle} documentation – ${what}`, `${mod.shortTitle} documentation`, `${mod.shortTitle} docs`]
    : [`${pageTitle} – ${mod.shortTitle} docs`, `${pageTitle} – ${mod.shortTitle}`, pageTitle];
  return options.find((t) => t.length <= TITLE_MAX) || options[options.length - 1].slice(0, TITLE_MAX);
}

// Cut text at the last clause or word boundary that fits, ending it as a sentence.
function cutTo(text, max) {
  text = clean(text);
  if (text.length <= max) return text;
  const room = text.slice(0, max);
  const clause = Math.max(room.lastIndexOf(", "), room.lastIndexOf("; "), room.lastIndexOf(": "), room.lastIndexOf(" – "));
  let cut = clause > max * 0.5 ? room.slice(0, clause) : room.slice(0, room.lastIndexOf(" "));
  cut = cut.replace(/[\s,;:–-]+$/, "").replace(/\b(and|or|with|the|a|an|of|to|for|in|on)$/i, "").trim();
  return cut;
}
const endSentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

// Dots inside words ("setup.exe", "v1.2") are not sentence ends.
const sentences = (text) => (clean(text).replace(/(\w)\.(?=\w)/g, "$1\u2024").match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [])
  .map((x) => x.trim().replace(/\u2024/g, "."));
const STOP = /\s+(a|an|and|or|the|of|to|for|in|on|at|by|with|from|into|as|when|while|that|which|who|its|their|your|his|her|is|are|was|be|can|will)$/i;

// A sentence, then its opening clause (before a colon or dash) as a shorter stand-in.
// A sentence, then shorter stand-ins that still read as whole sentences: the part
// before a colon or dash, or before a trailing ", with …" / ", so …" phrase.
function clauses(s) {
  const out = [s];
  const add = (c) => {
    c = c.replace(/[,;:\s]+$/, "");
    if (STOP.test(c) || /\bsuch as$/i.test(c)) return; // "… when an NPC" is not a sentence
    if (c !== s.replace(/[.!?]$/, "") && c.length > 25 && !out.includes(endSentence(c))) out.push(endSentence(c));
  };
  add(s.split(/:\s+| – /)[0]);
  const tails = [...s.matchAll(/,\s+(?=(with|so|which|while|including|such as|plus|where|when|and then|or)\b)/gi)].map((m) => m.index).reverse();
  for (const i of tails) add(s.slice(0, i));
  return out;
}
// Sentences that read on their own: no "Foundry VTT: v13 · Requires: …" fact lines.
const pool = (...texts) => {
  const seen = new Set();
  return texts.flatMap((t) => sentences(dropParens(t || "")))
    .filter((s) => s.length > 12 && !/ · /.test(s) && !/^(see|read) /i.test(s) && !/^[\w &]+:\s*v?\d[\d.]*\.?$/i.test(s))
    // sentences about the docs themselves ("The full guide is in the wiki.")
    .filter((s) => !/\b(wiki|readme)\b|\bguide is\b|\bdocumentation\b/i.test(s))
    // placeholders, addresses and leftovers of removed code read badly out of context
    .filter((s) => !/<[^>]*>|https?:\/\/|:\s*[.,]|^(then|and|or|but|so)\b/i.test(s))
    .filter((s) => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
};
// first + more sentences from rest until the whole thing (with tail) reaches min, never past max
const words = (t) => new Set(t.toLowerCase().match(/[a-z0-9']{3,}/g) || []);
const repeats = (have, s) => { const w = [...words(s)]; const h = words(have); return w.length && w.filter((x) => h.has(x)).length / w.length > 0.6; };
function fill(first, rest, tail) {
  let out = first;
  for (const s of rest.flatMap(clauses)) {
    if ((out + tail).length >= DESC_MIN) break;
    if (repeats(out, s)) continue;
    if (`${out} ${s}${tail}`.length <= DESC_MAX) out = `${out} ${s}`;
  }
  return clean(out + tail);
}
// last resort: a word-boundary cut that never ends on "the", "with", "at"…
function cutWords(text, max) {
  let t = clean(text).slice(0, max);
  t = t.slice(0, t.lastIndexOf(" ")).replace(/[\s,;:–-]+$/, "");
  while (STOP.test(t)) t = t.replace(STOP, "");
  return endSentence(t);
}
const score = (d) => (d.length >= DESC_MIN && d.length <= DESC_MAX ? 1000 : 0) + Math.min(d.length, DESC_MAX);

// Meta description: what it does first, then what it is, 140–160 characters.
// readmeLead: the README's opening text, a second source of whole sentences.
export function projectDescription(mod, readmeLead = "") {
  if (mod.seoDescription) return mod.seoDescription;
  const { kind, qualifier } = audience(mod);
  const thing = `${kind}${qualifier ? ` ${qualifier}` : ""}`;
  const free = mod.notPublic ? ["A"] : mod.isModule === false ? ["A free", "Free"] : ["A free, open-source", "A free", "Free"];
  const wip = mod.wip ? ", still a work in progress" : "";
  const extra = mod.docs && mod.hasVideos ? ", with a full guide and demo videos" : mod.docs ? ", with a full guide" : mod.hasVideos ? ", with demo videos" : "";
  const tails = free.flatMap((f) => [` ${f} ${thing}${wip}${extra}.`, ` ${f} ${thing}${wip}.`]);
  // bots and server tools run on the user's own machine; shorter endings for long openings
  if (mod.isModule === false) tails.push(` A free, self-hosted ${kindWords(mod.kind)}${wip}.`, ` Free and self-hosted${wip}.`);
  // a long opening sentence that only fits alone is better than a broken one
  tails.push(mod.wip ? " Still a work in progress." : "");
  const sents = pool(mod.description || mod.summary, readmeLead);
  if (!sents.length) sents.push(endSentence(mod.summary || mod.shortTitle));
  let best = "";
  for (const tail of tails) {
    const first = clauses(sents[0]).find((x) => (x + tail).length <= DESC_MAX);
    if (!first) continue;
    const d = fill(first, sents.slice(1), tail);
    if (score(d) > score(best)) best = d;
    if (d.length >= DESC_MIN) break;
  }
  return best || cutWords(sents[0], DESC_MAX - tails.at(-1).length) + tails.at(-1);
}

// Pages that are mostly tables, code or steps get a description of what the page is.
function referenceDescription(mod, pageTitle, name) {
  const { kind, qualifier } = audience(mod);
  const what = `${mod.shortTitle}, a free ${kind}${qualifier ? ` ${qualifier}` : ""}`;
  const pick = (...options) => options.find((d) => d.length >= DESC_MIN && d.length <= DESC_MAX) || options.filter((d) => d.length <= DESC_MAX).sort((a, b) => b.length - a.length)[0] || null;
  if (/^installation$/i.test(name)) return pick(
    `How to install ${what}, from its manifest URL in Foundry's Add-on Modules, and how to update it.`,
    `How to install ${what}: paste its manifest URL into Foundry's Add-on Modules, enable it in your world, and update it.`,
    `How to install ${mod.shortTitle}, a free ${kind}: paste its manifest URL into Foundry's Add-on Modules, enable it in your world, and update it.`,
    `How to install ${mod.shortTitle}, a free ${kind}, from its manifest URL in Foundry's Add-on Modules, and how to update it.`);
  if (/^settings$/i.test(name)) return pick(
    `Every setting of ${what}: what it does, who can change it, and whether it is saved for the world or for each player.`,
    `Every setting of ${mod.shortTitle}, a free ${kind}: what it does, who can change it, and whether it is saved for the world or for each player.`);
  if (/^api$/i.test(name)) return pick(
    `The ${mod.shortTitle} API for macro and module authors: the functions on the module's api object, the hooks it calls and the data it stores.`,
    `The ${mod.shortTitle} API for Foundry VTT macro and module authors: the functions on the module's api object, the hooks it calls and the data it stores.`);
  return null;
}

export function docsDescription(mod, pageTitle, leadTextOfPage, isIndex, pageName = "", taken = new Set()) {
  const { kind } = audience(mod);
  const template = referenceDescription(mod, pageTitle, pageName);
  if (template && template.length <= DESC_MAX && !taken.has(template)) return template;
  const sents = pool(leadTextOfPage).map((x) => x.replace(/:\.$/, "."));
  // "Notes: the third view…": the page names its subject itself, so no "Notes: " in front
  const labelled = sents.length && /^[^:.]{2,40}:\s/.test(sents[0]);
  const prefixes = [isIndex ? `${mod.shortTitle} guide: ` : labelled ? "" : `${pageTitle}: `, ""];
  if (labelled) sents[0] = sents[0][0].toUpperCase() + sents[0].slice(1);
  // short pages borrow what the module does, so the description still says something
  const extra = [...pool(mod.description || mod.summary).slice(0, 2), endSentence(mod.summary || "")].filter((x) => x.length > 1);
  const tails = [` From the guide to ${mod.shortTitle}, a free ${kind}.`, ` From the ${mod.shortTitle} guide.`, isIndex ? " Full guide." : ""];
  let best = "";
  // with the page's name in front if it fits, else the tail names the guide
  for (const prefix of prefixes) {
    for (const tail of tails) {
      const first = sents.length
        ? clauses(sents[0]).map((x) => prefix + lowerFirst(x, prefix)).find((x) => (x + tail).length <= DESC_MAX)
        : `${pageTitle} for ${mod.shortTitle}, a free ${kind}.`;
      if (!first) continue;
      const d = fill(first, [...sents.slice(1), ...extra], sents.length || tail !== tails[0] ? tail : "");
      if (taken.has(d)) continue;
      if (score(d) > score(best)) best = d;
      if (d.length >= DESC_MIN) return d;
    }
  }
  return best || fill(`${pageTitle} for ${mod.shortTitle}, a free ${kind}.`, extra, "");
}
// "Settings: the settings are…", but keep "Settings: GM-only…" and names as written
const lowerFirst = (t, prefix) => (prefix && /^[A-Z][a-z]+\b/.test(t) && !/^(I|Foundry|GitHub|Discord|Dice|Quest|Familiar|Lively|Tile|Token|Canvas|Screen|Scenario|Session|Linguistic|Reminders|Death|Patches|Spotify|YouTube)\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

// A list of names that fits in a sentence: "Dice Trails, Lively Tokens and Quest Log".
export function listNames(names, max) {
  const out = [];
  for (const n of names) {
    const next = [...out, n];
    const text = next.length > 1 ? `${next.slice(0, -1).join(", ")} and ${next.at(-1)}` : next[0];
    if (text.length > max) break;
    out.push(n);
  }
  return out.length > 1 ? `${out.slice(0, -1).join(", ")} and ${out.at(-1)}` : out[0] || "";
}

// ---------- JSON-LD ----------
const iso = (d) => (d ? new Date(d).toISOString() : undefined);
const duration = (sec) => {
  if (!sec) return undefined;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `PT${m ? `${m}M` : ""}${s}S`;
};
const strip = (o) => JSON.parse(JSON.stringify(o)); // drops undefined

export function personLd(site, config) {
  return strip({
    "@type": "Person",
    "@id": `${site}#person`,
    name: config.owner,
    url: `https://github.com/${config.owner}`,
    sameAs: [`https://github.com/${config.owner}`, config.kofi, config.youtubeChannel].filter(Boolean),
  });
}

export function websiteLd(site, config, description) {
  return {
    "@type": "WebSite",
    "@id": `${site}#website`,
    name: config.siteTitle,
    url: site,
    description,
    inLanguage: "en",
    author: { "@id": `${site}#person` },
    publisher: { "@id": `${site}#person` },
  };
}

export function breadcrumbLd(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
  };
}

export function itemListLd(site, mods, pageUrl) {
  return {
    "@type": "CollectionPage",
    "@id": `${pageUrl}#page`,
    url: pageUrl,
    name: "Foundry VTT projects by " + mods[0]?.owner,
    isPartOf: { "@id": `${site}#website` },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: mods.map((m, i) => ({ "@type": "ListItem", position: i + 1, url: m.pageUrl, name: m.shortTitle })),
    },
  };
}

export function videoLd(mod, v, label) {
  if (!v.uploadDate) return null; // Google requires uploadDate; skip rather than guess
  const what = mod.wip ? "work-in-progress " : "";
  return strip({
    "@type": "VideoObject",
    "@id": `${mod.pageUrl}#video-${v.id}`,
    name: v.title || `${mod.shortTitle} – ${label}`,
    description: `${label} of ${mod.shortTitle}, a ${what}${audience(mod).kind}: ${mod.summary}`,
    thumbnailUrl: [`https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`],
    uploadDate: iso(v.uploadDate),
    duration: duration(v.duration),
    embedUrl: `https://www.youtube.com/embed/${v.id}`,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    inLanguage: "en",
  });
}

export function softwareLd(site, mod, description) {
  const released = mod.releases.filter((r) => !r.prerelease);
  const latest = released[0];
  const reqs = [audience(mod).kind.replace(/ module$/, "").replace(/^.* for /, ""),
    ...(mod.requires || []).map((r) => moduleLabel(r.id))];
  const videos = ["demo", "tutorial"].map((k) => mod.videos[k]).filter((v) => v?.uploadDate);
  return strip({
    "@type": "SoftwareApplication",
    "@id": `${mod.pageUrl}#app`,
    name: mod.shortTitle,
    alternateName: mod.title !== mod.shortTitle ? mod.title : undefined,
    description,
    url: mod.pageUrl,
    image: mod.ogImage,
    applicationCategory: "GameApplication",
    applicationSubCategory: mod.kind,
    operatingSystem: mod.operatingSystem || (mod.isModule === false ? "Linux, Windows" : `Foundry VTT v${audience(mod).version}`),
    softwareRequirements: mod.isModule === false ? undefined : reqs.join(", "),
    softwareVersion: latest?.version,
    datePublished: iso(released.at(-1)?.date),
    dateModified: iso(latest?.date),
    downloadUrl: mod.installable ? mod.manifest : latest ? `${mod.url}/releases/latest` : undefined,
    installUrl: mod.installable ? mod.manifest : undefined,
    releaseNotes: latest?.url,
    license: mod.license ? `https://spdx.org/licenses/${mod.license}.html` : undefined,
    sameAs: mod.notPublic ? undefined : [mod.url, mod.foundryPackage].filter(Boolean),
    creativeWorkStatus: mod.wip ? "Work in progress" : undefined,
    isAccessibleForFree: true,
    author: { "@id": `${site}#person` },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    video: videos.length ? videos.map((v) => ({ "@id": `${mod.pageUrl}#video-${v.id}` })) : undefined,
  });
}

export function docsLd(site, mod, page, url, description) {
  return strip({
    "@type": "TechArticle",
    "@id": `${url}#article`,
    headline: page.title,
    description,
    url,
    image: mod.ogImage,
    dateModified: iso(page.updated),
    inLanguage: "en",
    author: { "@id": `${site}#person` },
    about: { "@id": `${mod.pageUrl}#app`, name: mod.shortTitle, url: mod.pageUrl }, // described on the project page
    isPartOf: { "@id": `${site}#website` },
  });
}

export function jsonLdScript(nodes) {
  const graph = nodes.filter(Boolean);
  if (!graph.length) return "";
  // "<" escaped so text can never close the script element
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

// ---------- sitemap ----------
export function sitemapXml(entries) {
  const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${x(e.url)}</loc>${e.lastmod ? `<lastmod>${x(new Date(e.lastmod).toISOString())}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
}
