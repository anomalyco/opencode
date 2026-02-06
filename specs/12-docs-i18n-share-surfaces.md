# Docs Share Surface i18n (Solid + route handlers)

## Objective

Localize all user-visible strings in share routes and Solid share components used by the docs site.

## Primary targets

- `packages/web/src/pages/s/[id].astro`
- `packages/web/src/pages/[...slug].md.ts`
- `packages/web/src/components/Share.tsx`
- `packages/web/src/components/share/part.tsx`
- `packages/web/src/components/share/content-bash.tsx`
- `packages/web/src/components/share/content-error.tsx`
- `packages/web/src/components/share/content-markdown.tsx`
- `packages/web/src/components/share/content-text.tsx`
- `packages/web/src/components/share/copy-button.tsx`
- `packages/web/src/components/share/common.tsx`
- `packages/web/src/content/i18n/*.json`

## Implementation plan

1. Create a single translation bridge for Solid components.
   - Resolve strings in `.astro` (`Astro.locals.t`) and pass a `messages` object into `Share.tsx`.
   - Avoid duplicating separate client dictionaries.
2. Replace hardcoded UI text in share components.
   - Status text (`Connected`, `Connecting`, `Waiting for messages`, etc.).
   - Expand/collapse controls (`Show more`, `Show less`, etc.).
   - Labels/tooltips (`Cost`, `Input Tokens`, `Scroll to bottom`, copy tooltips).
3. Localize route-layer fallback text.
   - `Not found` and share metadata description should come from translation keys.
4. Locale-aware formatting.
   - Use locale-sensitive date/number formatting where `luxon`/`Intl` output is displayed.
5. Keep technical tokens unchanged.
   - Tool IDs, protocol literals, and command identifiers remain literal.

## Dependencies

- Depends on spec 10.
- Runs in parallel with specs 11 and 13.

## Acceptance criteria

- No hardcoded English UI copy remains in targeted share files.
- Share page metadata, status labels, and controls localize by locale.
- Locale-aware formatting is applied where values are formatted for display.

## Validation commands

```bash
bun --cwd packages/web astro check
bun --cwd packages/web build
rg -n 'Show more|Show less|Waiting for messages|Connected|Disconnected|Not found|Scroll to bottom' packages/web/src/components/Share.tsx packages/web/src/components/share packages/web/src/pages/s/[id].astro packages/web/src/pages/[...slug].md.ts
```
