# Documentation feature guide

## Structure

- This folder owns the documentation data model, content, frontend, and styling.
- Documentation content lives in `content/` and is loaded by `../content.config.ts`.
- `lib/navigation.ts` is the source of truth for header sections and sidebar ordering.
- The thin route entrypoints live in `../pages/docs/`; keep docs implementation details here.
- Do not add a documentation frontend framework; this folder owns the UI directly.
- Keep internal Markdown links docs-root-relative, for example `/config`; `remark-links.ts` applies the site and docs base paths.

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

- Run `bun typecheck` and `bun run build` from `packages/www` after changes.
- Check desktop and mobile layouts when changing navigation or shared styles.
