## MODIFIED Requirements

### Requirement: Rich Per-Row Model Metadata

Each model row SHALL display the model name, a cost token (`$input/$output` per 1M tokens, colored `theme.success` when `cost.input === 0`), a context-limit token humanized from `limit.context` (omitted when absent), a favorite indicator, and a single capability line below the title listing `reasoning`, `tools` (from `capabilities.toolcall`), `vision` (when `input.image` or `input.pdf`), `audio-in`/`audio-out`, `image-out`, `ALPHA`/`BETA` status badges, then `fallback-vision` (when the model has no vision capability AND an effective vision fallback is set for that model), then `+N variants` (when the model has a non-empty `variants` map). The capability line is rendered as a single detail row (one box, not one row per token): the row footer / detail renderer takes a one-element details array whose entry is either a plain string or a `{ parts }` structured line so all tokens stay on one line. The `fallback-vision` token is placed before the `+N variants` token so a long variants list does not push it off the right edge. The `fallback-vision` token SHALL use `theme.textMuted` when the effective fallback is the inherited global default, and `theme.info` when it comes from a per-model override; other capability tokens remain `theme.textMuted`. The `fallback-vision` token SHALL NOT include the fallback target's name; the target is visible only inside the `DialogConfig` submenu. Provider headers SHALL include the provider name, visible model count, and a price range computed from the visible models' cost min/max.

#### Scenario: Cost token renders for a paid model

- **WHEN** a model has `cost.input === 3` and `cost.output === 15`
- **THEN** the row footer shows `$3/$15` in the default muted color

#### Scenario: Free model token is highlighted

- **WHEN** a model has `cost.input === 0`
- **THEN** the row footer shows `$0/$<output>` in `theme.success`
- **AND** this applies to all providers, not only `opencode`

#### Scenario: Context limit is humanized

- **WHEN** a model has `limit.context === 200000`
- **THEN** the row footer shows `200K`
- **WHEN** a model has `limit.context === 1000000`
- **THEN** the row footer shows `1M`

#### Scenario: Capability line lists supported capabilities

- **WHEN** a model has `capabilities.reasoning === true`, `capabilities.toolcall === true`, and `capabilities.input.image === true`
- **THEN** the row's muted detail line includes `reasoning · tools · vision`

#### Scenario: Alpha/beta status is badged

- **WHEN** a model has `status === "alpha"`
- **THEN** the capability line includes an `ALPHA` badge
- **WHEN** a model has `status === "beta"`
- **THEN** the capability line includes a `BETA` badge

#### Scenario: Variant count is hinted

- **WHEN** a model has a non-empty `variants` map with 3 entries
- **THEN** the capability line includes `+3 variants`

#### Scenario: Provider header shows count and price range

- **WHEN** the right pane renders the Anthropic provider with 3 visible models priced $3, $15, $1 per 1M input
- **THEN** the provider header shows `Anthropic` and a price range like `$1–$15`

#### Scenario: Fallback token shown for non-vision model with effective fallback

- **WHEN** a model has no `capabilities.attachment` and no `capabilities.input.image` and no `capabilities.input.pdf` AND `fallbackFor(model)` returns a target (either the global or a per-model override)
- **THEN** the row's capability line includes `fallback-vision` (without the target's name)

#### Scenario: Fallback token suppressed when no effective fallback

- **WHEN** a model has no `capabilities.attachment` and no `capabilities.input.image` and no `capabilities.input.pdf` AND `fallbackFor(model)` returns `undefined` (no global AND no per-model entry, or per-model entry is `null`)
- **THEN** the row's capability line does NOT include `fallback-vision`

#### Scenario: Fallback token suppressed for vision-capable model

- **WHEN** a model has `capabilities.input.image === true` or `capabilities.input.pdf === true` or `capabilities.attachment === true` regardless of `fallbackFor(model)`
- **THEN** the row's capability line shows `vision` (the existing token) and does NOT include `fallback-vision`

