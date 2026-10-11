---
name: OpenCode UI i18n and RTL
description: Use when you add or change user-visible text, aria-labels, placeholders, tooltips, counts, or locale-dependent behavior in @opencode/ui, app, or session-ui code, or when you write CSS, icons, menus, scrolling, or pointer logic that must work in right-to-left layouts.
---

# OpenCode UI i18n and RTL

> Design rules in this skill come from the design system owner. Fix facts (paths, prop names, token names) directly. To change a rule, record design feedback with `/design-feedback`.

## The APIs

| Code in                              | Get the API with                                                                      | Dictionary (English source)                          |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `packages/ui`, `packages/session-ui` | `const i18n = useI18n()` from `@opencode/ui/context` (or `@opencode/ui/context/i18n`) | `packages/ui/src/i18n/en.ts` (keys start with `ui.`) |
| `packages/app`                       | `const language = useLanguage()` from `packages/app/src/runtime/i18n/language.tsx`    | `packages/app/src/runtime/i18n/en.ts`                |

`useI18n()` returns `UiI18n` (`packages/ui/src/context/i18n.tsx`):

- `t(key, params?)`: ordinary copy. Templates use `{{name}}`. The type rejects plural lookup keys such as `ui.common.fileCount.one`.
- `plural(baseKey, count, params?)`: count-sensitive copy. It selects the CLDR category for the active locale and passes `count` into the template.
- `tDynamic(key, englishSource, params?)`: runtime-generated English copy. English returns `englishSource`; other locales use the keyed translation.
- `list(items)` and `listSeparator(index, count)`: locale-aware lists.
- `pluralForm(baseKey, category, params?)`: only for components that animate each grammatical form (for example `packages/session-ui/src/components/tool-count-label.tsx`).

The app's `useLanguage()` has the same `t`, `plural`, `tDynamic`, and `list`, plus `rich(key, { name: <JSX/> })`, `direction()`, and `setDirection()`. `UiI18nBridge` in `language.tsx` connects it to `@opencode/ui`. Without a provider, `useI18n()` falls back to English.

## Rules

### Localization

1. Do not hardcode user-visible strings. Use an i18n key for visible copy, component defaults, placeholders, `aria-label`, `alt`, `title`, tooltips, menus, dialogs, toasts, empty states, and displayed errors.
   **Why:** Every hardcoded string stays English in all other locales.
2. In a component, let a prop override the default, and translate the default: `local.closeLabel ?? i18n.t("ui.common.close")`.
   **Why:** Callers can supply context-specific copy, and the default is still localized.
3. Add English source strings only. Do not add the key to non-English dictionaries.
   **Why:** The runtime falls back to English; translations land separately after language review.
4. Render count-sensitive copy only with `plural(baseKey, count, params)`. Add `<baseKey>.one` and `<baseKey>.other` to `en.ts`. Do not pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` keys to `t(...)`, and do not call `Intl.PluralRules`.
   **Why:** Many locales have more than two plural forms; only the shared API selects them correctly.
5. Do not branch on the locale in feature or component code. Use `tDynamic(...)` for runtime-generated English copy that has keyed alternatives. If the API cannot express a case, extend the shared language module so one typed call owns it.
   **Why:** Locale logic in call sites is duplicated, untested, and wrong for some locales.
6. Use complete phrases. Do not concatenate translated fragments or compose count phrases at the call site. Keep placeholders to irreducible values such as names, paths, and counts.
   **Why:** Word order and agreement differ between languages.
7. Keep English copy and English keys byte-for-byte. When you move copy into i18n, copy it exactly unless the task asks for a copy change. Do not edit English to make translation easier.
   **Why:** English is designer-written source copy.
8. Do not translate from model knowledge alone. Follow [references/translation.md](references/translation.md) when you write or review non-English strings.
   **Why:** Developer terminology has established local usage that literal translation misses.

### RTL

9. Use logical CSS for layout: `padding-inline-start`, `margin-inline-end`, `inset-inline-start`, `border-inline-end`, `text-align: start`; Tailwind `ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`, `text-start`, `text-end`. Use physical properties only for pointer coordinates, canvas geometry, and native window controls.
   **Why:** Logical properties follow `dir` without extra code.
10. Keep DOM and focus order semantic. Do not use `row-reverse`, CSS `order`, or reversed markup to mirror a layout.
    **Why:** Flexbox and Grid already follow `dir`; reversing breaks reading and keyboard order.
11. Treat direction as independent from language. Do not change the locale to force RTL. In the app, use `language.setDirection("rtl")`; it sets `document.documentElement.dir`.
    **Why:** Users can run English in RTL and RTL locales with LTR content.
12. Wrap portaled content (menus, popovers, selects, tooltips) in the `I18nProvider` from `@opencode/ui/context`. Pass `layoutLocale` when the direction differs from the language.
    **Why:** Kobalte derives menu direction from its locale, not from `dir`; the provider passes `layoutLocale ?? locale` to Kobalte's `I18nProvider`.
13. Isolate text of unknown direction with `dir="auto"` or `<bdi>`. Keep code, URLs, IDs, keybinds, and file paths LTR with `<bdi dir="ltr">`, without forcing the surrounding component LTR.
    **Why:** Unisolated mixed-script text reorders punctuation and neighbors.
14. Mirror directional meaning only. `Icon` already mirrors `arrow-left`, `arrow-right`, `chevron-left`, and `chevron-right` in RTL through `data-directional`. Do not mirror brands, clocks, media controls, charts, check marks, or text. Reverse physical gradients, `translateX`, SVG transforms, and animation deltas yourself with `:dir(rtl)`.
    **Why:** Mirroring a non-directional glyph changes its meaning.
15. Map interaction through direction. `clientX` and `scrollLeft` are physical: RTL `scrollLeft` starts at `0` and becomes negative. Read `getComputedStyle(el).direction`, as `components/resize-handle.tsx` and `components/scroll-view.tsx` do, or use `scrollIntoView({ inline: "nearest" })`.
    **Why:** LTR math moves resize handles and scroll thumbs the wrong way in RTL.

## Do / Don't

```tsx
// Do (packages/ui/src/overlays/dialog/dialog.tsx)
<CloseButton aria-label={local.closeLabel ?? i18n.t("ui.common.close")} />
// Don't
<CloseButton aria-label="Close" />
```

```tsx
// Do (packages/session-ui/src/tools/tool-renderer.tsx)
i18n.plural("ui.common.fileCount", input.files.length)
// en.ts: "ui.common.fileCount.one": "{{count}} file", "ui.common.fileCount.other": "{{count}} files"

