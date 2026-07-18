## Context

The `/models` dialog (`packages/tui/src/component/dialog-model.tsx`) wraps the generic `DialogSelect` (`packages/tui/src/ui/dialog-select.tsx`). Today it builds a flat list of options grouped by provider name with three optional pinned sections (Favorites / Recent / Popular providers). Each row renders a title, an optional description, and a single `footer` chip — the only model metadata surfaced today is a bare `"Free"` string for zero-cost opencode models. The `Model` object (from `@kancode/sdk/v2` `types.gen.ts` lines ~2030-2108) already carries:

- `capabilities`: `temperature`, `reasoning`, `attachment`, `toolcall`, `input.{text,audio,image,video,pdf}`, `output.{text,audio,image,video,pdf}`, `interleaved`
- `cost`: `{ input, output, cache:{read,write}, tiers[]?, experimentalOver200K? }`
- `limit`: `{ context, input?, output }`
- `status`: `"alpha" | "beta" | "deprecated" | "active"`
- `release_date`, `variants?`

Per-user personalization today is limited to `favorite` and `recent` (and `variant` selection), persisted to `state/model.json` via `packages/tui/src/context/local.tsx`. There is no way to suppress a model from listings, no way to annotate why a model was chosen, and a hidden-but-still-valid model can silently become the fallback (`fallbackModel` / `getFirstValidModel` in `local.tsx`).

`DialogSelect` already exposes the hooks this change needs:

- `details?: string[]` per option — used today for nothing in `dialog-model.tsx`; perfect for a capability line.
- `footer?: JSX.Element | string` — currently only `"Free"`.
- `categoryView?: JSX.Element` — currently unused; perfect for rich provider headers.
- `titleWidth` / `truncateTitle` — for leaving room for the note token.
- `onMove?(option)` — currently unused by `DialogModel`; needed by the future detail-panel variant but not by two-pane.
- `actions[]` — the footer action bar that already hosts `model.dialog.provider` and `model.dialog.favorite`; we add `model.dialog.hide`, `model.dialog.note`, `model.dialog.variant`.
- `onFilter` + shared signal — two-pane shares one filter across two `DialogSelect` instances.

No Schema / Core / Protocol / Server / Client / SDK changes are needed. The change is entirely inside `packages/tui` plus an additive shape for `state/model.json`.

## Goals / Non-Goals

**Goals:**

- Two-pane `/models` dialog for the common no-`providerID` flow; single-column unchanged for provider-scoped flows.
- Surface the rich `Model` metadata (cost, context limit, capabilities, status, variants) in each row.
- Let users hide models from all listings, including fallback resolution.
- Let users attach a free-text note per `providerID/modelID`, visible in the row, editable via a keybinding.
- Keep keyboard-only flow fast: no new global keybindings; reuse `Tab`/`Shift-Tab` for pane focus.
- Backward-compatible `state/model.json` (additive keys only, defensive load).
- Narrow-terminal fallback to today's single-column behavior.

**Non-Goals:**

