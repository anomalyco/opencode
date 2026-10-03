# File diff color tokens and CSS variables

Inventory for this worktree's V2 web/desktop file viewer. Source inspection only; no colors or behavior changed. Includes diff-specific colors, syntax colors, and the selection/search/comment colors used inside the viewer—not every unrelated global app variable. Unified and split use the same color system.

## Main controls and their wiring

| Visual role | Renderer variable | OpenCode source |
|---|---|---|
| Neutral file background | `--diffs-bg` | `--opencode-diffs-bg`, falling back to `--color-background-stronger` (alias of `--background-stronger`) |
| Default text | `--fg` / `--diffs-fg` | Registered theme foreground: `--text-base`; syntax spans override it |
| Addition seed / gutter bar | `--diffs-addition-color` → `--diffs-addition-base` | `--syntax-diff-add` |
| Deletion seed / gutter bar | `--diffs-deletion-color` → `--diffs-deletion-base` | `--syntax-diff-delete` |
| Modified seed | `--diffs-modified-color` → `--diffs-modified-base` | `--syntax-diff-unknown` |
| Added row | `--diffs-bg-addition`, `--diffs-bg-addition-override` | Mix of neutral background and addition seed |
| Deleted row | `--diffs-bg-deletion`, `--diffs-bg-deletion-override` | Mix of neutral background and deletion seed |
| Added inline span | `--diffs-bg-addition-emphasis`, `--diffs-bg-addition-emphasis-override` | Alpha of addition seed |
| Deleted inline span | `--diffs-bg-deletion-emphasis`, `--diffs-bg-deletion-emphasis-override` | Alpha of deletion seed; softened on selected deletion rows |
| Folded “unmodified lines” row | `--diffs-bg-separator`, `--diffs-bg-separator-override` | Mix of neutral background and `--diffs-mixer` |
| Ordinary line numbers / fold text | `--diffs-fg-number`, `--diffs-fg-number-override` | Foreground/background mix |
| Selection background | `--diffs-selection-base` → `--diffs-bg-selection` | `--v2-background-bg-accent` |
| Selected line-number text | `--diffs-selection-number-fg` | `--v2-text-text-accent` |
| Comment annotation background | `--diffs-comment-bg` | Alpha of `--v2-background-bg-accent` |
| Search match / current match | CSS highlight backgrounds | Alpha of `--surface-warning-base` / `--surface-warning-strong` |

**Important:** `--surface-diff-add-*`, `--surface-diff-delete-*`, and `--surface-diff-hidden-*` exist in the global theme, but are not the direct row/inline/fold controls in the current Pierre rendering path. The older/custom separator CSS in `components/file.css` does use `--surface-diff-hidden-base` and `--surface-diff-hidden-strong`.

## OpenCode diff-specific theme tokens — complete families

Each name below is a CSS custom property. Theme JSON override keys omit the leading `--`. Tailwind's `--color-…` aliases are defined in `packages/ui/src/styles/tailwind/colors.css` (for example `--color-surface-diff-add-base` → `--surface-diff-add-base`); these are aliases, not separate color decisions.

### Surfaces

```text
--surface-diff-unchanged-base
--surface-diff-skip-base
--surface-diff-hidden-base
--surface-diff-hidden-weak
--surface-diff-hidden-weaker
--surface-diff-hidden-strong
--surface-diff-hidden-stronger
--surface-diff-add-base
--surface-diff-add-weak
--surface-diff-add-weaker
--surface-diff-add-strong
--surface-diff-add-stronger
--surface-diff-delete-base
--surface-diff-delete-weak
--surface-diff-delete-weaker
--surface-diff-delete-strong
--surface-diff-delete-stronger
```

### Text, icons, and highlighter diff seeds

