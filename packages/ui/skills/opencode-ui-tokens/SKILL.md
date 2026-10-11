---
name: OpenCode UI Tokens
description: Use when you choose or change a color, background, border, shadow, hover or pressed overlay, or status color in @opencode/ui, app, desktop, or session-ui CSS or Tailwind classes; when you replace raw colors or legacy tokens (--surface-*, --text-strong, --border-weak-*, --icon-*); or when you need a token that does not exist yet.
---

# OpenCode UI Tokens

> Design rules in this skill come from the design system owner. Fix facts (paths, prop names, token names) directly. To change a rule, record design feedback with `/design-feedback`.

Color in OpenCode comes from v2 semantic tokens named `--v2-<group>-<role>-<variant>`, defined in `packages/ui/src/styles/tokens/theme.css`. Every token, with its light and dark OC-2 values and Tailwind availability, is in [references/tokens.md](references/tokens.md). Import the tokens with `@import "@opencode/ui/styles/tokens";`.

## Roles

Choose a token by what the element **is**, not by what color you want.

| Group | Tokens | Use for |
| --- | --- | --- |
| Background | `bg-base` | The main app or page surface. Inputs sit on it (`TextInput`). |
| | `bg-deep` | A recessed area behind `bg-base`. |
| | `bg-layer-01` … `bg-layer-04` | Surfaces stacked above base: `01` panels and dialogs (`Dialog`), `02`–`04` progressively stronger fills inside them (keycaps, tracks, loading buttons). |
| | `bg-button-neutral`, `bg-contrast`, `bg-icon-button-contrast` | Neutral buttons; high-contrast filled buttons; contrast and submit icon buttons. |
| | `bg-inverse` | An inverted surface (dark on light, light on dark). |
| | `bg-accent` | Selected or "on" fills (`Switch` on, `RadioItem` checked). |
| | `bg-code-path` | Inline code path chips. |
| Text | `text-base`, `text-muted`, `text-faint` | Primary, secondary, and tertiary text (`text-faint` also for placeholders). |
| | `text-inverse`, `text-contrast` | Text on `bg-inverse`; text on `bg-contrast`. |
| | `text-accent`, `text-accent-hover` | Links and accent text. |
| | `text-code-accent`, `text-code-path` | Code highlights and code paths. |
| Icon | `icon-base`, `icon-muted`, `icon-faint`, `icon-inverse`, `icon-contrast`, `icon-accent`, `icon-accent-hover` | Icons. Match the icon level to the text level next to it. |
| Border | `border-muted`, `border-base`, `border-strong` | Hairlines and outlines, from subtle to emphasized. |
| | `border-inverse`, `border-focus` | Borders on inverse surfaces; focus rings (`outline: 2px solid var(--v2-border-border-focus)`). |
| Overlay | `simple-overlay-hover`, `simple-overlay-pressed` | Hover and pressed layers painted **over** any surface. |
| | `simple-overlay-contrast-hover`, `simple-overlay-contrast-pressed` | Hover and pressed layers over `bg-contrast` surfaces. |
| | `simple-overlay-scrim` | Modal backdrops (`dialog-overlay`). |
| | `gradient-depth-overlay-depth-top`/`-bot`, `simple-tab-*-scrim` | Control depth gradients; tab edge fades. |
| State | `state-{bg,fg,border}-{success,warning,danger,info}` | Outcome and status feedback only: errors, warnings, success, info, invalid inputs. |
| Agent | `agent-{plan,build,explore}-{solid,border,background}`, `agent-{review,writer}-solid` | Agent identity only. |
| Avatar | `avatar-fg`, `avatar-{bg,border}-<hue>` | `ProjectAvatar` colors only. Fixed per scheme, not themed. |
| Elevation | `elevation-raised`, `elevation-floating`, `elevation-overlay` | `box-shadow` for raised surfaces; menus, tooltips, and popovers; dialogs. |
| | `elevation-button-neutral`, `elevation-button-contrast`, `elevation-elements`, `elevation-switch-off`/`-on` | Component-specific shadows. Use them only on the matching control type. |
| Illustration | `illustration-layer-01` … `-03` | Fills in illustrations and empty-state art. |

