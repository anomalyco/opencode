# opencode.ai site

Read the design-system rules in `DESIGN.md` (also shown at `/dev/components#rules`) before you change UI or copy.

## Public pages

- When you add, remove or rename a public page, keep `/sitemap.xml`, `llms.txt`, search and the page's `.md` version in sync; run the sitemap test (`bun test test/sitemap.test.ts` from this directory).
- `/sitemap.xml` is the only sitemap in `robots.txt`. It is an index of `sitemapFiles` in `src/lib/sitemap.ts`: this app's `/sitemap-pages.xml`, the V2 docs sitemap `/docs/sitemap.xml`, and the Data and Console sitemaps.
- `/sitemap-pages.xml` (`src/routes/sitemap-pages.xml.ts`) lists every page route automatically. To leave a page out, add it to `sitemapExclusions` in `src/lib/sitemap.ts` with a reason. A route with parameters needs an entry in `dynamicRoutes` there, or an exclusion.
- Do not add a static `public/sitemap.xml`, because it would hide the generated one.
- The view-source comment's FOR HUMANS rows start with the main nav in the same order; they're generated from the nav data, so update the nav, not the comment.

## Copy

- Do not use colons in site copy (headings, leads, body text, buttons, captions, alt text). Rewrite the sentence instead, for example "The easiest way to start is to download OpenCode", not "The easiest way to start: download OpenCode". Colons in code, commands, URLs, times and data labels (such as "HEX") are fine.
- Write statements, not rhetorical questions. Use "For more, bring your own subscription", not "Want more? Bring your own subscription". Real questions are fine where the reader is asking them, such as FAQ entries.

## UI states

- A button that opens a menu, popover, dropdown, sheet or dialog sets `aria-expanded="true"` while it is open and is styled from that attribute, not hover: filled and split buttons fill with the link blue (like the product cards' split chevron), neutral buttons keep their pressed grey, and text or nav triggers take the current-item colour with the chevron flipped; Escape closes and returns focus to the trigger.

## Static pages

- Production hydrates no page. The pages in `staticPaths` (`src/static/routes.ts`: home, the product pages, legal, Brand, Press, the changelog, Browse and the font page) render as plain HTML from the same components, without hydration (`src/static/render.tsx`), and so does the not-found page, for every address no route answers. They load one small script, `src/client/entry.ts`, which reads the markup the components render and loads each island in `src/client/islands/` only when the page has it. The app's browser build only provides the stylesheets.
- Between the home page, /product and the product pages, a card grows into its product's hero and back with a cross-document view transition (`card-morph.ts`); every other page change is a plain page load.
- Behaviour both renderings need lives in framework-free modules in `src/component/site/` that the component and the script both call, such as `contents-spy.ts`, `changelog-motion.ts`, `tooltips.ts`, `site-frame.ts`, `theme-switch.ts` and `sheet-motion.ts`. Put new behaviour there. Where a component renders its state from signals and the script keeps its own copy, each names the other in a comment: change both.
- `vite dev` renders these pages hydrated, because Design mode and Settings need the app, so a change that only works hydrated looks right there. Check them in a production build served by `perf/serve.ts`: `bun run build`, then `bun perf/serve.ts --port 4300`, and open the page on that port.
- A new page route needs its path in `staticPaths`, or production answers it with the not-found page (`test/static-routes.test.ts` lists the ones that may be missing: the development tools).

## Funnel

- Every page and the docs report to the Console's funnel through `src/lib/funnel.ts`: `entry-client.tsx`, the static pages' `src/client/entry.ts` and `src/docs/client.ts` start it, and it loads the Console's tracker (`/console/funnel/v1.js`) with `src/lib/funnel-config.ts` once the visitor first presses a key or the pointer, or the page is idle. Keep the stub free of imports, and imported only by those entry scripts, so it stays in each one's first file and the config and the tracker stay out of every page's first JavaScript.
- The tracker reads the markup: `data-section` names a part of a page (`section.viewed`, and every click's section), `data-funnel` names a control, `data-funnel-copy` (with `data-funnel-method`) marks what a copy button or a selection inside copies, `data-funnel-surface` names a page's surface (the 404 page), and `data-funnel="ignore"` leaves a control out. Give a new page a surface in `surfaceOf` (`test/funnel.test.ts` fails until you do) and its main parts a `data-section`.
- `data-section` names, `data-funnel` slugs and surfaces are analytics keys: rename one only together with the reports that read it.
- Never send what a visitor typed. Code that reports its own events (search, the Markdown shortcut) pushes them onto `window.__ocFunnel` (`Funnel.track` in the docs), with counts and lengths, never text.

## Boundaries

- This service is the website and the V2 docs, deployed as its own Worker with `cf` (`cloudflare.config.ts`, `script/build.ts`). Never add Wrangler or SST here.
- The V2 docs at `/docs` and the V1 docs at `/v1/docs` are a self-contained feature in `src/docs/` (read `src/docs/AGENTS.md`). They prerender their pages with the site's components and build the site's stylesheets into their own files under `/docs/_build`, so a docs page never loads the site's built files and a site page never loads the docs'. A `/docs` URL without a V2 page redirects to the same path on the V1 docs.
- Old URLs kept for outside links live in `src/lib/legacy.ts`, each commented with why it exists and who still uses it; nothing may link to them. Short links (`/discord`, `/feishu`, `/desktop-feedback`) are ordinary routes.
- The site also serves fixed-URL machine files: `/config.json` and `/openapi.json` (written by `bun run generate`), `/tui.json` (`public/`), the V2 install script `/v2/install` and config schema `/v2/cli.json` (both stay at `/v2`), and `/oauth/opencode/client.json` and `/.well-known/apple-app-site-association` (`src/lib/meta.ts`). Their bytes and headers are a contract with clients.
- Heavy media (video, audio, zips, 3D models) is never a Worker asset: link it with `mediaUrl()` (`src/lib/media.ts`), which points into the files bucket behind `/files`.
- The Worker holds no GitHub token (see README.md).
