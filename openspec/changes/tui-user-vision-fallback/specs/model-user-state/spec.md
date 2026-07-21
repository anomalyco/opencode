## MODIFIED Requirements

### Requirement: Model User State Persistence Shape

Per-user model personalization SHALL be persisted in `state/model.json` (TUI user-scope state) with the shape `{ recent, favorite, variant, hidden, notes, attachmentFallback, modelAttachmentFallback }`. `recent` and `favorite` SHALL be arrays of `{ providerID, modelID }`. `variant` SHALL be a `Record<string, string | undefined>` keyed by `providerID/modelID`. `hidden` SHALL be an array of `{ providerID, modelID }`. `notes` SHALL be a `Record<string, string>` keyed by `providerID/modelID`. `attachmentFallback` SHALL be `{ providerID, modelID } | null` representing the global vision-fallback target. `modelAttachmentFallback` SHALL be a `Record<string, { providerID, modelID } | null>` keyed by `providerID/modelID`, where each value is either a target object (per-model override) or `null` (explicit opt-out — no fallback for this model even if the global is set). The file SHALL be written atomically via the existing `writeJsonAtomic` helper.

#### Scenario: All seven keys persisted

- **WHEN** the user has favorites, recents, a variant selection, a hidden model, a note, a global vision fallback, and a per-model vision fallback set
- **THEN** `state/model.json` contains `recent`, `favorite`, `variant`, `hidden`, `notes`, `attachmentFallback`, and `modelAttachmentFallback` keys in one atomic write

#### Scenario: Missing keys default to empty

- **WHEN** `state/model.json` is absent or lacks `attachmentFallback` / `modelAttachmentFallback`
- **THEN** the model store initializes `attachmentFallback` to `null` and `modelAttachmentFallback` to `{}`
- **AND** no error is raised

### Requirement: Defensive Loading Of New Keys

The model store loader SHALL read `hidden` only when `Array.isArray(value.hidden)` is true, SHALL read `notes` only when `typeof value.notes === "object" && value.notes !== null` is true, SHALL read `attachmentFallback` only when `value.attachmentFallback` is an object with `providerID` and `modelID` string fields or is `null`, and SHALL read `modelAttachmentFallback` only when `typeof value.modelAttachmentFallback === "object" && value.modelAttachmentFallback !== null` is true. When loading each entry of `modelAttachmentFallback`, the loader SHALL accept either an object with `providerID` and `modelID` string fields, or the literal `null` (explicit opt-out). Unknown or malformed keys SHALL be ignored without failing startup.

#### Scenario: Old model.json without new keys loads fine

- **WHEN** `state/model.json` contains only `recent`, `favorite`, and `variant`
- **THEN** the store loads with `hidden: []`, `notes: {}`, `attachmentFallback: null`, and `modelAttachmentFallback: {}`
- **AND** no error is raised

#### Scenario: Malformed attachmentFallback is ignored

- **WHEN** `state/model.json` has `attachmentFallback: "opencode/glm-4.6v"` (a string, not an object)
- **THEN** the store ignores `attachmentFallback` and initializes it to `null`
- **AND** startup continues

#### Scenario: Malformed modelAttachmentFallback is ignored

- **WHEN** `state/model.json` has `modelAttachmentFallback: ["opencode/glm-4.6v"]` (an array, not an object)
- **THEN** the store ignores `modelAttachmentFallback` and initializes it to `{}`
- **AND** startup continues

## ADDED Requirements

### Requirement: Vision Fallback Operations

The model store SHALL expose `attachmentFallback()` returning the global fallback target or `undefined` when unset, `setAttachmentFallback(target)` that sets the global value and persists via `save()`, `clearAttachmentFallback()` that sets the global to `null` and persists via `save()`, and `hasAttachmentFallback()` returning a boolean. The store SHALL also expose `modelAttachmentFallback(model)` returning the per-model override for the model (target object, `null` for explicit opt-out, or `undefined` for no entry), `setModelAttachmentFallback(model, target)` that sets the per-model override and persists via `save()`, `clearModelAttachmentFallback(model)` that removes the per-model entry (so the model falls back to the global) and persists via `save()`, and `fallbackFor(model)` returning the effective fallback target — the per-model override if a key is present (including `null` for explicit opt-out), otherwise the global. Setting a per-model override to `null` (via `setModelAttachmentFallback(model, null)`) is supported and means "this model has no fallback at all" (overriding the global). All setters accept a target of the form `{ providerID, modelID }` matching the existing `recent` / `favorite` / `hidden` entry shape.

#### Scenario: Set the global fallback

- **WHEN** `setAttachmentFallback({ providerID: "opencode", modelID: "glm-4.6v" })` is called
- **THEN** `attachmentFallback()` returns `{ providerID: "opencode", modelID: "glm-4.6v" }`
- **AND** `state/model.json` is rewritten with `attachmentFallback` populated

#### Scenario: Clear the global fallback

