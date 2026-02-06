# Docs Locale Pack East

## Objective

Complete translation keys and docs content for east/cjk/cyrillic locales.

Locales in this pack:

- `ja`, `ko`, `ru`, `th`, `zh-cn`, `zh-tw`

## Parallelization model

- Run one subagent per locale (6 subagents total).
- All locale subagents can run concurrently.

## Primary targets

- `packages/web/src/content/i18n/ja.json`
- `packages/web/src/content/i18n/ko.json`
- `packages/web/src/content/i18n/ru.json`
- `packages/web/src/content/i18n/th.json`
- `packages/web/src/content/i18n/zh-CN.json`
- `packages/web/src/content/i18n/zh-TW.json`
- `packages/web/src/content/docs/ja/**/*.mdx`
- `packages/web/src/content/docs/ko/**/*.mdx`
- `packages/web/src/content/docs/ru/**/*.mdx`
- `packages/web/src/content/docs/th/**/*.mdx`
- `packages/web/src/content/docs/zh-cn/**/*.mdx`
- `packages/web/src/content/docs/zh-tw/**/*.mdx`

## Per-locale checklist

1. Translate all required keys in locale i18n JSON.
2. Keep placeholders/interpolation tokens unchanged.
3. Translate all 35 locale docs pages slug-for-slug.
4. Keep commands, code blocks, and technical identifiers literal.
5. Validate script consistency and typography for each language.
6. Run locale-specific verification command before handoff.

## Dependencies

- Depends on specs 11, 12, and 13.
- Runs in parallel with spec 14.

## Acceptance criteria

- All listed locale dictionaries are complete and schema-valid.
- All listed locale docs trees contain all required slugs.
- i18n parity and build checks pass for this locale set.

## Validation commands

```bash
bun --cwd packages/web astro check
bun --cwd packages/web build
bun --cwd packages/web run i18n:check -- --locales ja,ko,ru,th,zh-cn,zh-tw
```