#### Scenario: Fallback token suppressed for pdf-only model

- **WHEN** a model has `capabilities.input.pdf === true` but no `capabilities.input.image` and no `capabilities.attachment` AND a fallback is set
- **THEN** the row's capability line shows `vision` (because pdf counts as vision, per `util/model.ts:58`) and does NOT include `fallback-vision`

#### Scenario: Per-model override changes which model shows fallback-vision

- **WHEN** the global is `{ providerID: "opencode", modelID: "glm-4.6v" }` AND a per-model override for `zhipu/glm-5.2` is `null` (opt-out)
- **THEN** `zhipu/glm-5.2`'s row does NOT show `fallback-vision` (explicit opt-out) while other text-only models (e.g. `opencode/glm-4.5`) DO show it (inheriting the global)

#### Scenario: Capability line is a single row

- **WHEN** any model row renders (with or without a fallback, with or without variants)
- **THEN** the entire capability line (reasoning + tools + vision + audio + status + fallback-vision + +N variants) renders as a single detail row, not one row per token
- **AND** the row takes exactly two screen lines in the picker (title line + capability line), not five

#### Scenario: Capability line colors distinguish per-model vs global fallback-vision

- **WHEN** a non-vision model inherits the global fallback (no per-model entry)
- **THEN** the `fallback-vision` token is rendered in `theme.textMuted` (mute), the same as `reasoning` / `tools` / `vision`
- **WHEN** a non-vision model has a per-model override target
- **THEN** the `fallback-vision` token is rendered in `theme.info`
- **AND** other capability tokens on the same line remain in `theme.textMuted`

#### Scenario: fallback-vision position before +N variants

- **WHEN** a non-vision model has a `fallback-vision` AND a non-empty `variants` map
- **THEN** the capability line order is `... · fallback-vision · +N variants · ...` (fallback-vision precedes variants)

### Requirement: Hide And Unhide Models

The model dialog SHALL provide a `model.dialog.hide` footer action (binding `h`, per `keybind.ts:122`) directly in the model list that toggles the hidden state of the highlighted model. The action label SHALL show `Hide` or `Unhide` depending on the model's current hidden state. Hidden models SHALL be excluded from Favorites, Recent, Popular, provider counts, `cycleFavorite`, and fallback-model resolution. The `Hidden` left-pane entry SHALL list hidden models with an `Unhide` affordance, and SHALL be omitted from the left pane when zero models are hidden. Hiding the currently-running model SHALL NOT change the active session's model. The `model.dialog.hide` command SHALL also be triggerable from inside the `DialogConfig` submenu via a `Set hidden` / `Clear hidden` option pair for users who prefer a non-toggle flow.

#### Scenario: Hide removes model from listings

- **WHEN** the user triggers `model.dialog.hide` (binding `h`) on a visible model from the model list
- **THEN** the model is added to `hidden` in `state/model.json`
- **AND** the model disappears from Favorites, Recent, provider counts, and the right pane on next render

#### Scenario: Hidden model cannot become fallback

- **WHEN** a model is hidden and would otherwise be the first valid recent or provider default
- **THEN** `fallbackModel` resolution skips it
- **AND** the next valid model is selected instead

#### Scenario: Hidden section appears only when non-empty

- **WHEN** zero models are hidden
- **THEN** the left pane does not show a `Hidden` row
- **WHEN** one or more models are hidden
- **THEN** the left pane shows `Hidden (N)`

#### Scenario: Unhide restores model

- **WHEN** the right pane is showing the Hidden section and the user triggers the unhide action on a model
- **THEN** the model is removed from `hidden`
- **AND** it reappears under its provider in the left pane

#### Scenario: Hiding active model does not switch session

- **WHEN** the user hides the model currently running in the active session
- **THEN** the active session continues using that model
- **AND** a toast confirms the model is hidden but the current session is unaffected

#### Scenario: Toggle label reflects current state

