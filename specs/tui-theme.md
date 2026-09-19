# TUI Theme Parameters

Status: stable
Spec source of truth for: the opencode TUI theme parameters (ThemeJson → UI) —
for anyone authoring or tuning a custom theme.

## Overview

This spec fixes how the opencode TUI theme parameters (ThemeJson) map onto
interface elements: the composition and format of the theme file, the value
forms and their resolution, fallbacks, the complete "key → UI elements"
mapping, non-color factors (font weights, thinking opacity, fades, agent
colors), and hardcoded colors.

## Scope

In: the ThemeJson structure (`$schema`/`defs`/`theme`), file location and
selection; value forms (hex, references, ANSI, `{dark,light}`, `transparent`)
and their resolution; the mapping of 52 keys (T1–T9); fallbacks;
`thinkingOpacity`; the `tint`/`fadeColor`/`selectedForeground`/agent-color
mechanics; hover pairs (T10); hardcoded font weights (R12); hardcoded colors
(T12).

Out (non-goals): the opencode/opentui sources; SGR rendering and quantization;
other config files (`tui.json` only as the place where the theme is selected).

## Constraints

- Behavior is pinned to the dev build `0.0.0-main-202609031247` and
  `@opentui/core` `0.4.5`; behavior may change between versions — the tables
  need re-verification.
- Scope names are external tree-sitter identifiers.

## Definitions

Definitions used throughout (full IDs, `tui-theme/<term>`):

- `tui-theme/ThemeJson` — the theme JSON file: `$schema`, `defs`, `theme`.
- `tui-theme/key` — 52 color keys plus `thinkingOpacity`.
- `tui-theme/defs` — named constants.
- `tui-theme/VGA` — the fixed ansiToRgba table, integer 0–255 → RGBA; the
  terminal palette is never read (R3).
- `tui-theme/scope` — a tree-sitter highlight scope.
- `tui-theme/selectedForeground` — the foreground selection rule on a
  highlighted surface (R6).
- `tui-theme/tint` — the base + overlay α blend.
- `tui-theme/fadeColor` — the fade-in α animation.
- `tui-theme/hover` — pointer hover over a card row (T10).

## Interface

- Theme files: `themes/*.json` in the config directory
  (`~/.config/opencode/themes/`).
- Selection: the `theme` key in `~/.local/state/opencode/kv.json` (the
  `/themes` picker), also `tui.json`.
- Structure: `$schema` (schema URL), `defs`, `theme` (52 colors +
  `thinkingOpacity`).
- Value forms (R2): a hex string verbatim; a name → `defs` reference first,
  then `theme`; an integer 0–255 → VGA (R3); an object `{dark,light}` by
  color-scheme mode; `"transparent"`.
- `thinkingOpacity` 0–1, default `0.6` (R4).
- Fallbacks (R4): `selectedListItemText` → `background`;
  `backgroundMenu` → `backgroundElement`; `thinkingOpacity` → `0.6`.

## Configuration

| Name | Allowed / range | Default | Effect |
|---|---|---|---|
| `thinkingOpacity` | number 0–1 | `0.6` | Thinking-block opacity (R8) |
| `FOREGROUND_ALPHA` | fixed `186` | — | α of the retry-action overlay (R11) |
| dialog underlay `rgba(0,0,0,150)` | magic | — | Backdrop under dialogs (T12) |
| sidebar dim `rgba(0,0,0,70)` | magic | — | Sidebar dimming (T12) |
| row background reset `rgba(0,0,0,0)` | magic | — | Transparent reset of row backgrounds (T12) |
| `ansiToRgba` | fixed table 0–255 → VGA | — | ANSI value resolution (R3) |
| Knight-Rider spinner | magic — 7 red shades | — | Spinner colors (R11) |

## Behavior

- R1. The application root is painted `background` (via
  `renderer.setBackgroundColor`).
