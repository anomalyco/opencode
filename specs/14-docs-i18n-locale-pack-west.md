# Docs Locale Pack West

## Objective

Complete translation keys and docs content for west/latin/rtl locales.

Locales in this pack:

- `ar`, `bs`, `da`, `de`, `es`, `fr`, `it`, `nb`, `pl`, `pt-br`, `tr`

## Parallelization model

- Run one subagent per locale (11 subagents total) with the same checklist.
- All locale subagents can run concurrently.

## Primary targets

- `packages/web/src/content/i18n/ar.json`
- `packages/web/src/content/i18n/bs.json`
- `packages/web/src/content/i18n/da.json`
- `packages/web/src/content/i18n/de.json`
- `packages/web/src/content/i18n/es.json`
- `packages/web/src/content/i18n/fr.json`
- `packages/web/src/content/i18n/it.json`
- `packages/web/src/content/i18n/nb.json`
- `packages/web/src/content/i18n/pl.json`
- `packages/web/src/content/i18n/pt-BR.json`
- `packages/web/src/content/i18n/tr.json`
- `packages/web/src/content/docs/ar/**/*.mdx`
- `packages/web/src/content/docs/bs/**/*.mdx`
- `packages/web/src/content/docs/da/**/*.mdx`
- `packages/web/src/content/docs/de/**/*.mdx`
- `packages/web/src/content/docs/es/**/*.mdx`
- `packages/web/src/content/docs/fr/**/*.mdx`
- `packages/web/src/content/docs/it/**/*.mdx`
- `packages/web/src/content/docs/nb/**/*.mdx`
- `packages/web/src/content/docs/pl/**/*.mdx`
- `packages/web/src/content/docs/pt-br/**/*.mdx`
- `packages/web/src/content/docs/tr/**/*.mdx`

## Per-locale checklist

1. Translate all required keys in the locale i18n JSON.
2. Keep placeholders, interpolation tokens, and key names exactly aligned with English.
3. Translate all 35 locale docs pages slug-for-slug.
4. Keep code blocks, shell commands, config keys, and product names literal.
5. Validate markdown formatting and frontmatter schema.
6. Run locale-specific verification command before handoff.

## Dependencies

- Depends on specs 11, 12, and 13.
- Runs in parallel with spec 15.

## Acceptance criteria

- All listed locale dictionaries are complete and schema-valid.
- All listed locale docs trees contain all required slugs.
- i18n parity and build checks pass for this locale set.

## Validation commands

```bash
bun --cwd packages/web astro check
bun --cwd packages/web build
bun --cwd packages/web run i18n:check -- --locales ar,bs,da,de,es,fr,it,nb,pl,pt-br,tr
```