- **WHEN** the highlighted model is not in `hidden`
- **THEN** the action label is `Hide`
- **WHEN** the highlighted model is in `hidden`
- **THEN** the action label is `Unhide`

#### Scenario: Favorite label reflects current state

- **WHEN** the highlighted model is not in `favorite`
- **THEN** the action label is `Favorite`
- **WHEN** the highlighted model is in `favorite`
- **THEN** the action label is `Unfavorite`

#### Scenario: Clear hidden from DialogConfig

- **WHEN** a model is currently in `hidden` and the user opens `DialogConfig` for that model
- **THEN** the submenu shows a `Clear hidden` option (and no `Set hidden` option)
- **AND** selecting `Clear hidden` removes the model from `hidden`

#### Scenario: Set hidden from DialogConfig

- **WHEN** a model is not in `hidden` and the user opens `DialogConfig` for that model
- **THEN** the submenu shows a `Set hidden` option (and no `Clear hidden` option)
- **AND** selecting `Set hidden` adds the model to `hidden`

### Requirement: Model Notes

The model dialog SHALL provide a `model.dialog.note` command that is triggered only from inside the `DialogConfig` submenu (via a `Note` option). The model list SHALL NOT expose a `note` action and SHALL NOT bind the `n` key to note editing. The `Note` option title SHALL be `Note: <truncated note text>` when a note exists (no quote marks), or `Add note` (no trailing ellipsis) when the note is empty. The option SHALL push the existing `DialogNote` single-line input dialog prefilled with the existing note. `Enter` SHALL save the note (empty input clears it); `Esc` SHALL cancel and restore the previous value and return to `DialogConfig`. Notes SHALL be persisted in `state/model.json` under a `notes` map keyed by `providerID/modelID`. A `note` token SHALL appear in the row footer (in `theme.info`, truncated) when a note exists. Notes SHALL NOT be indexed by the search filter in v1.

#### Scenario: Add a note from DialogConfig

- **WHEN** the user opens `DialogConfig` for a model with no existing note, selects `Note` (title: `Add note...`), types `fast for refactors`, and presses `Enter`
- **THEN** `notes["<providerID>/<modelID>"]` is set to `fast for refactors` in `state/model.json`
- **AND** the row footer shows a `note` token in `theme.info`

#### Scenario: Edit a note from DialogConfig

- **WHEN** the user opens `DialogConfig` for a model with an existing note, selects `Note` (title: `Note: <truncated>`), edits the text, and presses `Enter`
- **THEN** the note is replaced with the new text

#### Scenario: Clear a note from DialogConfig

- **WHEN** the user opens `DialogConfig`, selects `Note`, deletes all text, and presses `Enter`
- **THEN** the note entry for that key is removed from `notes`
- **AND** the row footer no longer shows the `note` token
- **AND** the `Note` option title returns to `Add note...`

#### Scenario: Cancel restores previous note

- **WHEN** the user opens `DialogConfig`, selects `Note`, edits the text, and presses `Esc`
- **THEN** the note is unchanged
- **AND** the dialog returns to `DialogConfig` without saving

#### Scenario: Notes are not searched

- **WHEN** the user types a query that matches a model's note text but not its title or category
- **THEN** the model does not appear in the filtered results

#### Scenario: Note option shows current value

- **WHEN** `DialogConfig` is opened for a model with an existing note
- **THEN** the `Note` option's title is `Note: <truncated note text>` (no surrounding quote marks)

#### Scenario: Note option placeholder when empty

- **WHEN** `DialogConfig` is opened for a model with no existing note
- **THEN** the `Note` option's title is `Add note`

#### Scenario: Model list does not expose note shortcut

- **WHEN** the model list is rendered
- **THEN** the `actions[]` array does not contain a `model.dialog.note` entry
- **AND** the `n` key is not bound to note editing in the model list

## REMOVED Requirements

### Requirement: Variant Footer Action