- R2. Value resolution: a hex string is used verbatim; a bare name resolves as
  a `defs` reference first, then as a `theme` key; an integer 0–255 resolves
  through the fixed VGA table (R3); an object `{dark,light}` resolves by
  color-scheme mode; `"transparent"` is the transparent value.
- R3. An integer value 0–255 maps through the fixed `ansiToRgba` table to RGBA
  (tui-theme/VGA); the terminal palette is never read.
- R4. `thinkingOpacity` accepts 0–1, default `0.6`. Fallbacks:
  `selectedListItemText` → `background`; `backgroundMenu` →
  `backgroundElement`; `thinkingOpacity` → `0.6`.
- R5. Main rule: scope `default` = `text` — all uncolored code, plain text,
  and the output of commands in bash blocks is painted `text`.
- R6. `selectedForeground` — the foreground color over a selection background:
  1) if the `selectedListItemText` key is set → it; 2) if the background is
  transparent → black/white by luminance; 3) otherwise → `background`.
- R7. Hover: a card row swaps its idle pair for the hover pair on pointer
  hover, idle → hover (T10).
- R8. `thinkingOpacity`: every foreground color of the thinking block is
  multiplied by the opacity; the header is `warning` × opacity.
- R9. Agent colors: the agent circle takes `secondary` → `accent` → `success`
  → `warning` → `primary` → `error` → `info` in order (the first agent gets
  `secondary`); `agent.color` accepts a hex value or a theme key name.
- R10. Dangling keys — present in ThemeJson but never read by the TUI:
  `borderSubtle`, `diffHunkHeader`, `markdownHorizontalRule`,
  `markdownListEnumeration`, `markdownImage`, `markdownImageText`,
  `markdownCodeBlock`.
- R11. Hardcoded colors no theme key affects: dialog underlay
  `rgba(0,0,0,150)`; sidebar dim `rgba(0,0,0,70)`; transparent row-background
  reset `rgba(0,0,0,0)`; `FOREGROUND_ALPHA = 186` (retry overlay); the
  black/white constants of `selectedForeground`; the Knight-Rider spinner (7
  red shades); the which-key fallback skin; ANSI values resolve to the fixed
  VGA table (R3).
- R12. Font weights are hardcoded, not theme-configurable (inventory in T11).

### T1 — Accent keys

| Key | UI elements |
|---|---|
| `primary` | Autocomplete: background of the selected row (fg via `selectedForeground`, R6); cursors of prompt/permission/question/dialog-select/dialog-prompt/export-options; the interrupt line; DialogSelect: background of the selected row + active footer button + `●` marker; background of the ok/confirm/help/retry buttons and workspace dialogs; export-options: text of the active line; provider links; diff-viewer: file tree selection; which-key accent |
| `secondary` | Color of the first agent in the circle (R9); File/Directory badges of a user message; question: the active option; editor file label; `extmark.agent` (@agent mention) |
| `accent` | question: container border and active tab (bg+fg); workspace-notice; spinners; DialogSelect: category headers (bold); session-list gutter; console email; the prompt `scope` |

### T2 — Status keys

| Key | UI elements |
|---|---|
| `error` | Error panels (border + text); InlineTool failed/errors; the retry line; stream-error; diagnostics; row background on deletion (session-list/stash/move); RejectPrompt △ + border; dialog load errors; toast error; failed/error statuses (MCP/LSP/workspace/footer/sidebar); question "(not answered)"; scopes `builtin`/`super`/`tag`/`error`; plugins inactive |
| `warning` | Permission prompt (△, border, bg+fg of the selected); the Reasoning/Thinking header (× `thinkingOpacity`, R8); stream-retry; Todo in_progress; MCP needs_auth; the footer permissions counter; the model variant in the meta line (fade+bold); `extmark.file` (bold); `extmark.paste` (bg+fg+bold); Tips ●; which-key keys; scopes `annotation`/`warning` |
| `success` | Footer ● LSP / ⊙ MCP; sidebar ● Open; connected/enabled statuses; ✓ question; dialog-debug copied; plugins active; scope `markup.list.checked` |
| `info` | Toast info (border); scopes `comment.todo`/`comment.note`/`comment.info`; the agent circle color (R9) |

