# Spacing, sizing, and surface inventory

Observed values in `packages/ui/src` v2 component CSS and in `packages/app/src` / `packages/session-ui/src` screens. Use this to match an existing pattern. The rules are in `../SKILL.md`.

## Tokens that exist

| Token | Value | File | Tailwind |
| --- | --- | --- | --- |
| `--spacing` | `0.25rem` (4px) | `src/styles/theme.css`, `src/styles/tailwind/index.css` | base of every numeric spacing class (`gap-2` = 8px) |
| `--radius-xs` / `-sm` / `-md` / `-lg` / `-xl` | 2 / 4 / 6 / 8 / 10 px | `src/styles/theme.css` | `rounded-xs` … `rounded-xl` |
| `--v2-elevation-raised`, `-floating`, `-overlay`, `-button-neutral`, `-button-contrast`, `-elements`, `-switch-off`, `-switch-on` | shadow stacks with a 0.5px ring | `src/styles/tokens/theme.css` | `shadow-[var(--v2-elevation-…)]` |
| `--v2-background-bg-deep`, `-bg-base`, `-bg-layer-01` … `-bg-layer-04` | greys, inverted in dark | `src/styles/tokens/theme.css` | `bg-v2-background-bg-…` |
| `--breakpoint-sm` … `-2xl` | 40 / 48 / 64 / 80 / 96 rem | `src/styles/theme.css` | `sm:` `md:` `lg:` `xl:` `2xl:` |
| `--container-3xs` … `-7xl` | 16 … 80 rem | `src/styles/theme.css` | `max-w-*` |

No semantic spacing, control-height, or z-index tokens exist. Legacy `--shadow-xs`, `--shadow-md`, `--shadow-lg`, and `--shadow-*-border*` exist in `src/styles/theme.css`; only legacy `appearance="standard"` styles use them.

## Frequency in v2 component CSS

Counted across `src/{actions,data-display,feedback,forms,layout,navigation,overlays,typography}/**/*.css`.

| Property | Values (count) |
| --- | --- |
| `gap` | 8px (21), 4px (14), 6px (6), 12px (6), 3px (3), 2px (1), 0 (3) |
| `padding` (shorthand) | 0 (29), 2px (6), 12px (5), 4px (4), 0 12px (4), 0 6px (3), 8px (2), 4px 8px (2), 16px (2), 0 4px (2) |
| `border-radius` | 6px (15), 4px (15), 2px (9), `--radius-sm` (4), 9999px (3), 3px (2), `--radius-md` (2), 8px (1) |
| `height` | 16px (20), 28px (15), 20px (11), 32px (5), 24px (4), 14px (2), 48px (2), 52px (2) |

## Frequency in app and session-ui Tailwind classes

| Class family | Values (count) |
| --- | --- |
| `gap-*` | `gap-2` (91), `gap-1` (41), `gap-4` (38), `gap-1.5` (27), `gap-3` (19), `gap-5` (9), `gap-6` (5), `gap-0.5` (5), `gap-px` (4) |
| padding | `px-3` (43), `px-2` (22), `p-6` (18), `px-4` (17), `px-6` (14), `px-1` (12), `px-1.5` (11), `pb-3` (8) |
| `h-*` | `h-7` (42), `h-10` (9), `h-12` (8), `h-6` (7), `h-4` (7), `h-9` (6), `h-8` (6) |
| `rounded-*` | `rounded-[6px]` (29), `rounded-md` (22), `rounded-sm` (18), `rounded-full` (12), `rounded-lg` (10), `rounded-[10px]` (8), `rounded-[4px]` (7), `rounded-xl` (5) |
| `shadow-*` | `--v2-elevation-raised` (10), `--v2-elevation-floating` (6), inset 0.5px `--v2-border-border-base` ring (2), `--v2-elevation-button-neutral` (1) |
| `bg-v2-background-*` | `bg-base` (27), `bg-layer-02` (17), `bg-layer-01` (11), `bg-deep` (9), `bg-layer-03` (7), `bg-layer-04` (3) |

## Per component