**Reason:** The variant picker is now reached automatically when a variant-capable model is selected (the existing post-select flow in `dialog-model-flow.ts:resolveVariantApply`). Exposing a separate `model.dialog.variant` action in the model list and a `Variants` option in `DialogConfig` is redundant. The `model.dialog.variant` command ID is no longer needed and is removed from the keymap.

**Migration:** Users who previously pressed `v` to open the variant picker from the model list still reach the picker automatically by selecting a variant-capable model and choosing a variant. There is no need to rebind any key. The `model_variant_list` keybind and the `model.dialog.variant` command ID MAY be removed from `config/keybind.ts` in the same change.

## ADDED Requirements

### Requirement: Consolidated Model Edit Entry

The model list SHALL provide a `model.dialog.config` footer action (binding `c`) that opens a new `DialogConfig` submenu. The submenu SHALL expose, in order: `Set favorite` / `Clear favorite`, `Set hidden` / `Clear hidden`, `Note`, and `Set vision fallback` / `Clear vision fallback`. Only one of the `Set` / `Clear` pair SHALL be visible for each binary state, depending on the current value. The `Note` option SHALL always be visible. The submenu SHALL remain open after a direct toggle so the user can adjust multiple settings in one visit. The model list's `actions[]` array SHALL also retain `model.dialog.favorite` (binding `ctrl+f`, per `keybind.ts:121`) and `model.dialog.hide` (binding `h`, per `keybind.ts:122`) as direct shortcuts in the action bar. The `model.dialog.favorite` action label SHALL toggle between `Favorite` and `Unfavorite` based on the highlighted model's current favorite state; the `model.dialog.hide` action label SHALL toggle between `Hide` and `Unhide` based on the highlighted model's current hidden state. The `model.dialog.note` (binding `n`) action SHALL NOT appear in the model list. The `model.dialog.favorite` and `model.dialog.hide` command IDs SHALL remain registered in the keymap and SHALL also be triggerable from inside `DialogConfig`.

#### Scenario: Edit model entry opens DialogConfig

- **WHEN** the user triggers `model.dialog.config` from the model list (binding `c`)
- **THEN** the dialog pushes `DialogConfig` for the highlighted model
- **AND** `DialogConfig` shows the current state of each setting in option titles

#### Scenario: Model list retains favorite and hide shortcuts

- **WHEN** the model list renders
- **THEN** the `actions[]` array contains `model.dialog.provider`, `model.dialog.favorite` (binding `ctrl+f`), `model.dialog.hide` (binding `h`), and `model.dialog.config` (binding `c`)
- **AND** `model.dialog.note` is not present in the array

#### Scenario: Set favorite flips favorite state

- **WHEN** a model is not currently favorited and the user selects `Set favorite` from `DialogConfig`
- **THEN** the model is added to `favorite` in `state/model.json`
- **AND** the `Set favorite` option is replaced by `Clear favorite` on next render

#### Scenario: Clear favorite flips favorite state

- **WHEN** a model is currently favorited and the user selects `Clear favorite` from `DialogConfig`
- **THEN** the model is removed from `favorite` in `state/model.json`
- **AND** the `Clear favorite` option is replaced by `Set favorite` on next render

#### Scenario: DialogConfig stays open after a direct toggle

- **WHEN** the user selects `Set favorite` or `Clear favorite` from `DialogConfig`
- **THEN** `DialogConfig` remains open showing the updated state
- **AND** the user can immediately select another option without re-entering

#### Scenario: DialogConfig has no Variants option

- **WHEN** `DialogConfig` is opened
- **THEN** the option list does not contain a `Variants` entry
- **AND** `DialogConfig` does not push `DialogVariant`

#### Scenario: Note is only reachable from DialogConfig

- **WHEN** the user is in the model list
- **THEN** pressing `n` does not open `DialogNote`
- **AND** the user must press `c` to open `DialogConfig` and then select `Note`

### Requirement: Vision Fallback Submenu And Picker

The `DialogConfig` submenu SHALL expose per-model vision-fallback options as a single visible row (same shape as the Favorite / Hide pattern above), not a Set+Clear pair:

1. `No fallback needed (vision-capable)` (only when the model is vision-capable: `caps.attachment || caps.input.image || caps.input.pdf`) — an informational row. Vision-capable models do not need a fallback because they can already process images / PDFs directly, so the Set / Clear actions are hidden to avoid noise. The row is rendered without `disabled: true` because `DialogSelect` filters `disabled: true` options out unconditionally at `dialog-select.tsx:162`; the row has no `onSelect`, so pressing Enter on it is a no-op.
2. `Set fallback vision model (<suffix>)` (only when the model is text-only AND has NO per-model entry) — pushes the `DialogFallback` picker and routes the user's pick to `local.model.setModelAttachmentFallback(model, target)`. The `<suffix>` is one of:
   - `global: <providerID>/<modelID>` when the global fallback is set (no per-model entry exists).
   - Omitted entirely when neither the global nor a per-model entry is set.
   - The `current` prop passed to the picker is the global fallback (or `null` if no global is set) so the picker shows the `Currently:` label reflecting the inherited value.
3. `Clear fallback vision model: <target>` (only when the model is text-only AND has a per-model entry) — calls `local.model.clearModelAttachmentFallback(model)` and remains in `DialogConfig`. The `<target>` is the per-model override value the action will remove; an explicit opt-out shows `(none)`.

To change the per-model value when one is set, the user selects `Clear` (which removes the entry and falls back to the inherited global), then selects `Set` and picks a new model. This is the same two-step pattern as Clear favorite → Set favorite. The three rows above are mutually exclusive: exactly one is visible at any time.

There SHALL NOT be a separate `Use global fallback (...)` status row — the row's own label carries the current state, so a separate non-selectable row would be redundant noise.

`DialogConfig` SHALL NOT contain any "Set global fallback" or "Clear global fallback" option. The global default is configured separately via the `/vision-fallback` slash command (see the Global Vision Fallback Slash Command requirement).

`DialogFallback` is a stateless picker modeled on `DialogVariant`. It accepts an optional `commit` callback (default: no-op) and an optional `current` target (displayed as the `Currently:` label header). Selecting a vision model in `DialogFallback` SHALL call `commit({ providerID, modelID })` and `dialog.pop()`. `Esc` from `DialogFallback` SHALL return to the caller without changing any stored fallback. The picker SHALL list only models with `capabilities.input.image === true` or `capabilities.attachment === true` or `capabilities.input.pdf === true`. When the caller supplies `clearLabel` and `onClear` props, the picker SHALL insert a clear row between the `Currently:` header and the model list; selecting it SHALL call `onClear()` and `dialog.pop()`. The `/vision-fallback` slash command supplies these props so the user can clear the global from inside the picker; `DialogConfig` does NOT (it has its own `Clear` row in the submenu).

#### Scenario: Set per-model override from submenu

- **WHEN** the model has no per-model entry and the user selects `Set fallback vision model` from `DialogConfig`
- **THEN** `DialogFallback` opens, listing vision-capable models
- **AND** selecting a model and pressing `Enter` calls `commit({ providerID, modelID })` which calls `setModelAttachmentFallback(model, ...)`
- **AND** `state/model.json` is rewritten with `modelAttachmentFallback[modelKey]` populated
- **AND** the dialog returns to `DialogConfig`
- **AND** the submenu now shows `Clear fallback vision model: <target>` instead of `Set fallback vision model`

#### Scenario: Set parenthetical shows global target

- **WHEN** no per-model entry exists and the global is `opencode/glm-4.6v`
- **THEN** `DialogConfig` shows `Set fallback vision model (global: opencode/glm-4.6v)`
- **WHEN** neither a per-model entry nor a global is set
- **THEN** `DialogConfig` shows `Set fallback vision model` (no parenthetical)

#### Scenario: Clear per-model override