- Cross-session / server-side sync of hidden/notes (local TUI state only, same scope as today's favorite/recent).
- A right-side detail panel (deferred to a follow-on change).
- Surfacing `cost.tiers[]` / `experimentalOver200K` pricing detail in v1.
- Making notes searchable by default (deliberately out of v1).
- Changing `opencode` provider pinning or the catalog itself.
- Web/desktop/console model pickers (out of scope / removed).
- Any Schema/Protocol/Server change or `bun run generate`.

## Decisions

### 1. Two `DialogSelect` instances, not a new layout primitive

**Decision:** `DialogModelTwoPane` composes two existing `DialogSelect` components side by side. A `focusedPane` signal routes arrow keys to the focused instance; `Tab`/`Shift-Tab` (already bound in `DialogSelect` for footer actions) is extended at the parent to also move pane focus when no footer action is focused.

**Why not a new `DialogTwoPaneSelect` primitive?** The generic `DialogSelect` already handles search, scroll, mouse, keymap registration, and current-model highlighting. Forking it would duplicate that surface. Composing two instances and owning focus at the parent keeps the change small and keeps the provider-scoped single-column path literally the same component.

**Alternative considered:** A single `DialogSelect` with a virtual "left section" — rejected; breaks the existing `grouped()`/`flat()` scroll math and makes pane focus ambiguous.

### 2. Left-pane sections as first-class options, not headers

**Decision:** The left pane is itself a `DialogSelect` whose options are:

1. `★ Favorites` (count = favorites not hidden) — selecting it short-circuits: choose the most-recent favorite directly (or, if multiple, focus the right pane filtered to favorites). v1: jump to the first favorite to keep it one-keystroke.
2. `⟳ Recent` (count, deduped vs favorites) — same short-circuit to most-recent.
3. `⌧ Hidden` (count) — selecting swaps the right pane to "hidden models only" with an Unhide footer action.
4. One row per provider (count = non-deprecated, non-hidden models). `opencode` pinned to top via the existing `sortBy(provider.id !== "opencode")`.
5. `+ Connect provider` (only when disconnected) — replaces the "Popular providers" rows for the connected case.

**Why not keep Favorites/Recent as right-pane sections like today?** With two panes, the left pane is the natural "jump to provider" surface; demoting Favorites/Recent to right-pane sections under each provider would lose the one-keystroke access users have today. Keeping them as left-pane entries preserves that.

### 3. Per-row metadata via a `modelRow` helper

**Decision:** Add `modelRow(model, provider, { favorite, hidden, note, current, onSelect }) -> DialogSelectOption` in `packages/tui/src/util/model.ts`. It produces:

- `title`: `model.name ?? model.id`, truncated right.
- `footer`: composed token — cost (`$in/$out` per 1M, humanized; `theme.success` when `cost.input === 0`), context (`200K` / `1M` / `128K` from `limit.context`; omitted when absent), `★` in `theme.warning` when favorite (space placeholder otherwise so widths align), `✎` note token in `theme.info` when a note exists. The `titleWidth` is reduced by the measured footer width so the title truncates rather than collides.
- `details`: capability line — joined `·`-separated muted glyphs: `reasoning`, `tools` (from `capabilities.toolcall`), `vision` (when `input.image` or `input.pdf`), `audio-in` (`input.audio`), `audio-out` / `image-out` (`output.audio` / `output.image`), `ALPHA` / `BETA` badge (from `status`), `+N variants` when `variants` is non-empty.
- `categoryView`: provider header JSX — provider name + model count + price range (`$3–$15`) computed from the visible models' cost min/max.

**Why a helper?** The three option builders in `dialog-model.tsx` (favorites, recents, provider models) each inline a slightly different shape today; the helper unifies them and is reused by both panes.

### 4. Hidden models gated inside `isModelValid`

**Decision:** Extend `isModelValid(model)` in `local.tsx` to also require `!isHidden(model)`. This single edit propagates the filter to every existing call site: `fallbackModel` (so a hidden model never silently becomes the fallback), `getFirstValidModel`, `cycleFavorite`, and the `dialog-model.tsx` filter pipeline (which already uses `isModelValid` indirectly through provider/models lookups — we add an explicit `!hidden` filter there too, but `isModelValid` is the load-bearing gate).

**Why gate `isModelValid` rather than each call site?** One chokepoint, no drift. The cost is a function that now reads the hidden array — cheap and already reactive via the store.

**Hiding the currently-running model:** `toggleHidden` on the active model does **not** change the current selection. The session keeps running. A toast confirms: "Hidden — won't appear in model lists. Current session unaffected." The Hidden left-pane section shows it with an Unhide action so it's never lost.

### 5. `state/model.json` additive shape

**Decision:** Add two keys alongside the existing `recent` / `favorite` / `variant`:

```jsonc
{
  "recent":   [{ "providerID": "anthropic", "modelID": "claude-sonnet-4-5" }],
  "favorite": [{ "providerID": "anthropic", "modelID": "claude-sonnet-4-5" }],
  "variant":  { "anthropic/claude-sonnet-4-5": "thinking-high" },
  "hidden":   [{ "providerID": "openai", "modelID": "gpt-4-0314" }],
  "notes":    { "anthropic/claude-sonnet-4-5": "fast and cheap for refactors" }
}
```

`save()` writes all five. The `readJson().then(...)` loader gets defensive guards mirroring the existing ones: `if (Array.isArray(value.hidden)) setModelStore("hidden", ...)` and `if (typeof value.notes === "object" && value.notes !== null) setModelStore("notes", ...)`.

**Why not a separate `model-hidden.json` / `model-notes.json`?** Same scope, same write cadence, same atomic write helper (`writeJsonAtomic`); splitting would triple the I/O for no benefit.

### 6. Note editing via a small `DialogNote`

**Decision:** `model.dialog.note` (`n`) calls `dialog.replace(() => <DialogNote model={...} />)`. `DialogNote` is a tiny single-line `<input>` dialog styled like `DialogVariant`: prefilled with the current note, `Enter` saves (`local.model.setNote(model, text)`; empty string clears), `Esc` cancels and restores the previous value.

**Why a separate dialog rather than inline edit?** `DialogSelect`'s filter input is already a single shared input; overloading it for note editing would break the search UX. A modal one-liner matches the existing `DialogVariant` pattern and is two-dozen lines.

**Notes are not in search keys:** v1 deliberately keeps `fuzzysort` keys as `["title", "category"]` so typing finds models, not your own prose. A `Ctrl+N` toggle to add notes to the keys is a trivial follow-on if requested.

### 7. Footer actions and keymap

**Decision:** Register three new commands in the same `useBindings` block that already registers `model.dialog.provider` and `model.dialog.favorite`:

| Command | Key | Title | Hidden when |
|---------|-----|-------|------------|
| `model.dialog.hide` | `f` | Hide / Unhide | `!connected()` (mirrors `favorite`) |
| `model.dialog.note` | `n` | Note | `!connected()` |
| `model.dialog.variant` | `v` | Variants | `local.model.variant.list().length === 0` for the highlighted model |

`model.dialog.variant` jumps to `DialogVariant` without committing a model switch — useful for flipping thinking-mode on the model you're already on. The existing two actions stay.

**Why `f` / `n` / `v`?** Single letters, no modifier, matches the existing single-letter style (`esc`, `tab`). No conflicts with `DialogSelect`'s built-ins (`prev`/`next`/`page_up`/`page_down`/`home`/`end`/`submit`).

### 8. Sort refinements

**Decision:** Extend `sortModelOptions` (already exported from `dialog-model.tsx`): within equal `release_date`, sort by `limit.context` desc, then name. When a query is active, boost options whose provider matches the current model's provider.

**Why not a "context size" sort mode toggle?** Adds a keybinding and a mode the user has to discover. The tiebreaker is invisible and just makes big-context models feel bigger.

### 9. Narrow-terminal fallback

**Decision:** `DialogModel` checks `useTerminalDimensions()`; below ~70 columns it renders the existing single-column `DialogSelect` path (the provider-scoped flow). Above, it renders `DialogModelTwoPane`. Both paths share `modelRow` so the rich rows appear in both.

**Why 70?** Two panes need ~20 cols for the left list + ~50 for the right; below that the right pane can't fit the cost+context+star+note tokens without truncating the title.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Two `DialogSelect` focus management drifts (arrow keys leak between panes) | Parent owns `focusedPane`; each child's keymap only registers when focused; tests cover tab/shift-tab + arrow containment |
| Hidden model silently still selectable via recent/favorite arrays | `isModelValid` gating + explicit `!hidden` filter in option builders; hidden entries are filtered out of `favorite`/`recent` counts at read time |
| Note text overflows row width | `titleWidth` reduced by measured note token width; note truncated with `Locale.truncateMiddle`; full text shown in `DialogNote` when editing |
| Old `state/model.json` without `hidden`/`notes` keys | Defensive `Array.isArray` / `typeof` guards in loader; missing keys default to `[]` / `{}` |
| Hiding the current model confuses users | Toast on hide; Hidden section always visible in left pane; current-model `●` indicator preserved even for hidden active model when shown in Hidden section |
| `f` / `n` / `v` collide with future keybindings | Registered in the model-dialog-specific `useBindings` scope, not globally; collision only possible within the model dialog |
| Two-pane layout breaks on very long provider names | Left pane truncates provider name with existing `Locale.truncate`; count chip is right-aligned |
| Search across two panes ambiguous | v1 rule: filter applies to the focused pane; `Enter` on a provider row focuses the right pane (doesn't select); selecting from the right pane commits |

## Migration Plan

1. `local.tsx`: add `hidden` / `notes` store fields + `isHidden` / `toggleHidden` / `note` / `setNote`; gate `isModelValid`. Backward-compatible: old `model.json` loads fine.
2. `util/model.ts`: add `modelRow` helper.
3. `dialog-model.tsx`: keep as shim; route to two-pane or single-column by `providerID` + terminal width.
4. `dialog-model-twopane.tsx` (new): compose two `DialogSelect`s.
5. `dialog-note.tsx` (new): single-line note editor.
6. Keymap: register `model.dialog.hide` / `model.dialog.note` / `model.dialog.variant`.
7. Typecheck from `packages/tui`.

**Rollback:** delete the three new files, revert `local.tsx` / `util/model.ts` / `dialog-model.tsx`. Old `model.json` files with `hidden` / `notes` keys load fine on previous code (extra keys ignored).

## Open Questions

1. Should `★ Favorites` left-pane entry jump straight to the first favorite (one-keystroke, proposed) or focus the right pane filtered to favorites (two keystrokes but more discoverable)? v1 ships the jump behavior; revisit if users complain.
2. Should the Hidden section be collapsed by default when empty? Proposed: hidden entirely from the left pane when count is 0 (no empty `⌧ Hidden (0)` row).
3. Should `model.dialog.variant` commit the highlighted model before opening `DialogVariant`, or operate on the current model only? Proposed: operate on the highlighted model only when it equals the current model; otherwise no-op (or focus the right pane on that model). v1: only show the action when the highlighted model is the current model.
4. Should notes support multi-line? v1: single-line only (matches `DialogVariant`'s input simplicity); multi-line is a follow-on.