```text
--text-diff-add-base
--text-diff-add-strong
--text-diff-delete-base
--text-diff-delete-strong
--icon-diff-add-base
--icon-diff-add-hover
--icon-diff-add-active
--icon-diff-delete-base
--icon-diff-delete-hover
--icon-diff-modified-base
--syntax-diff-add
--syntax-diff-delete
--syntax-diff-unknown
```

The built-in OpenCode theme maps `--syntax-diff-add` and `--text-diff-add-base` to `--v2-state-fg-success`, and their delete counterparts to `--v2-state-fg-danger`. Optional palette seeds `diffAdd` and `diffDelete` also exist for theme resolution; they are theme inputs, not CSS variable names, and built-in overrides can supersede generated results.

## Syntax foreground tokens

```text
--syntax-comment
--syntax-regexp
--syntax-string
--syntax-keyword
--syntax-primitive
--syntax-operator
--syntax-variable
--syntax-property
--syntax-type
--syntax-constant
--syntax-punctuation
--syntax-object
--syntax-success
--syntax-warning
--syntax-critical
--syntax-info
--syntax-unknown
```

`--syntax-unknown` is referenced by the registered highlighter, but no definition was found in the current UI theme sources: treat it as an unresolved reference, not an existing resolved theme token. `--syntax-success` is available globally, although not directly used by that registered theme's current token-color rules.

Built-in syntax overrides additionally reference `--v2-text-text-muted`, `--v2-pink-800`, `--v2-green-800`, `--v2-orange-800`, `--v2-purple-800`, and `--v2-red-800` (with separate dark/light resolutions). Other syntax tokens use the ordinary text tokens or theme-resolved colors.

## Pierre renderer color variables — complete relevant inventory

These come from the installed `@pierre/diffs` **1.5.1** stylesheet plus OpenCode's injected CSS. `*-override` variables are hooks; other variables include derived outputs and internal implementation details, not independent OpenCode theme tokens. Some optional hooks are unset by default.

| Group | Variables |
|---|---|
| Base | `--diffs-bg`, `--diffs-fg`, `--diffs-mixer`, `--opencode-diffs-bg`, `--bg`, `--fg` |
| Theme foreground/background variants | `--diffs-light`, `--diffs-dark`, `--diffs-light-bg`, `--diffs-dark-bg` |
| Neutral backgrounds | `--diffs-bg-buffer`, `--diffs-bg-buffer-override`, `--diffs-bg-context`, `--diffs-bg-context-override`, `--diffs-bg-context-gutter`, `--diffs-bg-context-gutter-override`, `--diffs-bg-separator`, `--diffs-bg-separator-override` |
| Number / conflict-marker foreground | `--diffs-fg-number`, `--diffs-fg-number-override`, `--diffs-fg-number-addition-override`, `--diffs-fg-number-deletion-override`, `--diffs-fg-conflict-marker`, `--diffs-fg-conflict-marker-override` |
| Addition seed | `--diffs-addition-base`, `--diffs-addition-color`, `--diffs-addition-color-override`, `--diffs-light-addition-color`, `--diffs-dark-addition-color` |
| Deletion seed | `--diffs-deletion-base`, `--diffs-deletion-color`, `--diffs-deletion-color-override`, `--diffs-light-deletion-color`, `--diffs-dark-deletion-color` |
| Modified seed | `--diffs-modified-base`, `--diffs-modified-color`, `--diffs-modified-color-override`, `--diffs-light-modified-color`, `--diffs-dark-modified-color` |
| Renderer fallback colors | `--diffs-added-light`, `--diffs-added-dark`, `--diffs-deleted-light`, `--diffs-deleted-dark`, `--diffs-modified-light`, `--diffs-modified-dark`, `--diffs-warning-light`, `--diffs-warning-dark` |
| Added row/gutter/inline | `--diffs-bg-addition`, `--diffs-bg-addition-override`, `--diffs-bg-addition-number-override`, `--diffs-bg-addition-emphasis`, `--diffs-bg-addition-emphasis-override` |
| Deleted row/gutter/inline | `--diffs-bg-deletion`, `--diffs-bg-deletion-override`, `--diffs-bg-deletion-number-override`, `--diffs-bg-deletion-emphasis`, `--diffs-bg-deletion-emphasis-override` |
| Selection | `--diffs-selection-base`, `--diffs-selection-number-fg`, `--diffs-bg-selection`, `--diffs-bg-selection-override`, `--diffs-bg-selection-number`, `--diffs-bg-selection-number-override`, `--diffs-bg-selection-text` |
| Hover | `--diffs-bg-hover-override`, `--diffs-hover-mix-target` |
| Comments / decoration | `--diffs-comment-bg`, `--diffs-annotation-bg`, `--diffs-decoration-bg`, `--diffs-decoration-bar-color` |
| Internal background pipeline | `--diffs-computed-decoration-bg`, `--diffs-computed-diff-line-bg`, `--diffs-computed-selected-line-bg`, `--diffs-computed-editor-active-line-bg`, `--diffs-computed-hovered-line-bg`, `--diffs-line-bg` |
| Internal mix targets | `--diffs-diff-line-mix-target`, `--diffs-selection-mix-target`, `--diffs-selection-emphasis-mix-target` |
| Per-token light/dark colors | `--diffs-token-light`, `--diffs-token-dark`, `--diffs-token-light-bg`, `--diffs-token-dark-bg` |
| Conflict backgrounds (library support; not exercised by the fixture) | `--conflict-bg-current-header-override`, `--conflict-bg-current-number-override`, `--conflict-bg-current-override`, `--conflict-bg-incoming-header-override`, `--conflict-bg-incoming-number-override`, `--conflict-bg-incoming-override` |