- **WHEN** the current model has a per-model override and the user selects `Clear fallback vision model: <target>` from `DialogConfig`
- **THEN** `clearModelAttachmentFallback(model)` is called
- **AND** the per-model entry is removed from `state/model.json`
- **AND** `fallbackFor(model)` falls back to the global value (or `undefined`)
- **AND** `DialogConfig` remains open
- **AND** the submenu now shows `Set fallback vision model (<global: <target> or no suffix>)` instead of `Clear fallback vision model: <target>`

#### Scenario: Clear target label is (none) for opt-out

- **WHEN** the current model has a per-model entry of `null` (explicit opt-out)
- **THEN** `DialogConfig` shows `Clear fallback vision model: (none)` and selecting it calls `clearModelAttachmentFallback(model)`, which removes the entry from `state/model.json`

#### Scenario: Vision-capable model shows informational row

- **WHEN** the user opens `DialogConfig` for a model with `caps.attachment === true || caps.input.image === true || caps.input.pdf === true`
- **THEN** the vision-fallback section shows a row `No fallback needed (vision-capable)`
- **AND** the row is rendered without `disabled: true` (so it is not filtered out by `DialogSelect`); pressing Enter on it is a no-op because the row has no `onSelect`
- **AND** the section does NOT show `Set fallback vision model` or `Clear fallback vision model: <target>`, regardless of whether a global or per-model entry is set
- **AND** the model is omitted from the `DialogFallback` picker (the picker lists only models that pass the vision-capable filter for selection, not for display)

#### Scenario: Set and Clear are mutually exclusive

- **WHEN** the user opens `DialogConfig` for any model
- **THEN** exactly one of `Set fallback vision model` or `Clear fallback vision model: <target>` is visible (never both, never neither)
- **AND** `Set fallback vision model` is visible only when no per-model entry exists
- **AND** `Clear fallback vision model: <target>` is visible only when a per-model entry exists

#### Scenario: DialogConfig never shows global-fallback options

- **WHEN** the user opens `DialogConfig` for any model
- **THEN** the option list does not contain a `Set global fallback` row
- **AND** the option list does not contain a `Clear global fallback` row
- **AND** the only fallback action is the per-model `Set fallback vision model` or `Clear fallback vision model: <target>` (whichever is applicable)

#### Scenario: Picker lists only vision-capable models

- **WHEN** `DialogFallback` is open
- **THEN** the option list contains only models with `capabilities.input.image === true` or `capabilities.attachment === true` or `capabilities.input.pdf === true`
- **AND** text-only models are not listed

#### Scenario: Picker shows current target

- **WHEN** `DialogFallback` is opened with a `current` target
- **THEN** the first entry of the option list shows `Currently: <providerID>/<modelID>` reflecting the supplied target
- **AND** the entry is non-selectable

#### Scenario: Picker omits current header when no current target

- **WHEN** `DialogFallback` is opened with no `current` target
- **THEN** the option list does not contain a `Currently:` header entry

#### Scenario: Picker omits clear row when caller did not pass clearLabel

- **WHEN** `DialogFallback` is opened without `clearLabel` and `onClear` props (e.g. from `DialogConfig`)
- **THEN** the option list does not contain a clear row between the `Currently:` header and the model list
- **AND** the only way to clear the per-model entry is via the `Clear fallback vision model: <target>` row in `DialogConfig`

#### Scenario: Picker shows clear row when caller passes clearLabel

- **WHEN** the user runs `/vision-fallback` with a global fallback set
- **THEN** `DialogFallback` is pushed with `clearLabel="Clear global vision fallback"` and `onClear={local.model.clearAttachmentFallback}`
- **AND** the picker inserts a `Clear global vision fallback` row between the `Currently:` header and the model list
- **AND** selecting it calls `clearAttachmentFallback()` and returns to the prompt

#### Scenario: Esc from picker preserves previous fallback

- **WHEN** a fallback is set and the user opens `DialogFallback`, then presses `Esc` without selecting
- **THEN** the stored fallback is unchanged
- **AND** the dialog returns to the caller (`DialogConfig` or the prompt)

