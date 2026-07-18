## Why

The `/models` dialog (`packages/tui/src/component/dialog-model.tsx`) is a flat `DialogSelect` list grouped by provider. With six providers and ~10 models each, finding a model means scrolling ~60 rows; provider headers don't help you jump providers, and the only model metadata surfaced is a bare "Free" chip for zero-cost opencode models. The `Model` object already carries rich data (cost in/out, context/output limits, cache cost, capability flags for reasoning/tools/attachment/audio/image/pdf, status, release date, variants) that the UI ignores. On top of that, users have no way to suppress models they never use or annotate why they picked one — favorites and recent are the only personalization, and a hidden model can still silently become the fallback selection.

## What Changes

- Add a **two-pane model dialog** (`DialogModelTwoPane`) for the common `/models` (no `providerID`) flow: left pane lists Favorites / Recent / Hidden / providers / Connect-provider; right pane renders the selected provider's models with rich rows. Provider-scoped flows (from `dialog-provider.tsx`) keep the existing single-column `DialogSelect`.
- **Rich model rows**: cost token (`$in/$out` per 1M, `success` color when input is 0 — extends "Free" to all providers), context-limit token (humanized `limit.context`), ★ favorite star, and a muted `details` capability line (reasoning · tools · vision · audio-in/out · image-out · ALPHA/BETA status). Variant count hinted when `model.variants` is non-empty.
- **Hide models**: per-user hidden list persisted in `state/model.json` alongside `recent`/`favorite`/`variant`. Hidden models are excluded from Favorites/Recent/Popular counts, from `cycleFavorite`, and from the fallback-model resolution in `local.tsx`. A `⌧ Hidden` left-pane entry lists and unhides them. Hiding the currently-running model does not change the active session.
- **Notes on models**: per-user free-text note keyed by `providerID/modelID`, persisted in `state/model.json`. Shown as a `✎` token in the row (truncated, `theme.info`); edited via an `n` footer action that opens a single-line input dialog. Empty submit clears. Notes are not indexed by search in v1.
- **Sort refinement**: within equal `release_date`, sort by `limit.context` desc then name; when a query is active, boost options from the current model's provider.
- **Narrow-terminal fallback**: below ~70 columns, `DialogModel` falls back to today's single-column behavior so nothing squishes.
- Footer actions: keep existing `model.dialog.provider` and `model.dialog.favorite`; add `model.dialog.hide` (`f`), `model.dialog.note` (`n`), and `model.dialog.variant` (only when the highlighted model has variants — jumps to `DialogVariant`).
- **Not BREAKING**: no config, protocol, server, or persisted-state shape changes that break older `state/model.json` files. New `hidden`/`notes` keys are additive with defensive read guards mirroring the existing `recent`/`favorite`/`variant` loaders.

Non-goals / not in this change:

- Web/desktop/console model pickers (those packages are out of scope / removed).
- Server-side or cross-session sync of hidden/notes — this is per-user local TUI state only, same scope as today's `favorite`/`recent`.
- Surfacing `cost.tiers[]` / `experimentalOver200K` pricing detail in v1 (a future "detail panel" change can do this).
- A right-side detail panel (Option C from the earlier design discussion) — deferred; this change ships the two-pane + rich rows.
- Making notes searchable by default (deliberately out of v1 to keep model-name search clean).
- Changing the `opencode` provider pinning or the catalog itself.

## Capabilities

### New Capabilities

- `model-selection-ui`: Two-pane `/models` dialog, rich per-row model metadata rendering, sort refinements, narrow-terminal fallback, footer-action keybindings, provider-scoped single-column compatibility. Lives in `packages/tui`.
- `model-user-state`: Per-user persisted model personalization — favorites (existing), recent (existing), variants (existing), **hidden** (new), **notes** (new). Persistence shape, read/write/defensive-load requirements, gating of fallback-model resolution and cycle shortcuts by hidden status. Lives in `packages/tui` (`context/local.tsx` + `state/model.json`).

### Modified Capabilities

- _(none — no existing OpenSpec spec covers TUI model selection or user model state)_

## Impact

- `packages/tui/src/context/local.tsx` — extend model store with `hidden` / `notes`, gate `isModelValid` with `!isHidden`, add `toggleHidden` / `note` / `setNote`, persist in `save()`.
- `packages/tui/src/util/model.ts` — add `modelRow` helper mapping a `Model` + provider + personalization flags to a `DialogSelectOption` (title, footer cost/context/star/note token, details capability line, categoryView provider header with count + price range).
- `packages/tui/src/component/dialog-model.tsx` — keep as shim: two-pane when `providerID` unset, single-column otherwise.
- `packages/tui/src/component/dialog-model-twopane.tsx` (new) — two `DialogSelect`s sharing a filter signal, `focusedPane` signal, left pane providers/sections, right pane rich rows.
- `packages/tui/src/component/dialog-note.tsx` (new) — single-line input dialog for editing a model note.
- `packages/tui/src/keymap` (registration) — register `model.dialog.hide` / `model.dialog.note` / `model.dialog.variant` alongside the existing `model.dialog.provider` / `model.dialog.favorite`.
- `state/model.json` (user state) — additive `hidden: Array<{providerID, modelID}>` and `notes: Record<string, string>` keys; old files without them load unchanged.
- No Schema / Core / Protocol / Server / Client / SDK changes. No `bun run generate` needed.