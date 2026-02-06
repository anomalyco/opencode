# Docs Content Structure and Link i18n

## Objective

Restructure docs content for Starlight locale directories and eliminate locale-breaking absolute links.

## Primary targets

- `packages/web/src/content/docs/*.mdx` (root English source of truth)
- `packages/web/src/content/docs/<locale>/**/*.mdx` (new locale trees)
- `packages/web/src/content/docs/**/*.mdx` (link updates)
- `packages/web/scripts/i18n-scaffold-pages.ts` (new)
- `packages/web/scripts/i18n-link-check.ts` (new)

## Implementation plan

1. Keep root locale docs where they are.
   - Root English remains in `src/content/docs/*.mdx` for non-prefixed URLs.
2. Scaffold locale trees for all non-root locales.
   - Mirror all 35 English slugs into each locale directory.
   - Preserve frontmatter shape and page IDs.
3. Convert locale-breaking links.
   - Replace internal absolute `/docs/...` links with locale-safe links (relative slug links preferred).
   - Preserve anchors and query strings.
4. Add repeatable scaffolding + checks.
   - Scaffolding script to create/mirror missing pages.
   - Link check to fail on new absolute internal `/docs/` links in docs content.

## Dependencies

- Depends on spec 10.
- Runs in parallel with specs 11 and 12.

## Acceptance criteria

- Every non-root locale directory exists under `src/content/docs/`.
- Every locale contains the full English slug set.
- No internal markdown links force the default locale via hardcoded `/docs/...` paths.

## Validation commands

```bash
bun --cwd packages/web astro check
bun --cwd packages/web build
rg -n '\]\(/docs/' packages/web/src/content/docs --glob '*.mdx'
rg -n 'href="/docs/' packages/web/src/content/docs --glob '*.mdx'
```
