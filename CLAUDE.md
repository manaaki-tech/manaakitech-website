# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# Behavioral guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with the project-specific instructions further below as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

This is a static site with **no automated test suite**, so "verify" here means *run the site locally and look at it in the browser* — not writing tests. Transform tasks into verifiable goals:
- "Fix the layout on mobile" → "Preview locally, resize the browser, confirm it looks right"
- "Update the contact text" → "Preview locally, confirm the new text shows on every page that uses that component"
- "Change the brand colour" → "Preview locally, confirm the colour changed everywhere it should"

The verification loop for this project:
```
1. Make the edit        → verify: the file changed is the right one (component vs page)
2. py test_server.py → verify: open the browser, the change looks correct
3. Check affected pages  → verify: shared components changed everywhere they appear
4. Commit on dev, push, open PR → verify: PR's Netlify deploy preview looks right; a human merges to go live
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project: Manaaki Tech

Static marketing website for a whanau-centred case management platform and consultancy, served as plain HTML/CSS/JS via Netlify. No build step, no npm.

## Audience note

Edits here are often driven by a non-technical site owner via natural-language requests. Handle the git and local-server mechanics on their behalf, describe changes in plain terms, and always preview before publishing.

## Local Preview

```
py test_server.py
```

Opens `http://localhost:8000` automatically. To use a different port: `py test_server.py 3000`.

> Windows note: use `py` (the Python launcher), not `python`. On this machine a bare `python` can resolve to the Microsoft Store alias stub, which silently fails to start the server. `py` always works.

**You must use this server — never open .html files directly in a browser.** The component system uses `fetch()` to load shared page chunks, and browsers block `fetch()` on the `file://` protocol. If components look missing or the page is blank, this is almost always the cause.

## Branch discipline (important)

**Only ever work on the `dev` branch. Never commit to, push to, or merge into `main`.**

`main` is production — anything merged into it deploys straight to the live public site. Promotion to `main` happens **only** through a human-reviewed pull request; you never do it yourself.

- All edits and commits go on `dev`. This is the default working branch.
- If you ever find yourself on `main`, switch back before editing: `git switch dev`.
- When asked to "publish" / "make it live" / "push it", follow the Publish steps below — push `dev` and open (or update) a PR into `main`, then **stop and hand off to a human**. Do not merge the PR.

## Publish / Deploy

The live site auto-deploys from `main` on Netlify, but you must never push `main` directly. To publish a change:

1. Make sure you're on `dev`: `git switch dev`
2. Commit the change: `git add <files> && git commit -m "describe the change"`
3. Push `dev`: `git push origin dev`
4. Open (or update) a pull request from `dev` into `main`, then **STOP**:
   - Preferred: `gh pr create --base main --head dev --fill` — or if a PR is already open, just push (step 3) and it updates automatically; `gh pr view --web` shows it.
   - Fallback (if `gh` isn't logged in): open https://github.com/manaaki-tech/manaakitech-website/compare/main...dev and click *Create pull request*.

Note: this machine has a `pre-push` hook that refuses direct pushes to `main`, so publishing must go through a PR. Do not try to work around it.

A human then reviews the diff and the Netlify **deploy preview** (Netlify builds a live preview URL for the open PR) and merges when happy. Merging `main` triggers the production deploy (~1–2 min). Live site: `https://manaakitech.com` (also `https://bejewelled-gecko-85feaf.netlify.app`). There is no build step — `netlify.toml` just sets `publish = "."`.

## Architecture

### Component system

Shared page sections live in `components/*.html` and are injected at page load by `js/componentLoader.js`. A page requests a component with a placeholder div:

```html
<div id="header-component" data-component="header"></div>
```

`componentLoader.js` fetches `components/<name>.html` and sets `innerHTML`. It loads in priority order (`header` → `hero` → `features` → `benefits` → `contact` → `footer`), keeping a loading overlay up until the critical components (`header` and `hero`) are ready.

**Consequence for editing:** to change anything in the nav, footer, hero, features, benefits, or contact section across all pages, edit the component file once — do not edit individual pages.

### Which pages use which components

| Page | Components |
|---|---|
| `index.html` | header, footer (hero/features/benefits/contact are inline on this page) |
| `product.html` | header, hero, features, benefits, contact, footer |
| `services.html` | header, footer |
| `support.html` | header, footer |
| `privacy-policy.html` | header, footer |
| `thank-you.html`, `tile-generator.html` | (standalone, no components) |

`components/header-support.html` exists but is not currently wired to any page. `components/pricing.html` exists but is commented out in the loader priority map.

### Styling and theme

- **Tailwind CSS** is loaded via CDN (`cdn.tailwindcss.com`). No build step.
- **Brand color palette** (warm terracotta/earth tones, `primary-50` through `primary-900`) is defined in `js/tailwind-config.js`. To change brand colors globally, edit only that file — every page loads it.
- **Global custom CSS** is in `css/styles.css`. Some page-specific styles live in `<style>` blocks in the page `<head>`.
- **Alpine.js** (CDN) handles interactive UI behaviour (dropdowns, toggles, etc.).
- `js/lazy-load.js` handles image lazy loading; `js/main.js` covers general interactivity. Both run after components fire the `componentsLoaded` event.

## Editing guidance

- **Navigation or footer change?** Edit `components/header.html` or `components/footer.html` — one edit updates every page.
- **Hero / features / benefits / contact section?** Edit the matching file in `components/`.
- **Page-specific content** (e.g. the body of `services.html`, `support.html`) is inline in that page's `.html` file.
- **SEO metadata** (`<title>`, `<meta description>`, canonical URL) is in the `<head>` of each individual page file.
- **Brand colors** → `js/tailwind-config.js` only.
- After any edit, preview with `py test_server.py`, then commit on `dev`, push, and open a PR into `main` (see Publish / Deploy). Never push `main`.
