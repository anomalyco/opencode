# Documentation feature guide

## Structure

- This folder owns the documentation data model, content, frontend, and styling.
- Documentation content lives in `content/` and is loaded by `../content.config.ts`.
- `lib/navigation.ts` is the source of truth for header sections and sidebar ordering.
- The thin route entrypoints live in `../pages/docs/`; keep docs implementation details here.
- Do not add a documentation frontend framework; this folder owns the UI directly.
- Keep internal Markdown links docs-root-relative, for example `/config`; `remark-links.ts` applies the site and docs base paths.

## Validation

- Run `bun typecheck` and `bun run build` from `packages/www` after changes.
- Check desktop and mobile layouts when changing navigation or shared styles.
