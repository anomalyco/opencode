## i18n hardening and parity

Strengthen locale correctness and remove remaining hardcoded copy.

---

### Summary

The app has broad translation coverage but still has maintainability gaps: locale dictionaries are typed as `Partial`, some non-English dictionaries contain English values for specific keys, and a few user-facing strings are still hardcoded in components/pages. This spec hardens i18n guarantees and cleans up remaining drift.

---

### Goals

- Enforce stricter dictionary key parity across all app locales.
- Remove known English fallback strings from non-English locale files.
- Localize remaining hardcoded user-facing strings in scoped files.
- Keep existing localization architecture (`useLanguage().t(...)`) intact.

---

### Non-goals

- No translation quality rewrite for all strings.
- No locale expansion beyond existing languages.
- No changes to non-user-facing log/diagnostic strings.

---

### Parallel ownership (important)

This workstream owns:

- `packages/app/src/context/language.tsx`
- `packages/app/src/i18n/*.ts`
- `packages/app/src/components/dialog-custom-provider.tsx`
- `packages/app/src/pages/directory-layout.tsx`

This workstream must not edit:

- `pages/session.tsx`, `pages/layout.tsx`, `components/prompt-input.tsx`
- server/terminal integration files owned by specs 14/15

---

### Current state

- Locale files are large and manually maintained.
- Non-English locales are typed with `Partial<Record<Keys, string>>`, which allows silent missing keys.
- Known untranslated strings exist for keys like:
  - `command.session.previous.unseen`
  - `command.session.next.unseen`
- Some user-facing strings remain hardcoded in scoped files.

---

### Proposed approach

1. Tighten locale typing:

- Move from `Partial<Record<Keys, string>>` to stricter parity enforcement.
- Keep `en.ts` as source-of-truth key set.

2. Fix known untranslated key values in non-English dictionaries.

3. Localize scoped hardcoded strings by adding translation keys and using `language.t(...)`.

---

### Phased steps

1. Add/adjust shared locale typing pattern for parity safety.
2. Update all locale files to satisfy stricter typing.
3. Translate known English carry-over keys in non-English dictionaries.
4. Replace hardcoded copy in:

- `components/dialog-custom-provider.tsx`
- `pages/directory-layout.tsx`

5. Run typecheck and parity checks.

---

### Acceptance criteria

- Locale files enforce full key parity against `en` (compile-time).
- No known English carry-over values remain for the targeted keys in non-English locales.
- Scoped hardcoded user-facing strings are replaced with translation keys.
- Typecheck passes.

---

### Validation plan

- Typecheck: `bun run typecheck` (from `packages/app`).
- Grep sanity checks:
  - targeted keys no longer English in non-English locales
  - scoped files no longer contain hardcoded user-facing copy
- Manual spot checks in at least 2 locales (for example: `de`, `zh`).

---

### Handoff notes

- Keep key naming consistent with existing conventions.
- Avoid broad copy changes outside scoped files to reduce review surface.
- If translation wording is uncertain, keep it simple and literal for now; quality passes can follow.
