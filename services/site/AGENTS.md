# opencode.ai site

Read the design-system rules in `DESIGN.md` (also shown at `/dev/components#rules`) before you change UI or copy.

## Public pages

- When you add, remove or rename a public page, keep `/sitemap.xml`, `llms.txt`, search and the page's `.md` version in sync; run the sitemap test (`bun test test/sitemap.test.ts` from this directory).
- `/sitemap.xml` is the only sitemap in `robots.txt`. It is an index of `sitemapFiles` in `src/lib/sitemap.ts`: this app's `/sitemap-pages.xml`, the V2 docs sitemap `/v2/sitemap.xml`, and the Data and Console sitemaps.
- `/sitemap-pages.xml` (`src/routes/sitemap-pages.xml.ts`) lists every page route automatically. To leave a page out, add it to `sitemapExclusions` in `src/lib/sitemap.ts` with a reason. A route with parameters needs an entry in `dynamicRoutes` there, or an exclusion.
- Do not add a static `public/sitemap.xml`, because it would hide the generated one.
- The view-source comment's FOR HUMANS rows start with the main nav in the same order; they're generated from the nav data, so update the nav, not the comment.

## Copy

- Do not use colons in site copy (headings, leads, body text, buttons, captions, alt text). Rewrite the sentence instead, for example "The easiest way to start is to download OpenCode", not "The easiest way to start: download OpenCode". Colons in code, commands, URLs, times and data labels (such as "HEX") are fine.
- Write statements, not rhetorical questions. Use "For more, bring your own subscription", not "Want more? Bring your own subscription". Real questions are fine where the reader is asking them, such as FAQ entries.

## UI states

- A button that opens a menu, popover, dropdown, sheet or dialog sets `aria-expanded="true"` while it is open and is styled from that attribute, not hover: filled and split buttons fill with the link blue (like the product cards' split chevron), neutral buttons keep their pressed grey, and text or nav triggers take the current-item colour with the chevron flipped; Escape closes and returns focus to the trigger.

## Boundaries

- This service is the website and the V2 docs, deployed as its own Worker with `cf` (`cloudflare.config.ts`, `script/build.ts`). Never add Wrangler or SST here.
- The V2 docs at `/v2` are a self-contained feature in `src/docs/` (read `src/docs/AGENTS.md`). They render their own pages with their own styles and script, never the site's, and the site's styles and scripts never load on them.
- Old URLs kept for outside links live in `src/lib/legacy.ts`, each commented with why it exists and who still uses it; nothing may link to them. Short links (`/discord`, `/feishu`, `/desktop-feedback`) are ordinary routes.
- The site also serves fixed-URL machine files: `/config.json` and `/openapi.json` (written by `bun run generate`), `/tui.json` (`public/`), and `/oauth/opencode/client.json` and `/.well-known/apple-app-site-association` (`src/lib/meta.ts`). Their bytes and headers are a contract with clients.
- Heavy media (video, audio, zips, 3D models) is never a Worker asset: link it with `mediaUrl()` (`src/lib/media.ts`), which points into the files bucket behind `/files`.
- The Worker holds no GitHub token (see README.md).
