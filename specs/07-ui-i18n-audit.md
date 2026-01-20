# UI i18n Audit (Remaining Work)

Scope: `packages/ui/` (and consumers: `packages/app/`, `packages/enterprise/`)

Date: 2026-01-20

This report documents the remaining user-facing strings in `packages/ui/src` that are still hardcoded (not routed through a translation function), and proposes an i18n architecture that works long-term across multiple packages.

## Current State

- `packages/app/` already has i18n via `useLanguage().t("...")` with dictionaries in `packages/app/src/i18n/en.ts` and `packages/app/src/i18n/zh.ts`.
- `packages/ui/` is a shared component library used by:
  - `packages/app/src/pages/session.tsx` (Session UI)
  - `packages/enterprise/src/routes/share/[shareID].tsx` (shared session rendering)
- `packages/ui/` currently has **hardcoded English UI copy** in several components (notably `session-turn.tsx`, `session-review.tsx`, `message-part.tsx`).
- `packages/enterprise/` does not currently have an i18n system, so any i18n approach must be usable without depending on `packages/app/`.

## Decision: How We Should Add i18n To `@opencode-ai/ui`

Introduce a small, app-agnostic i18n interface in `packages/ui/` and keep UI-owned strings in UI-owned dictionaries.

Why this is the best long-term shape:

- Keeps dependency direction clean: `packages/enterprise/` (and any future consumer) can translate UI without importing `packages/app/` dictionaries.
- Avoids prop-drilling strings through shared components.
- Allows each package to own its strings while still rendering a single, coherent locale in the product.

### Proposed Architecture

1. **UI provides an i18n context (no persistence)**

- Add `packages/ui/src/context/i18n.tsx`:
  - Exports `I18nProvider` and `useI18n()`.
  - Context value includes:
    - `t(key, params?)` translation function (template interpolation supported by the consumer).
    - `locale()` accessor for locale-sensitive formatting (Luxon/Intl).
  - Context should have a safe default (English) so UI components can render even if a consumer forgets the provider.

2. **UI owns UI strings (dictionaries live in UI)**

- Add `packages/ui/src/i18n/en.ts` and `packages/ui/src/i18n/zh.ts`.
- Export them from `@opencode-ai/ui` via `packages/ui/package.json` exports (e.g. `"./i18n/*": "./src/i18n/*.ts"`).
- Use a clear namespace prefix for all UI keys to avoid collisions:
  - Recommended: `ui.*` (e.g. `ui.sessionReview.title`).

3. **Consumers merge dictionaries and provide `t`/`locale` once**

- `packages/app/`:
  - Keep `packages/app/src/context/language.tsx` as the source of truth for locale selection/persistence.
  - Extend it to merge UI dictionaries into its translation table.
  - Add a tiny bridge provider in `packages/app/src/app.tsx` to feed `useLanguage()` into `@opencode-ai/ui`'s `I18nProvider`.

- `packages/enterprise/`:
  - Add a lightweight locale detector (similar to `packages/app/src/context/language.tsx`), likely based on `Accept-Language` on the server and/or `navigator.languages` on the client.
  - Merge `@opencode-ai/ui` dictionaries and (optionally) enterprise-local dictionaries.
  - Wrap the share route in `I18nProvider`.

### Key Naming Conventions (UI)

- Prefer component + semantic grouping:
  - `ui.sessionReview.title`
  - `ui.sessionReview.diffStyle.unified`
  - `ui.sessionReview.diffStyle.split`
  - `ui.sessionReview.expandAll`
  - `ui.sessionReview.collapseAll`

- For `SessionTurn`:
  - `ui.sessionTurn.steps.show`
  - `ui.sessionTurn.steps.hide`
  - `ui.sessionTurn.summary.response`
  - `ui.sessionTurn.diff.more` (use templating: `Show more changes ({{count}})`)
  - `ui.sessionTurn.retry.retrying` / `ui.sessionTurn.retry.inSeconds` / etc (avoid string concatenation that is English-order dependent)
  - Status text:
    - `ui.sessionTurn.status.delegating`
    - `ui.sessionTurn.status.planning`
    - `ui.sessionTurn.status.gatheringContext`
    - `ui.sessionTurn.status.searchingCode`
    - `ui.sessionTurn.status.searchingWeb`
    - `ui.sessionTurn.status.makingEdits`
    - `ui.sessionTurn.status.runningCommands`
    - `ui.sessionTurn.status.thinking`
    - `ui.sessionTurn.status.thinkingWithTopic` (template: `Thinking - {{topic}}`)
    - `ui.sessionTurn.status.gatheringThoughts`
    - `ui.sessionTurn.status.consideringNextSteps` (fallback)

## Locale-Sensitive Formatting (UI)

`SessionTurn` currently formats durations via Luxon `Interval.toDuration(...).toHuman(...)` without an explicit locale.

When i18n is added:

- Use `useI18n().locale()` and pass locale explicitly:
  - Luxon: `duration.toHuman({ locale: locale(), ... })` (or set `.setLocale(locale())` where applicable).
  - Intl numbers/currency (if added later): `new Intl.NumberFormat(locale(), ...)`.

## Initial Hardcoded Strings (Audit Findings)

These are the highest-impact UI surfaces to translate first.

### 1) `packages/ui/src/components/session-review.tsx`

- `Session changes`
- `Unified` / `Split`
- `Collapse all` / `Expand all`

### 2) `packages/ui/src/components/session-turn.tsx`

- Tool/task status strings (e.g. `Delegating work`, `Searching the codebase`)
- Steps toggle labels: `Show steps` / `Hide steps`
- Summary section title: `Response`
- Pagination CTA: `Show more changes ({{count}})`

### 3) `packages/ui/src/components/message-part.tsx`

Examples (non-exhaustive):

- `Error`
- `Edit`
- `Write`
- `Type your own answer`
- `Review your answers`

### 4) Additional Hardcoded Strings (Full Audit)

Found during a full `packages/ui/src/components` + `packages/ui/src/context` sweep:

- `packages/ui/src/components/list.tsx`
  - `Loading`
  - `No results`
  - `No results for "{{filter}}"`
- `packages/ui/src/components/message-nav.tsx`
  - `New message`
- `packages/ui/src/components/text-field.tsx`
  - `Copied`
  - `Copy to clipboard`
- `packages/ui/src/components/image-preview.tsx`
  - `Image preview` (alt text)

## Prioritized Implementation Plan

1. Completed (2026-01-20): Add `@opencode-ai/ui` i18n context (`packages/ui/src/context/i18n.tsx`) + export it.
2. Completed (2026-01-20): Add UI dictionaries (`packages/ui/src/i18n/en.ts`, `packages/ui/src/i18n/zh.ts`) + export them.
3. Completed (2026-01-20): Wire `I18nProvider` into:
   - `packages/app/src/app.tsx`
   - `packages/enterprise/src/app.tsx`
4. Completed (2026-01-20): Convert `packages/ui/src/components/session-review.tsx` and `packages/ui/src/components/session-turn.tsx` to use `useI18n().t(...)`.
5. Completed (2026-01-20): Convert `packages/ui/src/components/message-part.tsx`.
6. Completed (2026-01-20): Do a full `packages/ui/src/components` + `packages/ui/src/context` audit for additional hardcoded copy.

## Notes / Risks

- **SSR:** Enterprise share pages render on the server. Ensure the i18n provider works in SSR and does not assume `window`/`navigator`.
- **Key collisions:** Use a consistent `ui.*` prefix to avoid clashing with app keys.
- **Fallback behavior:** Decide whether missing keys should:
  - fall back to English, or
  - render the key (useful for catching missing translations).
