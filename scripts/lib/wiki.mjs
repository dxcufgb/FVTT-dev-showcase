// Turns a cloned GitHub wiki (pages from fetch-data.mjs) into the docs mirror:
// page order and groups from _Sidebar.md, a title and opening sentence per page,
// and which pages describe features (for the Features list on the project page).

export const docSlug = (name) => (/^home$/i.test(name) ? "" : name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""));

// Reference pages, not features. Matched against the page name.
const REFERENCE = /^(home|installation|settings|api|credits|troubleshooting|faq|changelog|releasing|development|contributing)$/i;
// Sidebar groups that hold reference material ("For module authors", "About", "Help").
const REFERENCE_GROUP = /author|about|help|develop|maintain|credit/i;

// Plain text of the page's opening paragraphs and list items, up to about max characters.
// Code (fenced blocks, and inline code that is not a plain word) is left out.
export function leadText(md = "", max = 400) {
  const prose = leadParts(md, max, false);
  return prose.join(" ").length >= 100 ? prose.join(" ") : leadParts(md, max, true).join(" ");
}
function leadParts(md, max, lists) {
  const parts = [];
  let len = 0;
  const prose = md.replace(/\r/g, "").replace(/```[\s\S]*?```/g, "").replace(/`([^`]*)`/g, (_, c) => (/[(){};=]/.test(c) || c.length > 30 ? "" : c));
  for (const block of prose.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l && !/^(#|\||>|<|!\[|---)/.test(l) && !/[{}=]|\(\)|;\s*$/.test(l));
    // a paragraph's lines (and a list item's wrapped lines) belong together
    const units = [];
    for (const l of lines) {
      const isItem = /^([-*+]|\d+\.)\s+/.test(l);
      if (isItem || !units.length) units.push({ isItem, text: l.replace(/^([-*+]|\d+\.)\s+/, "") });
      else units.at(-1).text += ` ${l}`;
    }
    for (const { isItem, text } of units) {
      if (isItem && !lists) continue;
      if (/^(see|read)\b/i.test(text)) continue; // pointers to other pages say nothing about this one
      const t = inlineText(text);
      // a line ending in ":" introduces a list or code (": ." once its code is gone)
      if (!t || t.length < 3 || /:\s*\.?$/.test(t)) continue;
      const sentence = /[.!?]$/.test(t) ? t : `${t}.`;
      parts.push(sentence);
      len += sentence.length + 1;
      if (len >= max) return parts;
    }
  }
  return parts;
}

// The text of the first real paragraph, as plain text.
export function firstText(md = "") {
  for (const block of md.replace(/\r/g, "").replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/)) {
    const t = inlineText(block.split("\n").map((l) => l.trim()).filter((l) => l && !/^(#|\||[-*+] |\d+\. |>|<|!\[|\[!\[|---)/.test(l)).join(" "));
    if ((t.match(/[A-Za-z]/g) || []).length >= 20) return t;
  }
  return "";
}

function inlineText(s) {
  const text = s
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/(?<!\w)_+|_+(?!\w)/g, "") // _emphasis_, but FOUNDRY_URL keeps its underscore
    .replace(/\s+/g, " ")
    .trim();
  return text;
}
export const firstSentence = (text) => (text.match(/^.*?[.!?](?=\s|$)/) || [text])[0];

const titleFromMd = (md) => /^#\s+(.+)$/m.exec(md || "")?.[1]?.trim();
const titleFromName = (name) => name.replace(/-/g, " ");

// pages: [{ name, md, updated }] → { pages: [...ordered, with title/slug/group], groups: [{label, pages}] }
export function buildDocs(rawPages) {
  if (!rawPages?.length) return null;
  const byName = new Map(rawPages.filter((p) => !p.name.startsWith("_")).map((p) => [p.name.toLowerCase(), p]));
  if (!byName.size) return null;
  const sidebar = rawPages.find((p) => p.name === "_Sidebar")?.md || "";

  const groups = [];
  const labels = new Map();
  let group = { label: "", pages: [] };
  for (const raw of sidebar.split("\n")) {
    const l = raw.trim();
    const heading = /^\*\*([^[*][^*]*)\*\*$/.exec(l) || /^#{2,4}\s+(.+)$/.exec(l);
    if (heading) {
      if (group.pages.length || group.label) groups.push(group);
      group = { label: heading[1].trim(), pages: [] };
      continue;
    }
    const link = /\[([^\]]+)\]\(([^)#]+)(#[^)]*)?\)/.exec(l) || /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(l);
    if (!link) continue;
    const target = link[0].startsWith("[[") ? link[1] : link[2];
    const label = link[0].startsWith("[[") ? link[2] || link[1] : link[1];
    if (/^https?:/i.test(target)) continue; // "Report a bug" and other outside links
    const name = decodeURIComponent(target).replace(/\.md$/i, "").replace(/\s+/g, "-").toLowerCase();
    if (!byName.has(name)) continue;
    labels.set(name, label.trim());
    if (name !== "home") group.pages.push(name);
  }
  if (group.pages.length) groups.push(group);

  const listed = new Set(groups.flatMap((g) => g.pages));
  const rest = [...byName.keys()].filter((n) => n !== "home" && !listed.has(n)).sort();
  if (rest.length) groups.push({ label: groups.length ? "More" : "", pages: rest });

  const pageOf = (key, groupLabel) => {
    const p = byName.get(key);
    const title = labels.get(key) && !/^home$/i.test(key) ? labels.get(key) : titleFromMd(p.md) || titleFromName(p.name);
    const text = firstText(p.md);
    const lead = leadText(p.md);
    return {
      lead,
      name: p.name,
      slug: docSlug(p.name),
      title: /^home$/i.test(key) ? "Overview" : title,
      md: p.md,
      updated: p.updated,
      text,
      group: groupLabel,
      feature: !/^home$/i.test(key) && !REFERENCE.test(p.name) && !REFERENCE_GROUP.test(groupLabel || ""),
    };
  };
  const pages = [];
  if (byName.has("home")) pages.push(pageOf("home", ""));
  const outGroups = groups.map((g) => ({ label: g.label, pages: g.pages.map((k) => { const pg = pageOf(k, g.label); pages.push(pg); return pg; }) }));
  return { pages, groups: outGroups, home: pages.find((p) => p.slug === "") || null };
}