### T3 — Text keys

| Key | UI elements |
|---|---|
| `text` | Input field text (+cursor); user text; file names in user messages; the assistant meta line (mode); InlineTool hover/pending; the shell block `$ command` and its output; Write code; hints; DialogSelect options; dialog headers (bold); sidebar texts; diff-viewer texts; toast title/message; scopes `default` (R5)/`spell`/`nospell`/`markup.underline` |
| `textMuted` | The most used key — input placeholder; BlockTool headers; Write line numbers; ↳ Loaded; expand/collapse; the meta line (model·duration); reasoning body code; timestamps/QUEUED; the revert banner; hint captions; InlineTool completed; esc/descriptions/No results in dialogs; permission captions; inactive tabs/descriptions in question; footer/sidebar captions; diff-viewer faded; scopes `conceal`/`strikethrough`/`unchecked`/`debug`; spinner fallback; the cursor of an unfocused field |

### T4 — Selection

| Key | UI elements |
|---|---|
| `selectedListItemText` | fg over `primary` backgrounds: dialog buttons; DialogSelect options/footer; retry-action. In autocomplete/permission/question the fg goes through `selectedForeground` (R6). Fallback → `background` (R4) |

### T5 — Backgrounds

| Key | UI elements |
|---|---|
| `background` | The application root (R1); markdown background; inline-code background; scrollbar tracks of permission/sidebar; BlockTool `borderColor` (invisible border); fallback for `selectedListItemText`/`selectedForeground`; the `tint` base (logo, bg-pulse) |
| `backgroundPanel` | UserMessage idle; the error panel; the revert banner; BlockTool idle; permission/question/reject containers; subagent-footer; the sidebar; the dialog panel; dialog-select filter; toast; startup-loading; the session scrollbar track; the retry-action overlay; bg-pulse |
| `backgroundElement` | The input field (container, focus, bottom line); hover of card rows (T10); the permission bar; the active question option; the filename chip; DialogSelect on action focus; active export-options rows; workspace-file-changes; getting-started; plugin-route-missing; fallback for `backgroundMenu`; the disabled cursor |
| `backgroundMenu` | The autocomplete list; BlockTool hover; inactive permission option buttons; the which-key panel |

### T6 — Borders

| Key | UI elements |
|---|---|
| `border` | The autocomplete border; the prompt highlight base (leader/no agent, via `tint`); session scrollbar fg; the subagent-footer border; diff-viewer panels |
| `borderActive` | permission/sidebar scrollbar fg; the compaction separator |
| `borderSubtle` | Not read (R10; which-key subtle — its own constant) |

### T7 — Diff (12 keys)

diff-viewer — Edit/ApplyPatch/permission-EditBody share one set:

| Diff-viewer property | Theme key |
|---|---|
| fg | `text` |
| addedBg | `diffAddedBg` |
| removedBg | `diffRemovedBg` |
| contextBg | `diffContextBg` |
| addedSignColor | `diffHighlightAdded` |
| removedSignColor | `diffHighlightRemoved` |
| lineNumberFg | `diffLineNumber` |
| lineNumberBg | `diffContextBg` |
| addedLineNumberBg | `diffAddedLineNumberBg` |
| removedLineNumberBg | `diffRemovedLineNumberBg` |

Outside the viewer: `diffAdded`/`diffRemoved` — the ±N revert banner, the
deleted-lines of ApplyPatch, workspace-file-changes, sidebar files.
`diffContext` — only the `diff.delta` scope. `diffAddedBg`/`diffRemovedBg`/
`diffContextBg` — also the `diff.plus`/`diff.minus`/`diff.delta` scopes.
`diffHunkHeader` — not read (R10).

### T8 — Markdown (via getSyntaxRules)

