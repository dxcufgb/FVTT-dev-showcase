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
| Documentation | The repo's GitHub wiki, copied to `/projects/<slug>/docs/<page>/` on every build (page order and groups from `_Sidebar.md`), so search engines can find it. The Links box points at that copy (`"wiki": false` in the config leaves the wiki out) |
| Search and social previews | Generated from all of the above, see [Search engines and social previews](#search-engines-and-social-previews) |

The title prefix `Dxcufgb's` is dropped and the rest is title-cased, so `Dxcufgb's lively tokens` shows as **Lively Tokens**. Page URLs drop the `dxcufgbs-` id prefix: `/projects/lively-tokens/`.

## Optional extras per module

All optional. `<slug>` is the module id without `dxcufgbs-`, for example `lively-tokens`.

- **Card image:** add `assets/modules/<slug>.webp` (or `.png`, `.jpg`, `.gif`), 16:9. Without one, the card uses the YouTube video thumbnail, and without a video a drawn sigil.
- **Card logo:** add `assets/modules/<slug>-logo.png` (or `.svg`, `.webp`) with a transparent background. It is shown centred on the card's default dark background instead of filling the card. Set `"logo"` in the config to use another file or a link.
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
    "hidden": false,
    "seoTitle": "Lively Tokens – animated token rings for Foundry VTT",
    "seoDescription": "A 140–160 character description for search results, if the generated one doesn't fit.",
    "foundryPackage": "https://foundryvtt.com/packages/dxcufgbs-lively-tokens",
    "operatingSystem": "Foundry VTT v13"
  }
}
```

`seoTitle`, `seoDescription`, `foundryPackage` and `operatingSystem` are only needed to override what the build works out on its own.

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

Search engines show a video in their results only with its upload date. Videos found in the playlist get it automatically; for a video set in `site.config.json`, write it as an object with `uploadDate` (and optionally `title` and `duration` in seconds):

```json
"demo": { "url": "https://youtu.be/VIDEO_ID", "title": "FoundryVTT V13 Module: Lively Tokens - Demo", "uploadDate": "2026-10-25T16:14:05-07:00", "duration": 88 }
```

You can link straight to a tab, for example from a YouTube description: `…/projects/lively-tokens/#tutorial` (also `#demo` and `#more`).

Without an API key the site reads the playlist's RSS feed, which only lists the 15 newest videos. To see all of them, add a free YouTube Data API key as the repo secret `YOUTUBE_API_KEY` (Google Cloud Console → enable *YouTube Data API v3* → create an API key). You can always set a video in `site.config.json` instead.

## Promote the site

`assets/img/workshop-badge.png` is a badge for module READMEs. It is 1300×268 pixels, made to show at 650 pixels wide. Paste this into a README:

```html
<a href="https://dxcufgb.github.io/FVTT-dev-showcase/"><img src="https://dxcufgb.github.io/FVTT-dev-showcase/assets/img/workshop-badge.png" alt="Dxcufgb's Workshop: every Foundry VTT project, video and changelog in one place" width="650"></a>
```

YouTube descriptions can't show images, so use a text line there:

```
🎲 All my Foundry VTT projects, videos and changelogs: https://dxcufgb.github.io/FVTT-dev-showcase/
```

## Rebuild right after a release (optional)

The 6-hour schedule is the fallback. Every listed project's release workflow asks the site to rebuild as soon as the release is published, with a `module-released` repository dispatch (payload `repository` and `tag`). Modules get this from the shared release action in [`dxcufgb/foundry-module-ci`](https://github.com/dxcufgb/foundry-module-ci) (input `site-dispatch-token`); the Discord bot and the server tools have a `site` job at the end of their own `release.yml`.

It needs one token, saved in every project repo:

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new): **Repository access → Only select repositories → `dxcufgb/FVTT-dev-showcase`**, **Repository permissions → Contents: Read and write** (what a repository dispatch needs), nothing else.
2. Save it as the secret `SITE_DISPATCH_TOKEN` in each project repo, for example with `gh secret set SITE_DISPATCH_TOKEN -R dxcufgb/<repo>` (it reads the value from the prompt).

A repo without the secret releases exactly as before and appears at the next scheduled build. An expired token only shows up as a warning on the release run.