- **WHEN** `clearAttachmentFallback()` is called and a fallback was previously set
- **THEN** `attachmentFallback()` returns `undefined`
- **AND** `state/model.json` is rewritten with `attachmentFallback: null`

#### Scenario: Read unset fallback

- **WHEN** no fallback has been set
- **THEN** `attachmentFallback()` returns `undefined`
- **AND** `hasAttachmentFallback()` returns `false`

#### Scenario: Set fallback survives restart

- **WHEN** the user sets a fallback, restarts KanCode, and opens the model dialog
- **THEN** the fallback is loaded from `state/model.json`
- **AND** `hasAttachmentFallback()` returns `true`

#### Scenario: Set per-model override

- **WHEN** `setModelAttachmentFallback({ providerID: "zhipu", modelID: "glm-5.2" }, { providerID: "opencode", modelID: "kimi-k2-vision" })` is called
- **THEN** `modelAttachmentFallback({ providerID: "zhipu", modelID: "glm-5.2" })` returns `{ providerID: "opencode", modelID: "kimi-k2-vision" }`
- **AND** `state/model.json` has `modelAttachmentFallback["zhipu/glm-5.2"]` set to that object

#### Scenario: Set per-model override to null (opt-out)

- **WHEN** `setModelAttachmentFallback({ providerID: "zhipu", modelID: "glm-5.2" }, null)` is called
- **THEN** `modelAttachmentFallback({ providerID: "zhipu", modelID: "glm-5.2" })` returns `null`
- **AND** `state/model.json` has `modelAttachmentFallback["zhipu/glm-5.2"]` set to `null`
- **AND** `fallbackFor` for this model returns `undefined` (not the global)

#### Scenario: Clear per-model override

- **WHEN** `clearModelAttachmentFallback({ providerID: "zhipu", modelID: "glm-5.2" })` is called and a per-model entry was set
- **THEN** `modelAttachmentFallback({ providerID: "zhipu", modelID: "glm-5.2" })` returns `undefined`
- **AND** the `modelAttachmentFallback` key is removed from `state/model.json`
- **AND** `fallbackFor` for this model returns the global value (or `undefined` if no global)

#### Scenario: fallbackFor returns per-model override when present

- **WHEN** the global is `{ providerID: "opencode", modelID: "glm-4.6v" }` AND the per-model override for `zhipu/glm-5.2` is `{ providerID: "opencode", modelID: "kimi-k2-vision" }`
- **THEN** `fallbackFor({ providerID: "zhipu", modelID: "glm-5.2" })` returns `{ providerID: "opencode", modelID: "kimi-k2-vision" }`

#### Scenario: fallbackFor returns global when no per-model override

- **WHEN** the global is `{ providerID: "opencode", modelID: "glm-4.6v" }` AND no per-model entry exists for `zhipu/glm-5.2`
- **THEN** `fallbackFor({ providerID: "zhipu", modelID: "glm-5.2" })` returns `{ providerID: "opencode", modelID: "glm-4.6v" }`

#### Scenario: fallbackFor returns undefined when per-model override is null

- **WHEN** the global is `{ providerID: "opencode", modelID: "glm-4.6v" }` AND the per-model entry for `zhipu/glm-5.2` is `null`
- **THEN** `fallbackFor({ providerID: "zhipu", modelID: "glm-5.2" })` returns `undefined`
- **AND** the global is NOT used (explicit opt-out)

#### Scenario: fallbackFor returns undefined when nothing is set

- **WHEN** no global and no per-model entries exist
- **THEN** `fallbackFor(model)` returns `undefined`

### Requirement: Per-Model Fallback Overrides

The model store SHALL load, persist, and mutate a `modelAttachmentFallback` map keyed by `providerID/modelID` with values of `{ providerID, modelID } | null`. `setModelAttachmentFallback(model, target)` stores a target override; `setModelAttachmentFallback(model, null)` stores an explicit opt-out (the model has no fallback even if the global is set); `clearModelAttachmentFallback(model)` removes the entry so the model inherits the global. The defensive loader accepts a map of target objects or `null` values. An entry value of `null` is meaningful (opt-out) and is preserved across restart.

#### Scenario: Per-model override survives restart

- **WHEN** the user sets a per-model override, restarts KanCode, and opens the model dialog for that model
- **THEN** the override is loaded from `state/model.json`
- **AND** `modelAttachmentFallback(model)` returns the stored target

#### Scenario: Explicit null override survives restart

- **WHEN** the user sets a per-model opt-out (`setModelAttachmentFallback(model, null)`), restarts KanCode, and opens the model dialog
- **THEN** the entry is loaded as `null`
- **AND** `fallbackFor(model)` returns `undefined` even if the global is set

#### Scenario: Clearing per-model override restores global inheritance

- **WHEN** a per-model override is set and the user calls `clearModelAttachmentFallback(model)`
- **THEN** `modelAttachmentFallback(model)` returns `undefined`
- **AND** `fallbackFor(model)` returns the global value
