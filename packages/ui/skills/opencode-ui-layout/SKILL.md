---
name: OpenCode UI Layout
description: Use when you set spacing, gaps, padding, control or row heights, corner radius, shadows, surface backgrounds, dividers, scroll areas, resizable panes, z-index, or narrow-width behavior in @opencode/ui, app, desktop, or session-ui code.
---

# OpenCode UI Layout

> Design rules in this skill come from the design system owner. Fix facts (paths, prop names, token names) directly. To change a rule, record design feedback with `/design-feedback`.

Paths are relative to `packages/ui` unless they start with `packages/`. The full inventory of observed values, by component and screen, is in [references/spacing.md](references/spacing.md).

## The scales at a glance

**Spacing has no semantic tokens.** The only spacing token is Tailwind's base unit `--spacing: 0.25rem` (4px) in `src/styles/theme.css` and `src/styles/tailwind/index.css`. v2 component CSS writes px values. Use this observed scale:

| px | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tailwind | `0.5` | `1` | `1.5` | `2` | `3` | `4` | `5` | `6` |
| Typical use | hairline groups, menu content padding | icon–text in small parts, label rows | button icon gap, tab gap | default gap, control padding | section gap, menu item inline padding | dialog padding, row gap | settings page inline padding | page padding (`p-6`) |

**Control heights** (density is compact desktop): 16px (badge, checkbox, switch), 20px (`IconButton small`, close buttons), 24px (`Button small`, `IconButton normal`), **28px default** (`Button normal`, `IconButton large`, `TextInput base`, `Select`, `Menu.Item`, `SegmentedControl`, `SplitButton`, app rows `h-7`), 32px (`Button large`, `TextInput large`, tab list), 36px (titlebar `h-9`), 40px (home list rows `h-10`).

**Radius tokens** (`src/styles/theme.css`, Tailwind `rounded-*`): `--radius-xs` 2px, `--radius-sm` 4px, `--radius-md` 6px, `--radius-lg` 8px, `--radius-xl` 10px. v2 component CSS writes the same values in px.

| Radius | Element |
| --- | --- |
| 2px | Badge, keybind key, checkbox and switch inner marks |
| 4px | Small controls (`Button small`, `IconButton small`), menu and select items, tooltip, dialog close button |
| 6px | Controls, inputs, `Select` trigger and list, `Menu.Content`, `Dialog`, `SegmentedControl`, `SplitButton`, line comment |
| 8px | Toast, settings groups inside a page |
| 10px | App panes and page surfaces (session, home, settings, side panel), app popovers |
| 9999px | Avatars, radio, pills |

**Elevation** (`src/styles/tokens/theme.css`; Tailwind `shadow-[var(--v2-elevation-…)]`):

| Token | Surface |
| --- | --- |
| `--v2-elevation-raised` | Panes and cards that sit on the shell: session/home/settings panes, side panel, settings groups, line comment, dock |
| `--v2-elevation-floating` | Anchored, non-modal overlays: `Menu`, `Select` list, `Tooltip`, toast, popovers, hover cards |
| `--v2-elevation-overlay` | Modal `Dialog` |
| `--v2-elevation-button-neutral` / `-button-contrast` | `Button`/`IconButton` neutral and contrast/submit; `TextInput` resting state |
| `--v2-elevation-elements`, `--v2-elevation-switch-off`, `--v2-elevation-switch-on` | Small inner marks and `Switch` |

**Surface layering** (`--v2-background-bg-*`): `bg-deep` (window shell, titlebar, sidebar gutter) → `bg-base` (panes, inputs, pressed segment) → `bg-layer-01` (`Dialog`, `Menu`, `Select` list, `Tooltip`, toast, segmented track, hover on base) → `bg-layer-02` (`Badge`, avatar fallback, loading button) → `bg-layer-03` (keybind key, active tab) → `bg-layer-04` (switch off track, progress track).

## Rules

1. Use only values from the spacing scale above (2, 4, 6, 8, 12, 16, 20, 24 px, then multiples of 8). In Tailwind, use the matching numeric classes (`gap-2`, `px-3`), not arbitrary values (`gap-[10px]`).
   **Why:** There are no spacing tokens, so the scale is the only thing that keeps screens aligned.
2. Space siblings with `gap` on a flex or grid parent. Do not use margins between siblings.
   **Why:** `gap` does not collapse, does not need first/last exceptions, and is direction-neutral.
3. Use logical properties for every inline value: `padding-inline`, `margin-inline-start`, `inset-inline-end`, `border-inline-start`, Tailwind `ps-*`/`pe-*`/`ms-*`/`me-*`/`start-*`/`end-*`/`text-start`.
   **Why:** The UI ships right-to-left locales; physical values break mirroring.
4. Make interactive rows and controls one of the control heights above, with 28px as the default. Set the height explicitly (`height: 28px`, `h-7`); do not derive it from padding plus line height.
   **Why:** Explicit heights keep rows, buttons, and inputs aligned on one baseline.
5. Pick radius by element type from the table. A child inside a rounded container uses a smaller radius than its parent (for example 4px items in a 6px menu, 6px controls in a 10px pane).
   **Why:** Nested radii that match or grow look misaligned.
6. Use `rounded-sm`/`rounded-md`/`rounded-lg`/`rounded-xl` in Tailwind, not `rounded-[4px]`/`rounded-[6px]`/`rounded-[8px]`/`rounded-[10px]`.
   **Why:** They are the same values; the token class lets the scale change in one place.