| Component | Height | Padding | Gap | Radius | Surface / elevation |
| --- | --- | --- | --- | --- | --- |
| `Button` small / normal / large | 24 / 28 / 32 | inline 9 / 11 / 15 | 6 | 4 / 6 / 6 | `bg-button-neutral` + `elevation-button-neutral` (neutral) |
| `IconButton` small / normal / large | 20 / 24 / 28 (square) | 0 | — | 4 / 6 / 6 | as `Button` |
| `SplitButton` | 28 (action 28 wide, trigger 20 wide) | 0 | 0 | 6 | transparent; 1px inset ring on hover |
| `TextInput` base / large | 28 / 32 | inline-end 8; value inline-start 8 | 8 (leading icon 6) | 6 | `bg-base` + `elevation-button-neutral` |
| `Textarea` | min 80 | 8 | — | 6 | `bg-base` |
| `Select` trigger | 28 | inline-end 6; value inline-start 8 | 8 | 6 | `bg-base` |
| `Select` list / item | item 24 | list 4; item 4 / 8 4 | 4 | list 6; item 4 | `bg-layer-01` + `elevation-floating` |
| `Field` | label row min 16 | 0 | label↔control 8; label row 4 | — | — |
| `Checkbox` / `Switch` / `Radio` | control 16 | — | label 12 / 8 / 8 | 4 / 4 / full | switch off track `bg-layer-04` |
| `SegmentedControl` | 28 | item 0 12 | 0 | 6 | track `bg-layer-01` + 0.5px ring; pressed `bg-base` |
| `Tabs` `line`/`pill` list | 32 | inline 8 (pill bottom 8) | 6 | pill items 24 high | active `bg-layer-03` |
| `Menu.Content` / `Menu.Item` | item 28; group label 28 | content 2; item 0 12, inline-end 6 | 8 | content 6; item 4 | `bg-layer-01` + `elevation-floating` |
| `Tooltip` compact / large | — | 5 6 / 12 | 6 | 4 | `bg-layer-01` + `elevation-floating` |
| `Dialog` | 368 / 480 / up to 600 (`fit`: auto) | header 16; footer 16 | footer 8; title group 4 | 6 | `bg-layer-01` + `elevation-overlay`; scrim `overlay-simple-overlay-scrim` |
| Toast | — (width 320) | 12 | 12 | 8 | `bg-layer-01` + `elevation-floating` |
| `Badge` | 16 | 0 4 | 4 | 2 | `bg-layer-02` + 0.5px `border-base` |
| `Keybind` key | 14 (min width 14) | inline 4 | keys 2 | 2 | `bg-layer-03` (neutral) |
| `Avatar` small / normal / large | 16 / 20 / 28 | — | — | full (org: 4 / 4 / 6) | `bg-layer-02` fallback |
| `Accordion` trigger | 32 | 8 12 | — | `--radius-lg` (legacy) | `bg-base` / `bg-layer-01` |
| `Divider` | 1px scaled to 0.5px | — | — | — | `border-strong` |
| `Menu.Separator` | 1px | — | — | — | `border-muted` |

## App screens

| Pattern | Values | Source |
| --- | --- | --- |
| Window shell | `bg-deep`; titlebar `h-9` (36px) | `packages/app/src/shell/shell.tsx`, `shell/titlebar/titlebar.tsx` |
| Pane inset from shell | 8px (`--shell-top-inset`, `--shell-bottom-inset`, `mx-2`) | `packages/app/src/home/route.tsx`, `settings/settings.css` |
| Pane surface | radius 10px, `bg-base`, `elevation-raised` | `new-session/view.tsx`, `session/screen.tsx`, `runtime/extension/side-region.tsx`, `settings/settings.css` |
| Settings page | max width 1048px; inline padding 20px (catalog lists 16px) | `packages/app/src/settings/settings.css` |
| Settings row | block padding 20px (16px in catalog lists); gap 16px; 0.5px `border-base` bottom rule | `packages/app/src/settings/settings.css` |
| Settings group card | radius 8px, `bg-base`, `elevation-raised`, block padding 8px | `packages/app/src/settings/settings.css` |
| Titlebar tab | `h-7`, `gap-1.5`, `px-1.5`, radius 6px | `packages/app/src/shell/titlebar/tab-nav.tsx` |
| Home list row | `h-10`, radius 6px | `packages/app/src/home/projects/view.tsx`, `home/sessions/view.tsx` |
| Home project popover | radius 10px, `bg-base`, `p-1.5`, `elevation-floating`, `gutter={6}` | `packages/app/src/home/projects/view.tsx` |
| Command palette | radius 12px, `bg-base`, `elevation-floating` (restyles `dialog-v2`) | `packages/app/src/shell/commands/dialog.css` |
| Tab preview hover card | radius 6px, padding 12px, `bg-base`, `elevation-floating` | `packages/app/src/shell/titlebar/tab-popover.css` |
| Popup gutter | `Menu` 4px; `Select` and popovers 6px; `Tooltip` 4px (default) | consumer props |

## Pane widths and breakpoints

| Value | Meaning | Source |
| --- | --- | --- |
| 450px | Minimum session chat panel width | `packages/app/src/session/session-panel-width.ts` |
| 480px / 800px | Minimum review pane width (single / split) | same |
| `@container settings-panel (max-width: 520px)` | Settings content collapses to one column | `packages/app/src/settings/settings.css` |
| `@container settings-screen (max-width: 799px)` / `(min-width: 800px)` | Settings sidebar layout switch | same |
| `@media (max-width: 767px)` / Tailwind `md:` | Whole-window mobile layout | `settings/settings.css`, app `md:` classes |

## Scroll containers

`ScrollView` (`src/components/scroll-view.tsx`, CSS in `src/components/scroll-view.css`):

- Root: `.scroll-view` (`display: flex; flex-direction: column; min-height: 0; overflow: hidden`). Your `class` goes here.
- Viewport: `.scroll-view__viewport` (`flex: 1 1 auto; min-height: 0; overflow-y: auto`), with `tabIndex={0}`, `role="region"`, and `aria-label` from `ui.scrollView.ariaLabel`. Children render inside it. Use `viewportRef` to reach it.
- Native scrollbars are hidden; a custom thumb shows on hover or scroll (`thumbVisibility` `hover` | `scroll`). `thumbContainer` and `thumbHoverTarget` move the thumb or its hover target.
- `orientation`: `vertical` (default behavior), `horizontal`, `both`.
- Keyboard: Up/Down arrows, Page Up/Down, Space/Shift+Space, Home, and End scroll the viewport.