// Don't
i18n.t(count === 1 ? "ui.common.fileCount.one" : "ui.common.fileCount.other", { count })
const label = `${count} ${i18n.t("ui.common.files")}`
```

```tsx
// Do (packages/app/src/session/usage-exceeded-dialogs.tsx)
title={tDynamic("dialog.usageExceeded.freeTier.title", action.title)}
// Don't
title={language.locale() === "en" ? action.title : language.t("dialog.usageExceeded.freeTier.title")}
```

```css
/* Do */
[data-slot="row"] {
  padding-inline-start: 12px;
  text-align: start;
}
:dir(rtl) [data-slot="menu-v2-item-chevron"] {
  transform: scaleX(-1);
}
/* Don't */
[data-slot="row"] {
  padding-left: 12px;
  text-align: left;
}
```

```tsx
// Do (packages/session-ui/src/components/timeline-separator.tsx)
<bdi dir="ltr" class="min-w-0 truncate" title={value()}>{value()}</bdi>
<span dir="auto" class="min-w-0 truncate">{session.title}</span>
// Don't
<span>{session.title}</span>
```

## Checklist

- [ ] No hardcoded visible strings, `aria-label`, `alt`, `title`, or placeholder text.
- [ ] New keys exist only in the English dictionary.
- [ ] English copy is unchanged, byte-for-byte.
- [ ] Counts use `plural(...)`; no plural-category key reaches `t(...)`.
- [ ] No locale checks, `Intl.PluralRules`, or concatenated sentences in feature code.
- [ ] CSS and Tailwind use logical properties; no `row-reverse` or `order` for mirroring.
- [ ] Portaled content is inside `I18nProvider`.
- [ ] User text has `dir="auto"` or `<bdi>`; code, paths, and keybinds have `<bdi dir="ltr">`.
- [ ] Only directional icons mirror.
- [ ] Pointer, scroll, and keyboard logic is correct in RTL.
- [ ] Checked in Storybook with the `direction` global set to `rtl` (and the `locale` global set to `ar` or `he`), plus English in RTL and mixed-script, long, numeric, code, and path content.

## Enforced by

- `design/no-physical-direction`: flags physical left/right CSS (`margin-left`, `padding-right`, `border-left-*`, `border-top-left-radius`, `left`, `right`, `text-align: left|right`, `float: left|right`) and Tailwind classes (`ml-*`, `pr-*`, `left-*`, `text-left`, `rounded-l`, `border-r`, `float-right`, `[margin-left:…]`). The message names the logical equivalent. Run `bun run --cwd packages/ui lint:design <files>`. When a physical value is correct (pointer coordinates, canvas, native controls), suppress it with a reason: `/* design-lint-allow design/no-physical-direction: native traffic-light inset */`. An allow comment without a reason does not suppress.
- Localization rules 1–8 are review-only. The TypeScript types reject plural lookup keys passed to `t(...)`.

See [references/rtl.md](references/rtl.md) for the RTL test matrix, Electron title bars, and sources.
