# model-selection-ui Specification

## Purpose

TUI `/models` dialog: two-pane layout for unscoped selection (Favorites / Recent / Hidden / providers), rich per-row metadata, hide/note/variant footer actions, and narrow-terminal single-column fallback. Provider-scoped flows stay single-column.

## Requirements
### Requirement: Two-Pane Model Dialog For Unscoped Model Selection

The `/models` command (model dialog with no `providerID`) SHALL render a two-pane layout: a left pane listing Favorites, Recent, Hidden, providers, and Connect-provider, and a right pane rendering the selected left entry's models. Provider-scoped model selection (when `providerID` is supplied by the caller, e.g. from `dialog-provider.tsx`) SHALL keep the existing single-column `DialogSelect` behavior unchanged.

#### Scenario: Opening /models shows two panes
- **WHEN** the user invokes `/models` (no providerID) and the terminal is at least 70 columns wide
- **THEN** the dialog renders a left provider/section pane and a right models pane
- **AND** the right pane initially shows the current model's provider

#### Scenario: Provider-scoped flow stays single column
- **WHEN** `DialogModel` is rendered with a `providerID` prop (from `dialog-provider.tsx` or the title-model command)
- **THEN** the dialog renders the existing single-column `DialogSelect` for that provider's models only
- **AND** no left provider pane is shown

#### Scenario: Narrow terminal falls back to single column
- **WHEN** the terminal is narrower than 70 columns
- **THEN** the unscoped `/models` dialog renders the existing single-column `DialogSelect` behavior
- **AND** no horizontal squish occurs

### Requirement: Pane Focus And Keyboard Navigation

The two-pane dialog SHALL own a `focusedPane` signal that routes arrow-key navigation to the focused `DialogSelect`. `Tab` / `Shift-Tab` SHALL move focus between panes when no footer action is focused. `Enter` SHALL select from the focused pane.

#### Scenario: Tab moves between panes
- **WHEN** the left pane is focused and the user presses `Tab`
- **THEN** focus moves to the right pane
- **AND** subsequent arrow keys scroll the right pane

#### Scenario: Enter on a provider row focuses the right pane
- **WHEN** the left pane is focused on a provider row and the user presses `Enter`
- **THEN** the right pane focuses on that provider's model list
- **AND** no model is selected yet

#### Scenario: Enter on a model row selects it
- **WHEN** the right pane is focused on a model row and the user presses `Enter`
- **THEN** the model is selected via the existing `onSelect` path
- **AND** the dialog closes (or chains to `DialogVariant` as today)

### Requirement: Rich Per-Row Model Metadata

Each model row SHALL display the model name, a cost token (`$input/$output` per 1M tokens, colored `theme.success` when `cost.input === 0`), a context-limit token humanized from `limit.context` (omitted when absent), a `★` favorite indicator, and a muted capability line listing `reasoning`, `tools` (from `capabilities.toolcall`), `vision` (when `input.image` or `input.pdf`), `audio-in`/`audio-out`, `image-out`, and `ALPHA`/`BETA` status badges. Provider headers SHALL include the provider name, visible model count, and a price range computed from the visible models' cost min/max.

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

### Requirement: Sort Refinements

Within an equal `release_date`, models SHALL sort by `limit.context` descending, then by name. When a search query is active, options from the current model's provider SHALL rank ahead of equally-scored options from other providers. Deprecated models SHALL remain filtered out.

#### Scenario: Same release date sorts by context size
- **WHEN** two models share `release_date` and one has `limit.context === 200000` while the other has `limit.context === 1000000`
- **THEN** the 1M-context model sorts first

#### Scenario: Query boosts current provider
- **WHEN** the current model is on `anthropic` and the user types `sonnet` (matching models on both `anthropic` and a different provider with equal fuzzysort score)
- **THEN** the Anthropic matches sort ahead of the other provider's matches

### Requirement: Hide And Unhide Models

