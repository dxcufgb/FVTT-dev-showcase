# Dxcufgb's Workshop

The GitHub Pages site for my Foundry VTT modules: the latest releases with their changelogs, a page with every module, and one page per module with its demo and tutorial video.

The site builds itself. A GitHub Action reads my public repos, releases and the YouTube playlist, renders static HTML and deploys it. It runs on every push, every 6 hours, and from the **Run workflow** button.

## First-time setup

1. Create a repo for the site. Name it `dxcufgb.github.io` to get `https://dxcufgb.github.io/`, or any other name to get `https://dxcufgb.github.io/<name>/`. Both work.
2. Push these files to its `main` branch.
3. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Open **Actions → Build and deploy site → Run workflow** once. The site is live when it finishes.

## Adding a new module

Nothing to do. Any public repo of mine with a `module.json` at the root of its default branch is a module. Publish a release and it appears on the next build (within 6 hours, or straight away with **Run workflow**).

What the site uses from the module repo:

| Shown on the site | Comes from |
| --- | --- |
| Title, summary, version, Foundry versions, requires / works with | `module.json` of the latest release (falls back to the default branch) |
| Downloads | Download count of every `.zip` asset across all releases |
| Changelog | The matching `## 1.2.3` section in `CHANGELOG.md`, otherwise the GitHub release notes |
| Module page text | `README.md`, without its title, badges and the sections listed in `stripReadmeSections` |
| Videos | The YouTube playlist (see below) |

The title prefix `Dxcufgb's` is dropped and the rest is title-cased, so `Dxcufgb's lively tokens` shows as **Lively Tokens**. Page URLs drop the `dxcufgbs-` id prefix: `/projects/lively-tokens/`.

## Optional extras per module

All optional. `<slug>` is the module id without `dxcufgbs-`, for example `lively-tokens`.

- **Card image:** add `assets/modules/<slug>.webp` (or `.png`, `.jpg`, `.gif`), 16:9. Without one, the card uses the YouTube video thumbnail, and without a video a drawn sigil.
- **Page text:** add `content/<slug>.md` to replace the README on the module page.
- **Settings:** add an entry under `projects` in `site.config.json`, keyed by the repo name:

```json
"projects": {
  "FoundryVTT-lively-tokens": {
    "title": "Lively Tokens",
    "summary": "Cinematic animated rings around tokens.",
    "image": "https://example.com/banner.webp",
    "videos": {
      "demo": "https://youtu.be/VIDEO_ID",
      "tutorial": "VIDEO_ID",
      "more": ["https://www.youtube.com/watch?v=VIDEO_ID", { "id": "VIDEO_ID", "title": "Making a custom ring" }]
    },
    "wip": false,
    "stripReadmeSections": ["API"],
    "hidden": false
  }
}
```

To hide a repo that has a `module.json` but should not be listed, add its name to `exclude`, or set `"hidden": true`.

## Listing a project that is not a Foundry module

Bots, servers and other tools have no `module.json`, so they are only listed when `site.config.json` includes them:

```json
"FoundryVTT-discord-integration": { "include": true, "kind": "Discord bot", "title": "Discord Integration" }
```

- `kind` is shown on the card and the page instead of the Foundry version, for example *Discord bot* or *Server tool*.
- Version, changelog, downloads and page text come from the repo like for a module (GitHub releases, `CHANGELOG.md`, `README.md`). The README keeps its install section, since these pages have no Foundry install box.
- `details` adds lines to the page's info box, for example `"details": { "Hosting": "Self-hosted Foundry only" }`.

**A repo that is still private** can be listed too. The site can't read it, so it shows what the config and `content/<slug>.md` give it: `title`, `description` (card text and page summary), `kind`, `wip` and `details`, with "Not released yet" and no GitHub links. When the repo goes public, its releases and README show up on the next build. Delete `content/<slug>.md` at that point if the README should replace your page text.

## Marking a module as work in progress

