# Documentation feature guide

## Structure

- This folder is the V2 docs at `/docs` on the site: content, components, styles, build and serving. Keep docs code here; the site's shared files only plug it in (`vite.config.ts`, `src/middleware.ts`, `script/build.ts`, `cloudflare.config.ts`).
- Content lives in `content/` as MDX. A file's path is its URL: `content/cli/keybinds.mdx` is `/docs/cli/keybinds/`. Other repositories read some of these files by path, so don't move them without checking.
- `lib/navigation.ts` is the source of truth for header sections and sidebar ordering.
- `frontmatter.ts` is the frontmatter schema; a page that doesn't match it fails the build.
- `config.ts` holds the mount path (`/docs/`) and the names of the docs' own files beside the pages (`files`: `_build`, `assets`, `pagefind`, `llms.txt`, …), which no page may use. Build URLs from it (`docsHref`), never from the site's base. MDX reads it as `import.meta.env.BASE_URL`.
- Keep internal Markdown links docs-root-relative, for example `/config`; `remark-links.ts` adds `/docs`.
- Components used in MDX are registered in `document.tsx`. Named slots work as in Astro: `<div slot="go">` inside a component becomes that slot's content (`remark-slots.ts`, `components/Slot.tsx`).

## Rendering

- Pages are plain HTML. They never hydrate and never load the site's styles, fonts or scripts; the site's never load the docs'. A page links `styles/global.css` and the one browser script, `client.ts`.
- Everything a page loads lives under `/docs` (the stylesheet, script and fonts are built to `/docs/_build`, images are in `public/docs/assets`), so the docs never depend on the site's files and never collide with them (the site's own build files are at `/_build`). The build fails otherwise.
- Interactive pieces (search, copy buttons, tabs, the status link) are delegated listeners in `client.ts`, keyed on `data-*` attributes the components render. Don't add Solid state or effects to docs components; they only run on the server.
- The theme script is inline in `layouts/DocsLayout.tsx` so pages never flash. Navigation is ordinary page loads, made instant by Speculation Rules and cross-document view transitions.
- `vite.ts` compiles MDX the way Astro's MDX integration did (GitHub-flavoured Markdown, smart punctuation, Shiki with the github-light and github-dark themes, GitHub-style heading ids), so the markup and `global.css` stay unchanged.

## Build and serving

- `script/build.ts` runs after the site's `vite build` (from `script/build.ts` at the site root): it builds the docs' stylesheet and script, prerenders every page, every content page's Markdown twin (`/docs/config.md`; the intro's is `/docs/index.md`), `llms.txt` and the sitemap into `.output/public`, builds the Pagefind index, and checks every link, that nothing loads from outside `/docs` and that no page takes a reserved file name. `--mode dev` makes `llms.txt` and the sitemap list dev.opencode.ai.
- Pull requests that touch the site run the same build on its own (`.github/workflows/check-docs.yml`): `bun run generate`, then `bun src/docs/script/build.ts --out <dir>`.
- The Worker never renders docs. `middleware.ts` serves the prerendered files: docs URLs reach it first (`runWorkerFirst` in `cloudflare.config.ts`), so a page's URL answers `Accept: text/markdown` with its twin. `vite dev` has no prerendered files, so the development server renders on request.
- `/docs` still receives the V1 docs' old links, which had more pages and other languages (`/docs/ja/...`). `middleware.ts` redirects any `/docs` path that isn't a page here (`virtual:docs-pages`, the same list the build prerenders) to the same path on the V1 docs with a 302, so adding a page here takes its URL over. The old `/v2` URLs redirect to `/docs` permanently (`src/lib/legacy.ts`).

## Writing Style

- Keep prose sections brief and focused on one idea. Prefer one to three sentences over large paragraphs.
- Interleave explanations with concrete code, configuration, command, or output examples so pages do not become walls of text.
- Put the relevant example immediately after the text that introduces it, following `content/build/plugins/cli.mdx` as the reference pattern.
- Every subsection that explains syntax, fields, or an API concept must include its own minimal example. A larger example earlier on the page does not count.
- Split long explanations with meaningful headings and examples rather than accumulating caveats in one paragraph.
- Lead with the common task and working example; place edge cases and supporting details afterward.
- Do not stack several prose paragraphs without a visual break. After introducing a concept, use an example, list, table, or task-oriented subheading before covering the next concern.
- Use bullets or tables for independent rules, options, and constraints. Do not hide reference material in narrative paragraphs.
- Organize workflow documentation in the order readers perform it, with a working example at each major step.

## Validation

- Run `bun typecheck` and `bun run build` from `services/site` after changes. The build fails on invalid frontmatter, MDX errors and broken links.
- Check desktop and mobile layouts, light and dark, when changing navigation or shared styles.