A new project picks this up from the same template; a release workflow of its own can send the ping like this:

```yaml
- name: Ask the Workshop site to rebuild
  run: gh api --method POST repos/dxcufgb/FVTT-dev-showcase/dispatches -f event_type=module-released
  env:
    GH_TOKEN: ${{ secrets.SITE_DISPATCH_TOKEN }}
```

## Search engines and social previews

Everything below is generated from the project data on every build, so a new module gets it without any work:

- **Titles and descriptions:** a title of at most 60 characters (`Dice Trails – Foundry VTT module for Dice So Nice`) and a description of 140–160 characters from the module's own description, saying it is a free Foundry VTT v13 module, which system or module it is for, and that it is a work in progress when it is one. The build warns about a title or description that is too long or used twice.
- **Social previews:** Open Graph and Twitter tags on every page, with a 1200×630 image per project in `og/<slug>.png`. `scripts/og-images.mjs` draws it after the build: `assets/modules/<slug>.webp` if there is one, otherwise the demo video's thumbnail, each with a name banner; without either, a title card with the project's logo. Pages without a project image use `assets/img/og-default.png`.
- **Structured data (JSON-LD):** WebSite and Person (with GitHub, Ko-fi and YouTube) on the home page, SoftwareApplication (version, manifest, price 0, *Work in progress* for WIP projects) and VideoObject on project pages, TechArticle on docs pages, and breadcrumbs.
- **Crawling:** `sitemap.xml` with every page (last change = the latest release, or the wiki page's last edit), `robots.txt`, a `404.html` that search engines don't index, canonical links, and the docs copy of each wiki.

Search engines only read `robots.txt` at the root of a domain. The repo [`dxcufgb/dxcufgb.github.io`](https://github.com/dxcufgb/dxcufgb.github.io) holds that file and points at this site's sitemap.

### Search Console and Bing verification

1. In [Google Search Console](https://search.google.com/search-console), add a **URL prefix** property for `https://dxcufgb.github.io/FVTT-dev-showcase/`, pick **HTML tag** and copy the `content` value of the meta tag it shows.
2. In [Bing Webmaster Tools](https://www.bing.com/webmasters), add the same URL, pick **HTML Meta Tag** and copy its `content` value.
3. Paste both into `site.config.json` and push:

```json
"verification": { "google": "the-google-code", "bing": "the-bing-code" }
```

4. Press **Verify** in both, then submit `https://dxcufgb.github.io/FVTT-dev-showcase/sitemap.xml` under **Sitemaps**.

An empty code adds no tag.

## Site settings

`site.config.json`:

| Key | What it does |
| --- | --- |
| `owner` | GitHub account whose repos are listed |
| `siteTitle`, `tagline` | Header and home page text |
| `kofi` | Ko-fi link on every module page and in the footer |
| `youtubePlaylist` | Playlist id for the videos |
| `youtubeChannel` | Channel link, for the Person data on the home page |
| `siteUrl` | The site's address, for canonical links, the sitemap and social previews (in Actions it comes from the Pages settings) |
| `verification` | Google Search Console and Bing verification codes |
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

The social images need Chrome: the installed Google Chrome, or set `CHROME_PATH` to another Chromium. Without one, every project gets a copy of `og-default.png`. `node scripts/og-images.mjs --assets` also redraws `og-default.png` and `favicon-192.png`.

`npm test` builds a made-up module into a temp folder and checks that it gets its title, description, social image, JSON-LD, sitemap entry and docs on its own.

## Files

```
site.config.json          settings and per-module overrides
scripts/fetch-data.mjs    GitHub + YouTube → data/site-data.json
scripts/build.mjs         data → _site/ (HTML pages, docs, sitemap, robots.txt)
scripts/lib/seo.mjs       titles, descriptions, JSON-LD, sitemap
scripts/lib/wiki.mjs      wiki pages → docs pages
scripts/og-images.mjs     social preview images (after the build)
test/                     npm test
assets/css/site.css       the theme
assets/js/site.js         video player, tabs, copy button, search and sort
assets/modules/           optional card images and logos
assets/img/               favicon, og-default.png, workshop badge
content/                  optional page text
.github/workflows/        build and deploy
```
