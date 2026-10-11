---
name: OpenCode UI
description: Use when you build, style, or review UI that uses @opencode/ui (SolidJS components, CSS, or Tailwind classes in app, desktop, session-ui, enterprise, or other OpenCode products), or when you add or change a component in packages/ui. Start here, then load the focused opencode-ui-* skill for the task.
---

# OpenCode UI

> Design rules in this skill come from the design system owner. Fix facts (paths, prop names, token names) directly. To change a rule, record design feedback with `/design-feedback`.

`@opencode/ui` is the OpenCode design system: SolidJS components built on Kobalte, plain CSS keyed on `data-*` attributes, a v2 semantic token set, and a runtime theme engine with 36 themes. Paths in this skill are relative to `packages/ui` in the OpenCode monorepo.

## Which skill to load

| Task | Skill |
| --- | --- |
| Pick a color, border, shadow, or overlay; replace a raw color or a legacy `--surface-*`/`--text-*` token; add a token | `opencode-ui-tokens` |
| Dark mode, theme switching, theme JSON, a selector that depends on the color scheme | `opencode-ui-theming` |
| Font size, weight, line height, letter spacing, truncation | `opencode-ui-typography` |
| User-visible text, aria labels, plurals, RTL, logical CSS properties | `opencode-ui-i18n-rtl` |
| Use, extend, or create a component; props and `data-*` contract | `opencode-ui-components` |
| Spacing, sizing, panels, scroll areas, stacking, responsive layout | `opencode-ui-layout` |

## Library structure

- **Category folders (v2, preferred):** `src/actions`, `src/data-display`, `src/feedback`, `src/forms`, `src/icons`, `src/layout`, `src/navigation`, `src/overlays`, `src/typography`. Each component has its own folder: `<name>/<name>.tsx`, `<name>/<name>.css`, `<name>/<name>.stories.tsx`. The `.tsx` file imports its own CSS (`import "./button.css"`).
- **Legacy flat folder:** `src/components/*.tsx` + `*.css`. Their CSS loads through `src/styles/index.css`. Many still use legacy v1 tokens. Do not add new components here.
- **Tokens:** v2 semantic tokens in `src/styles/tokens/theme.css`, v2 primitives in `src/styles/tokens/colors.css`. Legacy v1 tokens in `src/styles/colors.css` and `src/styles/theme.css`.
- **Theme runtime:** `src/theme/**` (`ThemeProvider`, `useTheme`, `resolveThemeVariantV2`, theme JSON in `src/theme/themes`).
- **Localization:** `src/i18n/<locale>.ts`, consumed through `useI18n()` from `src/context/i18n.tsx`.

The full list of subpath exports, sources, stories, and `data-component` values is in [`../opencode-ui-components/references/components.md`](../opencode-ui-components/references/components.md).

## Imports

Import each component from its subpath export. There is no root barrel.

```tsx
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { Dialog, DialogHeader, DialogTitle, DialogBody } from "@opencode/ui/dialog"
import { ThemeProvider, useTheme } from "@opencode/ui/theme"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
```

Stylesheets (order as in `packages/app/src/index.css`):

```css
@import "@opencode/ui/styles/tailwind"; /* Tailwind v4 + base, legacy tokens, legacy component CSS */
@import "@opencode/ui/styles/tokens"; /* v2 primitives and semantic tokens */
```

Use `@opencode/ui/styles` instead of `styles/tailwind` when the product does not use Tailwind.

## Styling model

- A component root has `data-component="<name>"` (v2 names usually end in `-v2`, for example `button-v2`, `text-input-v2`). Inner parts have `data-slot="<name>-<part>"`. Options are `data-variant`, `data-size`, `data-appearance`; boolean states are empty attributes such as `data-invalid=""` or `data-disabled=""`.
- CSS selects on these attributes: `[data-component="text-input-v2"][data-invalid] [data-slot="text-input-v2-input"]`. Kobalte state attributes (`data-expanded`, `data-highlighted`, `data-checked`) are part of the contract.
- Component CSS uses only v2 tokens. Product code can use the generated Tailwind utilities (`bg-v2-background-bg-base`, `text-v2-text-text-muted`) or plain CSS with the same tokens.
- Customize a component with `class`/`classList` or a wrapper selector. Do not copy its CSS and do not restyle its slots from a product stylesheet.

## Providers