Full names add the group prefix: `--v2-background-bg-base`, `--v2-text-text-muted`, `--v2-overlay-simple-overlay-hover`, `--v2-state-fg-danger`.

## Rules

1. Use a v2 semantic token for every color, border color, shadow, and overlay. Never write hex, `rgb()`, `hsl()`, `oklch()`, or named colors (`white`, `black`) in component or product CSS, inline styles, or Tailwind arbitrary values.
   **Why:** Raw colors do not change with the 36 themes or the color scheme.
2. Choose by role, not by appearance. If `--v2-state-fg-danger` happens to look like the red you want for a non-error accent, do not use it.
   **Why:** Themes remap each role independently; borrowed tokens break when a theme changes that role.
3. Do not use legacy v1 tokens (`--surface-*`, `--text-strong`, `--text-weak`, `--border-weak-base`, `--icon-*`, `--background-*`, `--input-*`, `--button-*`, `--syntax-*`, `--markdown-*`, palette scales like `--gray-light-*`) in new or changed code. Migrate them when you touch a declaration (see [Legacy migration](#legacy-migration)).
   **Why:** v1 tokens are frozen and will be removed.
4. Do not use hue primitives (`--v2-grey-300`, `--v2-blue-600`) in components. Use `--v2-alpha-light-*`/`--v2-alpha-dark-*` only for sheen and highlight gradients on top of a semantic fill, as `Button` `contrast` and `TextInput` do.
   **Why:** Primitive steps mean different things per theme and per scheme; only semantic tokens carry intent.
5. Show hover and pressed states by layering `--v2-overlay-simple-overlay-hover`/`-pressed` over the existing fill. Do not pick a second background token for hover.
   **Why:** One overlay works on every surface and every theme.
6. Use `state-*` tokens only for feedback and `agent-*` tokens only for agent identity.
   **Why:** These roles carry meaning; using them for decoration confuses users.
7. Use `--v2-elevation-*` for shadows on v2 surfaces. Do not build shadows from raw `rgba()`.
   **Why:** Elevation tokens differ per scheme (dark mode adds a light top edge).
8. When no role fits, do not improvise. Add a token (see [Add a token](#add-a-token)) and record the need with `/design-feedback`.
   **Why:** Ad-hoc values fork the palette.

## Tailwind

`src/styles/tailwind/colors.css` resets the default palette (`--color-*: initial`), so `bg-white` or `text-gray-500` do not exist. Use the generated v2 utilities: `bg-v2-background-bg-layer-01`, `text-v2-text-text-muted`, `border-v2-border-border-base`, `bg-v2-overlay-simple-overlay-hover`. The **Tailwind** column in [references/tokens.md](references/tokens.md) shows which tokens have utilities. For tokens without one, use an arbitrary value with the variable: `shadow-[var(--v2-elevation-floating)]`.

## Do / Don't

```css
/* Do: text-input.css */
[data-component="text-input-v2"]:where(:focus-within):not([data-disabled], [data-invalid]) {
  outline-color: var(--v2-border-border-focus);
}
[data-component="text-input-v2"]:where([data-invalid]):not([data-disabled]) {
  outline-color: var(--v2-state-fg-danger);
}

/* Don't */
[data-component="text-input-v2"]:focus-within {
  outline-color: #3b5cf6;
}
```

```css
/* Do: hover as an overlay (button.css, ghost variant) */
[data-component="button-v2"][data-variant="ghost"]:hover:not(:disabled) {
  background-color: var(--v2-overlay-simple-overlay-hover);
}

/* Don't: a second surface token, or a legacy token */
[data-component="button-v2"][data-variant="ghost"]:hover {
  background-color: var(--surface-base-hover);
}
```

```tsx
// Do
<div class="bg-v2-background-bg-layer-01 text-v2-text-text-muted border border-v2-border-border-base" />

// Don't
<div class="bg-[#fafafa] text-surface-raised-base" style={{ color: "rgba(0,0,0,0.5)" }} />
```

## Legacy migration

Use this table when you touch legacy declarations. Rows marked **real** come from the OC-2 theme (`src/theme/themes/oc-2.json`, which points these v1 tokens at v2 tokens). Rows marked **suggested** are role matches, not code mappings. Check them visually in light and dark, and ask the designer when the result changes visibly.

| Legacy (v1) | v2 | Source |
| --- | --- | --- |
| `--text-diff-add-base` | `--v2-state-fg-success` | real |
| `--text-diff-delete-base` | `--v2-state-fg-danger` | real |
| `--syntax-comment` | `--v2-text-text-muted` | real |
| `--text-strong`, `--text-stronger` | `--v2-text-text-base` | suggested |
| `--text-base` | `--v2-text-text-muted` | suggested |
| `--text-weak`, `--text-weaker` | `--v2-text-text-faint` | suggested |
| `--text-interactive-base` | `--v2-text-text-accent` | suggested |
| `--text-invert-*` | `--v2-text-text-inverse` | suggested |
| `--icon-strong-base` | `--v2-icon-icon-base` | suggested |
| `--icon-base` | `--v2-icon-icon-muted` | suggested |
| `--icon-weak-base` | `--v2-icon-icon-faint` | suggested |
| `--background-base` | `--v2-background-bg-base` | suggested |
| `--surface-raised-base`, `--surface-float-base` | `--v2-background-bg-layer-01` | suggested |
| `--surface-base-hover`, `--surface-raised-base-hover` | `--v2-overlay-simple-overlay-hover` (layered) | suggested |
| `--surface-base-active`, `--surface-raised-base-active` | `--v2-overlay-simple-overlay-pressed` (layered) | suggested |
| `--border-weaker-base` | `--v2-border-border-muted` | suggested |
| `--border-weak-base`, `--border-base` | `--v2-border-border-base` | suggested |
| `--border-strong-base` | `--v2-border-border-strong` | suggested |
| `--border-focus`, `--border-interactive-focus` | `--v2-border-border-focus` | suggested |
| `--surface-{success,warning,critical,info}-base` | `--v2-state-bg-{success,warning,danger,info}` | suggested |
| `--text-on-{success,warning,critical,info}-base`, `--icon-{success,warning,critical,info}-base` | `--v2-state-fg-{success,warning,danger,info}` | suggested |
| `--border-{success,warning,critical,info}-base` | `--v2-state-border-{success,warning,danger,info}` | suggested |

Leave legacy tokens with no row (diff surfaces, `--syntax-*`, `--markdown-*`, `--avatar-*`) unchanged and record the gap with `/design-feedback`.

## Add a token

Only after the designer agrees that no role fits:

1. Name it `--v2-<group>-<role>-<variant>` in an existing group.
2. Add it to all three blocks in `src/styles/tokens/theme.css`: `:root`, `[data-color-scheme="light"]`, and `[data-color-scheme="dark"]`. Reference primitives (`var(--v2-grey-400)`), not hex.
3. Add the light and dark fallback to `src/theme/v2/mapping.ts`. Non-OC-2 themes and custom themes use this mapping. Text and icon contrast levels are derived in `src/theme/v2/foreground.ts` instead.
4. Run `bun run generate:v2-oc2` in `packages/ui` to copy the new values into the OC-2 theme's `v2Overrides`.
5. For a Tailwind utility, add the declaration line to `script/colors.txt` and run `bun run generate:tailwind`.
6. Add a test in `src/theme/v2/resolve.test.ts` that a theme without `v2Overrides` gets the fallback in both schemes.
7. Regenerate [references/tokens.md](references/tokens.md) with `bun script/generate-skill-references.ts`.

## Checklist

- [ ] No hex, `rgb()`, `hsl()`, `oklch()`, or named colors in my CSS, Tailwind classes, or inline styles.
- [ ] No legacy v1 color tokens in lines I added or changed.
- [ ] Each token matches the element's role (state for feedback, agent for agents, overlay for hover/pressed).
- [ ] Shadows use `--v2-elevation-*`.
- [ ] A new token exists in all three CSS blocks, in `mapping.ts`, in OC-2 `v2Overrides`, and in the reference file.
- [ ] I checked the result in light and dark.

## Enforced by

- `design/no-raw-color`: flags literal colors. `design/no-legacy-token`: flags v1 color tokens. Run `bun run --cwd packages/ui lint:design <files>`. Suppress a justified case on the declaration: `/* design-lint-allow design/no-raw-color: <reason> */`.
- Role choice, primitive use, and the hover-overlay pattern are review only.
