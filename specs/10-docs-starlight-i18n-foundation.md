# Docs i18n Foundation (Astro + Starlight)

## Objective

Wire Starlight-native i18n in `packages/web` so all downstream work can localize against one source of truth.

## Primary targets

- `packages/web/astro.config.mjs`
- `packages/web/src/content.config.ts`
- `packages/web/src/content/i18n/en.json` (new)
- `packages/web/src/content/i18n/*.json` (new for each locale)

## Implementation plan

1. Configure Starlight locales in `astro.config.mjs`.
   - Use root English locale (`root`) to preserve existing route shape.
   - Add all mapped locales from spec 09 with correct `lang` and `dir`.
2. Keep Starlight as the i18n router.
   - Do not build a custom parallel i18n routing layer.
3. Add the `i18n` collection in `src/content.config.ts`.
   - Use `i18nLoader()` and `i18nSchema()`.
   - Extend schema with custom project keys used by `Lander`, `Header`, `Head`, `Share`, and `share/*` components.
4. Add locale JSON dictionaries in `src/content/i18n/`.
   - Include one baseline dictionary for English.
   - Include one dictionary per locale key.
   - For region-specific locales, use BCP-47 filenames (for example `pt-BR.json`, `zh-CN.json`, `zh-TW.json`).
   - Keep placeholders/interpolations stable across locales.
5. Decide fallback policy.
   - During migration: allow fallback to root locale content.
   - Final state: all required keys and docs slugs exist in all locales.

## Dependencies

- No upstream dependency.
- Blocks specs 11, 12, 13, 14, and 15.

## Acceptance criteria

- Locale picker includes all required locales.
- `Astro.locals.t` resolves Starlight + custom keys.
- `src/content.config.ts` validates i18n key schema.
- Build succeeds with locale routing enabled.

## Validation commands

```bash
bun --cwd packages/web astro check
bun --cwd packages/web build
rg -n 'locales|defaultLocale|root' packages/web/astro.config.mjs
rg -n 'i18nLoader|i18nSchema|docsLoader|docsSchema' packages/web/src/content.config.ts
```