| Key | UI elements |
|---|---|
| `markdownText` | Markdown fg + `spell`/`nospell` |
| `markdownHeading` | Headings: h1 bold+underline, h2–h6 bold (R12) |
| `markdownStrong` | `markup.bold`/`strong`, bold |
| `markdownEmph` | Italic |
| `markdownListItem` | `markup.list` |
| `markdownBlockQuote` | Italic |
| `markdownCode` | `markup.raw`; inline bg = `background` |
| `markdownLink` | `markup.link`/`url`, underline |
| `markdownLinkText` | `markup.link.label`/`label` |
| Not read (R10) | `markdownHorizontalRule`, `markdownListEnumeration`, `markdownImage`, `markdownImageText`, `markdownCodeBlock` |

### T9 — Syntax (scopes)

| Key | Scopes |
|---|---|
| `syntaxComment` | `comment*`, italic |
| `syntaxKeyword` | `keyword*` (almost all italic); `string.escape`/`regexp`; `tag.attribute` |
| `syntaxString` | `string*`/`symbol*`/`character*` |
| `syntaxNumber` | `number`/`boolean`/`float`/`constant` |
| `syntaxType` | `type`/`module`/`class`/`namespace` (bold); `keyword.type` (bold+italic) |
| `syntaxFunction` | `variable.member`/`function`/`constructor`/`keyword.function`/`method` |
| `syntaxVariable` | `variable`/`parameter`/`function.call`/`property`/`field` |
| `syntaxOperator` | `operator*`/`punctuation.delimiter`/`ternary`/`tag.delimiter` |
| `syntaxPunctuation` | `punctuation`/`bracket` |

Bash blocks — the same scopes; no scope = `default` = `text` (R5).

### T10 — Hover (idle → hover), R7

| Component | idle → hover |
|---|---|
| BlockTool | `backgroundPanel` → `backgroundMenu` |
| UserMessage | `backgroundPanel` → `backgroundElement` |
| Revert | `backgroundPanel` → `backgroundElement` |
| InlineTool (fg) | `textMuted`/`text` → `text` |
| SubagentFooter | `backgroundPanel` → `backgroundElement` |
| Question tabs | `backgroundPanel` → `backgroundElement` |
| DialogSelect (action focus) | `primary` → `backgroundElement` |
| Autocomplete selected row | bg `primary` + fg `selectedForeground` (R6) |
| Diff-viewer file tree | faded `textMuted` → bg `primary` + fg `background` (R6) |

### T11 — Non-color factors

- R12 hardcoded weights: bold — h1 (+underline), h2–h6, `markup.bold`/`strong`,
  `type`/`module`/`class`/`namespace`, `keyword.type` (+italic), UI headers of
  DialogSelect/dialogs, `extmark.file`, the model variant (+fade); italic —
  `comment*`, markdown emph/blockquote, `keyword*` (almost all); underline —
  h1, links.
- R8 `thinkingOpacity`: every fg of the thinking block × opacity; the header —
  `warning` × opacity.
- `fadeColor(color, α)` — the fade-in of the prompt meta line (agent name,
  model).
- `tint(base, overlay, α)` — the prompt highlight (base `border`), the logo,
  bg-pulse, the `question` model variant, the diff-viewer fade.
- R6 `selectedForeground`: 1) `selectedListItemText` set → it; 2) transparent
  background → black/white by luminance; 3) otherwise → `background`.
- R9 agent colors: the circle `secondary` → `accent` → `success` → `warning` →
  `primary` → `error` → `info` (the first `secondary`); `agent.color` — a hex
  value or a theme key name.

### T12 — Hardcoded (R11)

Dialog underlay `rgba(0,0,0,150)`; sidebar dim `rgba(0,0,0,70)`; transparent
reset `rgba(0,0,0,0)`; `FOREGROUND_ALPHA = 186` (retry overlay); the
black/white constants of `selectedForeground`; the Knight-Rider spinner (7 red
shades); the which-key fallback skin; ANSI values — the fixed VGA table (R3).