The model dialog SHALL provide a `model.dialog.hide` footer action (key `f`) that toggles the hidden state of the highlighted model. Hidden models SHALL be excluded from Favorites, Recent, Popular, provider counts, `cycleFavorite`, and fallback-model resolution. A `⌧ Hidden` left-pane entry SHALL list hidden models with an Unhide affordance, and SHALL be omitted from the left pane when zero models are hidden. Hiding the currently-running model SHALL NOT change the active session's model.

#### Scenario: Hide removes model from listings
- **WHEN** the user triggers `model.dialog.hide` on a visible model
- **THEN** the model is added to `hidden` in `state/model.json`
- **AND** the model disappears from Favorites, Recent, provider counts, and the right pane on next render

#### Scenario: Hidden model cannot become fallback
- **WHEN** a model is hidden and would otherwise be the first valid recent or provider default
- **THEN** `fallbackModel` resolution skips it
- **AND** the next valid model is selected

#### Scenario: Hidden section appears only when non-empty
- **WHEN** zero models are hidden
- **THEN** the left pane does not show a `⌧ Hidden` row
- **WHEN** one or more models are hidden
- **THEN** the left pane shows `⌧ Hidden (N)`

#### Scenario: Unhide restores model
- **WHEN** the right pane is showing the Hidden section and the user triggers the unhide action on a model
- **THEN** the model is removed from `hidden`
- **AND** it reappears under its provider in the left pane

#### Scenario: Hiding active model does not switch session
- **WHEN** the user hides the model currently running in the active session
- **THEN** the active session continues using that model
- **AND** a toast confirms the model is hidden but the current session is unaffected

### Requirement: Model Notes

The model dialog SHALL provide a `model.dialog.note` footer action (key `n`) that opens a single-line input dialog prefilled with the existing note. `Enter` SHALL save the note (empty input clears it); `Esc` SHALL cancel and restore the previous value. Notes SHALL be persisted in `state/model.json` under a `notes` map keyed by `providerID/modelID`. A `✎` token SHALL appear in the row footer (in `theme.info`, truncated) when a note exists. Notes SHALL NOT be indexed by the search filter in v1.

#### Scenario: Add a note
- **WHEN** the user triggers `model.dialog.note` on a model with no existing note, types `fast for refactors`, and presses `Enter`
- **THEN** `notes["<providerID>/<modelID>"]` is set to `fast for refactors` in `state/model.json`
- **AND** the row footer shows a `✎` token in `theme.info`

#### Scenario: Edit a note
- **WHEN** the user triggers `model.dialog.note` on a model with an existing note, edits the text, and presses `Enter`
- **THEN** the note is replaced with the new text

#### Scenario: Clear a note
- **WHEN** the user triggers `model.dialog.note`, deletes all text, and presses `Enter`
- **THEN** the note entry is removed from `notes`
- **AND** the row footer no longer shows the `✎` token

#### Scenario: Cancel restores previous note
- **WHEN** the user triggers `model.dialog.note`, edits the text, and presses `Esc`
- **THEN** the note is unchanged
- **AND** the dialog closes without saving

#### Scenario: Notes are not searched
- **WHEN** the user types a query that matches a model's note text but not its title or category
- **THEN** the model does not appear in the filtered results

### Requirement: Variant Footer Action

The model dialog SHALL provide a `model.dialog.variant` footer action (key `v`) that opens `DialogVariant` for the highlighted model when it has a non-empty `variants` map. The action SHALL be hidden when the highlighted model has no variants.

#### Scenario: Variants action visible for variant-capable model
- **WHEN** the highlighted model has a non-empty `variants` map
- **THEN** the `Variants` footer action is visible and labeled `v`

#### Scenario: Variants action hidden for plain model
- **WHEN** the highlighted model has no `variants` map
- **THEN** the `Variants` footer action is hidden

#### Scenario: Variants action opens DialogVariant
- **WHEN** the user triggers `model.dialog.variant` on a model with variants
- **THEN** the dialog replaces the current view with `DialogVariant` for that model