A WIP badge shows on the module's card, its entries in the latest releases, and its page, where it comes with a note that the module may be very buggy and a link to report bugs. Turn it on in either of two ways:

- **On GitHub, no site change:** add the topic `wip` to the module repo (the gear next to **About** on the repo page). Remove the topic to turn it off. The badge follows on the next build.
- **In `site.config.json`:**

```json
"FoundryVTT-session-summary": { "wip": true }
```

Write a sentence instead of `true` to replace the default note, for example `"wip": "The Discord export format is still changing."`. `"wip": false` hides the badge even when the repo has the `wip` topic.

## Videos

The top of each module page has a **Demo** and a **Tutorial** tab. Both always show; a tab without a video says the video is not out yet and links to the playlist. A **More** tab appears only when you list videos under `more`, with a strip to pick between them.

A video is linked automatically when its YouTube title contains the module's short title (for example "Lively Tokens"). Titles with words like *tutorial*, *instructions*, *how to* or *guide* go to **Tutorial**, the rest to **Demo**. Videos set under `videos` in `site.config.json` always win. Use a video id or any YouTube link (`youtu.be/…`, `watch?v=…`, `shorts/…`).

You can link straight to a tab, for example from a YouTube description: `…/projects/lively-tokens/#tutorial` (also `#demo` and `#more`).

Without an API key the site reads the playlist's RSS feed, which only lists the 15 newest videos. To see all of them, add a free YouTube Data API key as the repo secret `YOUTUBE_API_KEY` (Google Cloud Console → enable *YouTube Data API v3* → create an API key). You can always set a video in `site.config.json` instead.

## Promote the site

`assets/img/workshop-badge.png` is a badge for module READMEs. It is 1280×264 pixels, made to show at 640 pixels wide. Paste this into a README:

```html
<a href="https://dxcufgb.github.io/FVTT-dev-showcase/"><img src="https://dxcufgb.github.io/FVTT-dev-showcase/assets/img/workshop-badge.png" alt="Dxcufgb's Workshop: every Foundry VTT module, video and changelog in one place" width="640"></a>
```

YouTube descriptions can't show images, so use a text line there:

```
🎲 All my Foundry VTT modules, videos and changelogs: https://dxcufgb.github.io/FVTT-dev-showcase/
```

## Rebuild right after a release (optional)

The 6-hour schedule is usually enough. For an instant update, add a step at the end of a module's release workflow. It needs a fine-grained token with **Contents: read and write** on the site repo, saved as the secret `SITE_DISPATCH_TOKEN` in the module repo:

```yaml
- name: Refresh the module site
  run: gh api repos/dxcufgb/dxcufgb.github.io/dispatches -f event_type=module-released
  env:
    GH_TOKEN: ${{ secrets.SITE_DISPATCH_TOKEN }}
```

## Site settings

`site.config.json`:

| Key | What it does |
| --- | --- |
| `owner` | GitHub account whose repos are listed |
| `siteTitle`, `tagline` | Header and home page text |
| `kofi` | Ko-fi link on every module page and in the footer |
| `youtubePlaylist` | Playlist id for the videos |
| `latestReleaseCount` | How many releases the home page lists (10) |
| `titlePrefix`, `slugPrefix`, `titleCase` | How titles and URLs are shortened |
| `stripReadmeSections` | README `##` sections left off every module page (the page has its own install box) |
| `exclude` | Repo names never listed |

## Run it locally

Needs Node 20 or newer.

```sh
npm install
npm start          # fetches data, builds, serves _site on http://localhost:3000
```

Without a token GitHub allows 60 requests an hour, which covers a few local builds. Set `GH_TOKEN` to go past that.

## Files

```
site.config.json          settings and per-module overrides
scripts/fetch-data.mjs    GitHub + YouTube → data/site-data.json
scripts/build.mjs         data → _site/ (HTML pages)
assets/css/site.css       the theme
assets/js/site.js         video player, tabs, copy button, search and sort
assets/modules/           optional card images
content/                  optional page text
.github/workflows/        build and deploy
```
