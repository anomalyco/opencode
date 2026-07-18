## 1. Model user state foundation (local.tsx)

- [x] 1.1 Extend the model store type in `packages/tui/src/context/local.tsx` with `hidden: { providerID: string; modelID: string }[]` and `notes: Record<string, string>` fields (default `[]` / `{}`)
- [x] 1.2 Update `save()` to write `hidden` and `notes` alongside `recent`/`favorite`/`variant` in the atomic `writeJsonAtomic` call
- [x] 1.3 Add defensive loaders in the `readJson().then(...)` block: `if (Array.isArray(value.hidden)) setModelStore("hidden", value.hidden)` and `if (typeof value.notes === "object" && value.notes !== null) setModelStore("notes", value.notes as Record<string, string>)`
- [x] 1.4 Add `isHidden(model)` helper that checks the `hidden` array for a `{ providerID, modelID }` match
- [x] 1.5 Gate `isModelValid(model)` with `!isHidden(model)` so all existing call sites (fallback resolution, `getFirstValidModel`, `cycleFavorite`, agent-model validity toast) inherit the hidden filter
- [x] 1.6 Add `hidden()` accessor returning `modelStore.hidden`
- [x] 1.7 Add `toggleHidden(model)` that adds/removes the model from `hidden` and calls `save()` (does NOT change the active session's `model` entry)
- [x] 1.8 Add `note(model)` accessor returning `modelStore.notes["<providerID>/<modelID>"] ?? ""`
- [x] 1.9 Add `setNote(model, text)` that sets/replaces the note, or deletes the entry when `text === ""`, then calls `save()`
- [x] 1.10 Run `bun typecheck` from `packages/tui`

## 2. modelRow helper (util/model.ts)

- [x] 2.1 Add `humanizeContext(bytes: number)` helper returning `200K` / `1M` / `128K` style strings (divide by 1000, use `K` under 1M, `M` at 1M+)
- [x] 2.2 Add `humanizeCost(cost: number)` helper returning `$3` / `$15` per 1M tokens (no decimals for integers, one decimal when fractional)
- [x] 2.3 Add `capabilityLine(model)` returning the joined `·`-separated muted capability string (`reasoning`, `tools` from `capabilities.toolcall`, `vision` from `input.image`/`input.pdf`, `audio-in`/`audio-out`, `image-out`, `ALPHA`/`BETA` from `status`, `+N variants` when `variants` is non-empty)
- [x] 2.4 Add `modelRow(model, provider, { favorite, hidden, note, current, onSelect })` returning a `DialogSelectOption` with composed `title`, `footer` (cost token in `theme.success` when `cost.input === 0` else muted, context token, `★` favorite star, `✎` note token in `theme.info`), `details` (capability line), and `categoryView` (provider header JSX with name + count + price range)
- [x] 2.5 Compute `titleWidth` reduction from the measured footer width so the title truncates rather than colliding with the footer
- [x] 2.6 Run `bun typecheck` from `packages/tui`

## 3. Sort refinements (dialog-model.tsx)

- [x] 3.1 Extend `sortModelOptions` to break `release_date` ties by `limit.context` desc, then by title
- [x] 3.2 When a query is active, boost options whose `category` (provider) matches the current model's provider ahead of equally-scored options
- [x] 3.3 Run `bun typecheck` from `packages/tui`

## 4. DialogModel shim routing (dialog-model.tsx)

- [x] 4.1 Import `useTerminalDimensions` and compute `narrow = dimensions().width < 70`
- [x] 4.2 When `props.providerID` is unset AND `!narrow`, render `<DialogModelTwoPane {...props} />`
- [x] 4.3 Otherwise (provider-scoped OR narrow), render the existing single-column `DialogSelect` path using `modelRow` for rich rows
- [x] 4.4 Run `bun typecheck` from `packages/tui`

## 5. Two-pane component (dialog-model-twopane.tsx)

- [x] 5.1 Create `packages/tui/src/component/dialog-model-twopane.tsx` exporting `DialogModelTwoPane(props)` taking the same props as `DialogModel`
- [x] 5.2 Add a shared `createSignal<string>("")` filter signal passed to both panes' `onFilter`
- [x] 5.3 Add a `focusedPane` signal (`"left" | "right"`, default `"left"`) and route arrow-key bindings to the focused `DialogSelect`
- [x] 5.4 Build the left pane options: `★ Favorites (count)`, `⟳ Recent (count)`, `⌧ Hidden (count)` (only when `hidden().length > 0`), one row per provider (count = non-deprecated non-hidden models; `opencode` pinned first), `+ Connect provider` (only when disconnected)
- [x] 5.5 Left pane `onSelect`: for Favorites/Recent, jump straight to the first favorite/recent via `onSelect`; for Hidden, swap the right pane to hidden-models-only mode with an Unhide footer action; for a provider, focus the right pane (no select); for Connect provider, `dialog.replace(() => <DialogProvider />)`
- [x] 5.6 Build the right pane options from the selected left entry using `modelRow` (or, for Hidden mode, render hidden models with the unhide action wired to `local.model.toggleHidden`)
- [x] 5.7 Implement `Tab`/`Shift-Tab` to move pane focus when no footer action is focused (extend the existing `DialogSelect` tab binding at the parent level)
- [x] 5.8 Initialize the right pane to the current model's provider on mount
- [x] 5.9 Run `bun typecheck` from `packages/tui`

## 6. Note dialog (dialog-note.tsx)

- [x] 6.1 Create `packages/tui/src/component/dialog-note.tsx` exporting `DialogNote(props: { model: { providerID: string; modelID: string }; title?: string })`
- [x] 6.2 Render a single-line `<input>` prefilled with `local.model.note(props.model)`, styled like `DialogVariant`
- [x] 6.3 `Enter` calls `local.model.setNote(props.model, text)` (empty string clears) then `dialog.clear()`
- [x] 6.4 `Esc` calls `dialog.clear()` without saving
- [x] 6.5 Run `bun typecheck` from `packages/tui`

## 7. Footer actions and keymap

- [x] 7.1 Register `model.dialog.hide` (key `f`, title "Hide"/"Unhide" depending on right-pane mode) in the `useBindings` block alongside `model.dialog.provider`/`model.dialog.favorite`; `hidden: !connected()`; `onTrigger` calls `local.model.toggleHidden(option.value)`
- [x] 7.2 Register `model.dialog.note` (key `n`, title "Note"); `hidden: !connected()`; `onTrigger` calls `dialog.replace(() => <DialogNote model={option.value} />)`
- [x] 7.3 Register `model.dialog.variant` (key `v`, title "Variants"); `hidden` when the highlighted model has no `variants` map (or when it is not the current model, per Open Question 3); `onTrigger` calls `dialog.replace(() => <DialogVariant />)`
- [x] 7.4 Update the existing `model.dialog.favorite` action label/visibility to also account for hidden (favorites can't be hidden — hide first or favorite wins, document in tooltip)
- [x] 7.5 Run `bun typecheck` from `packages/tui`

## 8. Wiring and verification

- [x] 8.1 Verify the existing four `DialogModel` call sites (`app.tsx` model.list + title-model, `module-commands.tsx`, `dialog-provider.tsx` x3, `prompt/index.tsx`) still work unchanged through the shim
- [x] 8.2 Verify the Hidden left-pane entry is omitted when zero models are hidden
- [x] 8.3 Verify hiding the currently-running model keeps the active session running and shows the toast
- [x] 8.4 Verify an old `state/model.json` without `hidden`/`notes` keys loads with empty defaults and no error
- [x] 8.5 Verify narrow terminals (< 70 cols) fall back to single-column for `/models`
- [x] 8.6 Run `bun typecheck` from `packages/tui` as the final gate

## 9. Open Questions to resolve during apply

- [x] 9.1 Decide whether `★ Favorites` left-pane entry jumps to the first favorite (v1 default) or focuses the right pane filtered to favorites — confirm with a quick dogfood pass
- [x] 9.2 Confirm `model.dialog.variant` only shows when the highlighted model is the current model (per Open Question 3) vs. always when the highlighted model has variants
- [x] 9.3 Confirm single-line notes are sufficient for v1 (multi-line deferred)