| Provider | Import | Needed for |
| --- | --- | --- |
| `ThemeProvider` | `@opencode/ui/theme` (or `@opencode/ui/theme/context`) | Theme CSS, `html[data-theme]`, `html[data-color-scheme]`. Required for correct colors outside the default OC-2 light/dark static CSS. |
| `I18nProvider` | `@opencode/ui/context/i18n` | Localized default labels. Without it, components fall back to English. |
| `DialogProvider` | `@opencode/ui/context/dialog` | `useDialog()` stacks and `Dialog`. |
| `MarkedProvider` | `@opencode/ui/context/marked` | Markdown rendering. |
| `FileComponentProvider` | `@opencode/ui/context/file` | File and diff viewers. |

Also render `<Font />` from `@opencode/ui/font` once to load Inter and the mono font. See `AppBaseProviders` in `packages/app/src/app.tsx` for the reference tree.

## Rules

1. Reuse an existing `@opencode/ui` component before you write new markup. Check [components.md](../opencode-ui-components/references/components.md) first.
   **Why:** Every copy drifts from the design system and misses theme, RTL, and a11y fixes.
2. Put new design-system components in a category folder with co-located `.tsx`, `.css`, and `.stories.tsx`, and add a subpath export.
   **Why:** `src/components` is legacy and has no per-component CSS import.
3. Use v2 semantic tokens for every color, border, shadow, and overlay. Never use raw colors or legacy v1 tokens in new code.
   **Why:** Only v2 semantic tokens follow all 36 themes and both color schemes.
4. Style with `data-component`/`data-slot`/`data-variant` attribute selectors, not new class names.
   **Why:** Consumers and tests target the attribute contract.
5. Use logical CSS properties and `useI18n()` keys for all user-visible text.
   **Why:** The UI ships in many locales, including RTL.
6. Verify in light, dark, and one non-default theme before you finish.
   **Why:** Most color bugs only show in dark mode or in a custom theme.

## Golden examples

Copy patterns from these components. They use only v2 tokens, logical properties, and a clean `data-*` contract.

1. **`TextInput`** (`src/forms/text-input/`): documented props, boolean states as empty `data-*` attributes, `padding-inline`, `--line-height-compact`, i18n fallback labels (`ui.common.clear`), and a story with a docs block.
2. **`IconButton`** + `src/actions/submit.css`: small prop surface mapped straight to `data-size`/`data-variant`/`data-state`; `submit.css` is the reference for the rare justified `[data-color-scheme="dark"]` override.
3. **`Dialog`** (`src/overlays/dialog/`): compound API (`DialogHeader`, `DialogTitle`, `DialogBody`, `DialogFooter`) over Kobalte, scrim and `--v2-elevation-overlay` tokens, localized close label.
4. **`Divider`** (`src/layout/divider/`): the minimal shape of a v2 component: forwards native props, merges `class`/`classList`, sets `role="separator"`, and uses one semantic token (`--v2-border-border-strong`).

Do not use `Switch`, `Checkbox`, `Badge`, `Menu`, `Tabs` (`tabs.css`), or `TextShimmer` as style references yet. They still contain legacy tokens.

## How to verify

```sh
bun run --cwd packages/ui lint:design <changed files>   # design lint rules
bun run --cwd packages/ui typecheck                     # or the consumer package's typecheck
bun run --cwd packages/ui test                          # unit tests under src
bun run --cwd packages/storybook storybook              # stories at http://localhost:6006
```

Storybook loads every `*.stories.tsx` under `packages/ui/src`, `packages/session-ui/src`, `packages/app/src`, and `packages/gui-extensions/src`. Use the toolbar to switch light/dark, direction (LTR/RTL), and locale.

## Checklist

- [ ] I reused an existing component or extended it through props, `class`, or a new `data-variant`.
- [ ] New components live in a category folder with `.tsx`, `.css`, `.stories.tsx`, and a subpath export.
- [ ] All colors are v2 semantic tokens (see `opencode-ui-tokens`).
- [ ] No color-scheme selectors except `[data-color-scheme="dark"]` (see `opencode-ui-theming`).
- [ ] Text uses the shared type metrics (see `opencode-ui-typography`).
- [ ] Text is localized and CSS is direction-neutral (see `opencode-ui-i18n-rtl`).
- [ ] `lint:design` and typecheck pass; I checked light, dark, RTL, and one non-default theme.

## Enforced by

- `design/no-raw-color`, `design/no-legacy-token`, `design/no-solid-line-height`, `design/dark-mode-selector`, `design/no-physical-direction`. Run `bun run --cwd packages/ui lint:design <files>`. Suppress one finding with `design-lint-allow <rule-id>: <reason>`.
- Component reuse, structure, and golden-example patterns are review only.