7. Pair surface and elevation: panes use `bg-base` + `--v2-elevation-raised`; anchored overlays use `--v2-elevation-floating`; modal dialogs use `--v2-elevation-overlay`. Never use legacy `--shadow-*` tokens or a raw `box-shadow` in new UI.
   **Why:** Elevation tokens carry the 0.5px edge ring and the dark-mode values.
8. Step one layer up for each nested surface (`bg-base` → `bg-layer-01` → `bg-layer-02`). Do not skip layers or put a lower layer on a higher one.
   **Why:** Layers are the only depth cue in flat areas, and they invert correctly in dark mode.
9. Separate content with `gap` and whitespace first. Use `Divider` (`@opencode/ui/divider`) for a full-width horizontal rule between regions, and `Menu.Separator` inside menus. Do not build rules from `border-top` on arbitrary elements.
   **Why:** One divider component keeps the hairline weight and color the same everywhere.
10. Wrap every custom scroll area in `ScrollView` (`@opencode/ui/scroll-view`). Give it `min-h-0` (and `flex-1` or a `max-h-*`) inside a flex column. Put content padding and gaps on a child element, not on `ScrollView`.
    **Why:** `ScrollView` draws the themed thumb, adds keyboard scrolling and a labeled `role="region"`, and its `class` sets the outer frame, not the scrolling content.
11. Give every flex child that holds text or a scroll area `min-width: 0` / `min-height: 0` (`min-w-0`, `min-h-0`).
    **Why:** Flex items do not shrink below their content size without it, so text cannot truncate and scroll areas grow instead of scrolling.
12. Respond to pane width with container queries (`container-type: inline-size` and `@container`), not viewport media queries. Use viewport breakpoints (`md:` = 768px) only for the whole-window mobile layout.
    **Why:** Desktop panes resize independently of the window.
13. Keep z-index local: use small values (1–3) only to order siblings inside one component, and never to place content relative to overlays. Overlays already use fixed layers: `Dialog` 50, `Menu`/`Select` popups 60, `Tooltip` and toast 1000, `ResizeHandle` 10.
    **Why:** Ad-hoc z-index puts content above menus or under dialogs.

## Do / Don't

```tsx
// Do: pane surface on the shell (packages/app/src/new-session/view.tsx, with the token class)
<div class="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">

// Don't: arbitrary radius, legacy shadow, physical padding
<div class="rounded-[12px] shadow-md pl-3 pr-5">
```

```tsx
// Do: scroll area in a flex column, content spacing on a child
<div class="flex min-h-0 flex-1 flex-col">
  <ScrollView class="min-h-0 flex-1">
    <div class="flex flex-col gap-2 p-3">…</div>
  </ScrollView>
</div>

// Don't: padding and gap on ScrollView, no min-h-0
<ScrollView class="flex flex-col gap-2 p-3">…</ScrollView>
```

```css
/* Do: gap, logical padding, explicit height */
.row { display: flex; align-items: center; gap: 8px; height: 28px; padding-inline: 12px 6px; }

/* Don't: sibling margins, physical padding, implicit height */
.row > * + * { margin-left: 8px; }
.row { padding: 6px 6px 6px 12px; }
```

## Panes and narrow widths

- The shell is `bg-deep`. Panes inset 8px from the shell edges (`--shell-top-inset`, `--shell-bottom-inset` default 8px; `mx-2`) and use radius 10px, `bg-base`, and `--v2-elevation-raised`.
- Resizable panes use `ResizeHandle` (`direction`, `edge`, `size`, `min`, `max`, `onResize`, `onCollapse`, `collapseThreshold`). The session chat panel minimum is 450px; the review pane keeps at least 480px (800px when split). See `packages/app/src/session/session-panel-width.ts`.
- Panes declare `container-type: inline-size` (`#review-panel` in `packages/app/src/index.css`, `container: settings-screen / inline-size` in `packages/app/src/settings/settings.css`). Settings collapses at `@container settings-panel (max-width: 520px)` and `settings-screen (max-width: 799px)`.
- At narrow widths, truncate single-line text (`min-w-0 truncate`), let toolbars hide secondary actions into a `Menu`, and let rows wrap (`flex-wrap`) rather than shrink controls below their height.

## Checklist

- [ ] All spacing values are on the scale; siblings use `gap`.
- [ ] Inline padding, margin, inset, and alignment are logical.
- [ ] Controls and rows use an explicit control height (28px default).
- [ ] Radius matches the element type and is smaller than its container.
- [ ] Surface and elevation are a matching pair of v2 tokens; no `--shadow-*`.
- [ ] Scroll areas use `ScrollView` with `min-h-0`; content spacing is on a child.
- [ ] Pane-level responsiveness uses container queries.
- [ ] z-index is local (1–3) or absent.

## Enforced by

- `design/no-physical-direction` (physical CSS properties and Tailwind classes), `design/no-legacy-token` (legacy `--surface-*` and other v1 color tokens; it does not flag `--shadow-*`), `design/no-raw-color` (raw colors in shadows and backgrounds). Run `bun run --cwd packages/ui lint:design <files>`.
- Spacing scale, heights, radius choice, legacy `--shadow-*` use, surface layering, scroll containers, and z-index: review only.
