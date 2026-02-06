# Docs Shell i18n (Astro surfaces)

## Objective

Remove hardcoded English strings from Astro-rendered docs shell surfaces and use locale-aware labels and links.

## Primary targets

- `packages/web/astro.config.mjs`
- `packages/web/config.mjs`
- `packages/web/src/components/Header.astro`
- `packages/web/src/components/Head.astro`
- `packages/web/src/components/Lander.astro`
- `packages/web/src/components/SiteTitle.astro` (only if fallback text needs localization)
- `packages/web/src/content/i18n/*.json`

## Implementation plan

1. Sidebar translations
   - Localize grouped labels (`Usage`, `Configure`, `Develop`) using Starlight `sidebar[].translations`.
   - Keep slug lists unchanged.
2. Header link localization
   - Replace static `Home` / `Docs` labels in config with translation keys.
   - In `Header.astro`, render labels through `Astro.locals.t(...)`.
3. Locale-aware internal links
   - Replace hardcoded `"/"` and `"/docs"` shell links with locale-safe URLs (`astro:i18n` helpers).
4. Metadata and hero copy localization
   - Localize static tagline/title fragments in `Head.astro` and `Lander.astro`.
   - Localize all visible CTA text, captions, and section labels in `Lander.astro`.
5. Keep literals stable where required
   - Do not translate product names, code snippets, command lines, or provider identifiers.

## Dependencies

- Depends on spec 10.
- Runs in parallel with specs 12 and 13.

## Acceptance criteria

- No hardcoded English UI labels remain in the target Astro files.
- Sidebar group labels are localized for all supported locales.
- Header and hero links remain valid in every locale.
- Docs build succeeds with all locales enabled.

## Validation commands

```bash
bun --cwd packages/web astro check
bun --cwd packages/web build
rg -n 'label:\s*"Usage"|label:\s*"Configure"|label:\s*"Develop"' packages/web/astro.config.mjs
rg -n 'Get Started|The AI coding agent built for the terminal|Home|Docs' packages/web/src/components/*.astro
```
