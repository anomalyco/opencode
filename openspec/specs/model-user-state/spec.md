# model-user-state Specification

## Purpose
TBD - created by archiving change model-selection-ui. Update Purpose after archive.
## Requirements
### Requirement: Model User State Persistence Shape

Per-user model personalization SHALL be persisted in `state/model.json` (TUI user-scope state) with the shape `{ recent, favorite, variant, hidden, notes }`. `recent` and `favorite` SHALL be arrays of `{ providerID, modelID }`. `variant` SHALL be a `Record<string, string | undefined>` keyed by `providerID/modelID`. `hidden` SHALL be an array of `{ providerID, modelID }`. `notes` SHALL be a `Record<string, string>` keyed by `providerID/modelID`. The file SHALL be written atomically via the existing `writeJsonAtomic` helper.

#### Scenario: All five keys persisted
- **WHEN** the user has favorites, recents, a variant selection, a hidden model, and a note
- **THEN** `state/model.json` contains `recent`, `favorite`, `variant`, `hidden`, and `notes` keys in one atomic write

#### Scenario: Missing keys default to empty
- **WHEN** `state/model.json` is absent or lacks `hidden` / `notes`
- **THEN** the model store initializes `hidden` to `[]` and `notes` to `{}`
- **AND** no error is raised

### Requirement: Defensive Loading Of New Keys

The model store loader SHALL read `hidden` only when `Array.isArray(value.hidden)` is true, and SHALL read `notes` only when `typeof value.notes === "object" && value.notes !== null` is true. Unknown or malformed keys SHALL be ignored without failing startup.

#### Scenario: Old model.json without new keys loads fine
- **WHEN** `state/model.json` contains only `recent`, `favorite`, and `variant`
- **THEN** the store loads with `hidden: []` and `notes: {}`
- **AND** no error is raised

#### Scenario: Malformed hidden is ignored
- **WHEN** `state/model.json` has `hidden: "gpt-4"` (a string, not an array)
- **THEN** the store ignores `hidden` and initializes it to `[]`
- **AND** startup continues

#### Scenario: Malformed notes is ignored
- **WHEN** `state/model.json` has `notes: "fast"` (a string, not an object)
- **THEN** the store ignores `notes` and initializes it to `{}`
- **AND** startup continues

### Requirement: Hidden Model Gating In Validity Check

`isModelValid(model)` SHALL return `false` when the model is in the user's `hidden` list. All existing call sites that use `isModelValid` (fallback-model resolution, `getFirstValidModel`, `cycleFavorite`, agent-configured-model validity toasts) SHALL inherit the hidden filter through this single gate.

#### Scenario: Hidden model is not valid
- **WHEN** `isModelValid` is called for a model in the `hidden` list
- **THEN** it returns `false`

#### Scenario: Fallback resolution skips hidden model
- **WHEN** the fallback-model resolution would select a hidden model (because it is the first recent or the provider default)
- **THEN** the next non-hidden valid model is selected instead

#### Scenario: cycleFavorite skips hidden favorites
- **WHEN** a hidden model is in the `favorite` list and the user triggers `cycleFavorite`
- **THEN** the hidden favorite is skipped

### Requirement: Hide And Unhide Operations

The model store SHALL expose `isHidden(model)`, `toggleHidden(model)`, and `hidden()` (returning the current list). `toggleHidden` SHALL add the model to `hidden` if absent, or remove it if present, and SHALL persist via `save()`. The currently-running model SHALL remain the active session's model after being hidden.

#### Scenario: Toggle hidden on adds to list
- **WHEN** `toggleHidden` is called for a model not in `hidden`
- **THEN** the model is appended to `hidden` and `state/model.json` is rewritten

#### Scenario: Toggle hidden off removes from list
- **WHEN** `toggleHidden` is called for a model already in `hidden`
- **THEN** the model is removed from `hidden` and `state/model.json` is rewritten

#### Scenario: Hiding active model does not switch selection
- **WHEN** `toggleHidden` is called for the model running in the active session
- **THEN** the active session's `model` entry is unchanged
- **AND** the model is added to `hidden`

### Requirement: Note Operations

The model store SHALL expose `note(model)` returning the note string for `providerID/modelID` (empty string when absent) and `setNote(model, text)` that sets, replaces, or clears the note (empty string clears the entry) and persists via `save()`. The note key SHALL be the literal `providerID/modelID` string.

#### Scenario: Set a note
- **WHEN** `setNote({ providerID: "anthropic", modelID: "claude-sonnet-4-5" }, "fast for refactors")` is called
- **THEN** `notes["anthropic/claude-sonnet-4-5"]` is `"fast for refactors"` in the store and in `state/model.json`

#### Scenario: Clear a note
- **WHEN** `setNote(model, "")` is called for a model with an existing note
- **THEN** the `notes` entry for that key is deleted
- **AND** `note(model)` returns `""`

#### Scenario: Read a note
- **WHEN** `note({ providerID: "anthropic", modelID: "claude-sonnet-4-5" })` is called and no note exists
- **THEN** it returns `""`

#### Scenario: Note survives restart
- **WHEN** the user sets a note, restarts KanCode, and opens the model dialog
- **THEN** the note is loaded from `state/model.json` and displayed in the row