Related mix controls are **percentages, not colors**: `--mix-light`, `--mix-dark`, `--mix-deco-light`, `--mix-deco-dark`, `--mix-selection-light`, `--mix-selection-dark`, and `--diffs-editor-active-line-source-mix`.

## Other color tokens used inside the file viewer

- Text: `--text-base`, `--text-weak`, `--text-strong`.
- Background fallback: `--background-stronger`, `--color-background-stronger`; comment actions also use `--background-base`.
- Selection: `--v2-background-bg-accent`, `--v2-text-text-accent`.
- Search: `--surface-warning-base`, `--surface-warning-strong`.
- Custom fold UI: `--surface-diff-hidden-base`, `--surface-diff-hidden-strong`, `--icon-strong-base`; `--text-mix-blend-mode` affects compositing but is not a color.
- Comment controls: `--icon-interactive-base`, `--white`, `--surface-raised-stronger-non-alpha`, `--surface-base`, `--surface-raised-base-hover`, `--border-base`, `--text-weak`, `--text-strong`, `--background-base`.
- Comment shadows (composite shadow tokens, not single colors): `--shadow-xs`, `--shadow-xs-border-focus`, `--shadow-xxs-border`, `--shadow-xs-border-select`.

Typography, sizing, gaps, gutter widths, font weight/style, and text-decoration variables are deliberately excluded from this color inventory.

## Source locations

- `packages/session-ui/src/pierre/index.ts`: viewer color overrides, selection, search, comment tint.
- `packages/ui/src/context/marked-theme.tsx`: registered foreground/background, diff seeds, syntax mappings.
- `packages/ui/src/theme/resolve.ts`: global diff/syntax token generation.
- `packages/ui/src/theme/themes/oc-2.json`: built-in light/dark mappings.
- `packages/ui/src/styles/theme.css` and `styles/tailwind/colors.css`: defaults and aliases.
- `packages/session-ui/src/components/file.css`: custom fold-separator styling.
- `packages/session-ui/src/components/line-comment-styles.ts`: comment controls.
- Installed `@pierre/diffs/dist/style.js`: renderer variables and derived backgrounds.
- Installed `@pierre/diffs/dist/utils/getHighlighterThemeStyles.js`: highlighter-to-renderer seed bridge.