### Requirement: Global Vision Fallback Slash Command

The TUI SHALL register a `vision-fallback` entry in `sessionCommandList` (`packages/tui/src/routes/session/index.tsx`). The entry's `slash.name` is `vision-fallback` with alias `vf`. The entry's `title` is `Set vision fallback`, `category` is `Session`, `value` is `session.vision_fallback`. Selecting or running the command (via the prompt's slash autocomplete, the command palette, or directly via `session.vision_fallback`) SHALL push `DialogFallback` with `commit={(target) => local.model.setAttachmentFallback(target)}` and `current` set to the current global fallback (or `null` when unset). The command SHALL be visible in the prompt's slash-command autocomplete when the user types `/vision-fallback` or `/vf`. The command SHALL NOT be exposed as a footer action in the model list, and SHALL NOT appear inside `DialogConfig`.

#### Scenario: Slash command sets the global fallback

- **WHEN** no global fallback is set and the user types `/vision-fallback` in the prompt
- **THEN** the slash-command autocomplete shows `Set vision fallback` as a match
- **AND** pressing Enter opens `DialogFallback` with `current: null`
- **AND** selecting a model and pressing Enter calls `commit(target)` which calls `setAttachmentFallback(target)`
- **AND** `state/model.json` is rewritten with `attachmentFallback` populated

#### Scenario: Slash command with alias

- **WHEN** the user types `/vf` in the prompt
- **THEN** the slash-command autocomplete shows `Set vision fallback` as a match (matched via the `vf` alias)
- **AND** pressing Enter opens `DialogFallback` with the current global fallback as `current`

#### Scenario: Slash command shows current target in picker

- **WHEN** the global fallback is `{ providerID: "opencode", modelID: "glm-4.6v" }` and the user runs `/vision-fallback`
- **THEN** `DialogFallback` opens with a `Currently: opencode/glm-4.6v` header entry
- **AND** the picker shows the current target above the model list

#### Scenario: Slash command shows clear row when global is set

- **WHEN** the global fallback is set and the user runs `/vision-fallback`
- **THEN** the picker contains a `Clear global vision fallback` entry between the `Currently:` header and the model list
- **AND** selecting the clear row and pressing `Enter` calls `clearAttachmentFallback()`
- **AND** `state/model.json` is rewritten with `attachmentFallback: null`
- **AND** the picker closes and returns to the prompt

#### Scenario: Slash command omits clear row when no global

- **WHEN** no global fallback is set and the user runs `/vision-fallback`
- **THEN** the picker does NOT contain a `Clear global vision fallback` entry
- **AND** the picker shows only the model list

#### Scenario: Per-model picker never shows a clear row

- **WHEN** the user opens `DialogConfig` and selects `Set fallback vision model`
- **THEN** the picker does NOT contain a clear row between the `Currently:` header and the model list
- **AND** the user clears the per-model entry via the `Clear fallback vision model: <target>` row in `DialogConfig` instead

#### Scenario: Slash command picker shows clear row when global is set

- **WHEN** a global fallback is set and the user runs `/vision-fallback`
- **THEN** the picker contains a `Clear global vision fallback` entry between the `Currently:` header and the model list
- **AND** selecting the clear row and pressing `Enter` calls `clearAttachmentFallback()`
- **AND** `state/model.json` has `attachmentFallback: null`
- **AND** the picker closes and returns to the prompt

#### Scenario: Slash command is not in the model list action bar

- **WHEN** the user opens the model list and inspects the footer action bar
- **THEN** the action bar does not contain a `vision-fallback` entry
- **AND** the action bar contains only `provider` / `favorite` / `hide` / `config`

#### Scenario: Slash command is not inside DialogConfig

- **WHEN** the user opens `DialogConfig` for any model
- **THEN** the option list does not contain a `Set global fallback` row
- **AND** the option list does not contain a `Clear global fallback` row
