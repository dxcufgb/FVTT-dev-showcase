// Small enhancements; every page works without this file.

// YouTube thumbnails: maxresdefault does not exist for every video.
document.querySelectorAll("img[data-fallback]").forEach((img) => {
  const swap = () => {
    if (img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
    else img.style.visibility = "hidden"; // both thumbnails missing: no broken-image icon
  };
  img.addEventListener("error", swap);
  // YouTube answers a missing maxres with a 120x90 placeholder instead of an error
  const check = () => { if (img.naturalWidth && img.naturalWidth <= 120) swap(); };
  img.complete ? check() : img.addEventListener("load", check);
});

// Lite YouTube player: the iframe only loads when someone presses play.
function embed(player, id) {
  const f = document.createElement("iframe");
  f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  f.title = "YouTube video player";
  f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
  f.allowFullscreen = true;
  player.dataset.video = id;
  player.replaceChildren(f);
}
document.addEventListener("click", (e) => {
  const play = e.target.closest(".player .play");
  if (play) { const p = play.closest(".player"); embed(p, p.dataset.video); return; }

  // More tab: pick a video from the strip
  const item = e.target.closest(".reel-item");
  if (item) {
    const panel = item.closest(".video-panel");
    panel.querySelectorAll(".reel-item").forEach((b) => b.setAttribute("aria-pressed", b === item));
    embed(panel.querySelector(".player"), item.dataset.video);
  }
});

// Demo / Tutorial / More tabs. Switching slides the videos sideways, in the
// direction of the tab you picked. A link ending in #demo, #tutorial or #more
// opens that tab.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
document.querySelectorAll(".video-tabs").forEach((list) => {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const stage = list.closest(".videos").querySelector(".video-stage");
  const panelOf = (t) => document.getElementById(t.getAttribute("aria-controls"));
  let settle = null; // finishes a slide that is still running

  const select = (tab, animate = true) => {
    const current = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    if (tab === current) return;
    if (settle) settle();

    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
    });
    const from = panelOf(current), to = panelOf(tab);
    const f = from.querySelector("iframe"); // stop a playing video
    if (f) f.src = f.src.replace("autoplay=1", "autoplay=0");

    if (!animate || reduceMotion.matches || !to.animate) {
      from.hidden = true; to.hidden = false;
      return;
    }
    const dir = tabs.indexOf(tab) > tabs.indexOf(current) ? 1 : -1;
    const h0 = stage.offsetHeight;
    from.classList.add("is-leaving"); // taken out of the flow, so the stage takes the new panel's height
    to.hidden = false;
    const h1 = stage.offsetHeight;
    const timing = { duration: 450, easing: "cubic-bezier(.22, .8, .24, 1)" };
    const anims = [
      from.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-100 * dir}%)` }], timing),
      to.animate([{ transform: `translateX(${100 * dir}%)` }, { transform: "translateX(0)" }], timing),
      ...(h0 !== h1 ? [stage.animate([{ height: `${h0}px` }, { height: `${h1}px` }], timing)] : []),
    ];
    settle = () => {
      anims.forEach((a) => a.cancel());
      from.hidden = true;
      from.classList.remove("is-leaving");
      settle = null;
    };
    anims[1].onfinish = () => settle && settle();
  };

  tabs.forEach((t, i) => {
    t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1;
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      const next = tabs[(i + d + tabs.length) % tabs.length];
      select(next); next.focus();
    });
  });
  const fromHash = (animate) => {
    const t = tabs.find((t) => `#${t.id.replace(/^tab-/, "")}` === location.hash);
    if (t) { select(t, animate); list.closest(".videos").scrollIntoView({ block: "start" }); }
  };
  fromHash(false);
  window.addEventListener("hashchange", () => fromHash(true));
});

// Copy manifest URL
document.querySelectorAll(".copy").forEach((b) => {
  b.addEventListener("click", async () => {
    const input = document.querySelector(b.dataset.copy);
    try { await navigator.clipboard.writeText(input.value); }
    catch { input.select(); document.execCommand("copy"); }
    b.textContent = "Copied"; b.classList.add("done");
    setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1800);
  });
});

// Long release notes on the home page fold to a few lines
document.querySelectorAll("[data-clamp]").forEach((n) => {
  if (n.scrollHeight < 300) return;
  n.classList.add("is-clamped");
  const b = document.createElement("button");
  b.type = "button"; b.className = "more-toggle"; b.textContent = "Show full notes";
  b.setAttribute("aria-expanded", "false");
  b.addEventListener("click", () => {
    const open = n.classList.toggle("is-clamped") === false;
    b.textContent = open ? "Show less" : "Show full notes";
    b.setAttribute("aria-expanded", open);
  });
  n.after(b);
});

// Module grid: search and sort
const grid = document.getElementById("grid");
if (grid) {
  const toolbar = document.querySelector(".toolbar");
  const filter = document.getElementById("filter");
  const sort = document.getElementById("sort");
  const empty = document.getElementById("empty");
  const cards = [...grid.children];
  toolbar.hidden = false;
  const apply = () => {
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach((c) => { const ok = !q || c.dataset.search.includes(q); c.hidden = !ok; shown += ok; });
    empty.hidden = shown > 0;
    const by = {
      date: (a, b) => b.dataset.date.localeCompare(a.dataset.date),
      downloads: (a, b) => b.dataset.downloads - a.dataset.downloads,
      title: (a, b) => a.dataset.title.localeCompare(b.dataset.title),
    }[sort.value];
    grid.append(...cards.sort(by));
  };
  filter.addEventListener("input", apply);
  sort.addEventListener("change", apply);
}
