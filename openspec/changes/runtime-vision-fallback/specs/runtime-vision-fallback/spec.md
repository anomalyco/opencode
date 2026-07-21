## ADDED Requirements

### Requirement: Resolve user-scope vision fallback from model state

The session runtime SHALL resolve the effective vision-fallback target for the primary model from `state/model.json` under the KanCode user state directory (`Global.Path.state`), using the same keys the TUI persists: `attachmentFallback` and `modelAttachmentFallback`. Resolution order SHALL be: (1) if `modelAttachmentFallback["<providerID>/<modelID>"]` is present, use that value (object target or `null` opt-out); (2) otherwise use `attachmentFallback`. Malformed values SHALL be ignored the same way the TUI defensive loader does. Missing file or missing keys SHALL mean “no fallback configured.”

#### Scenario: Per-model override wins over global

- **WHEN** the primary is `ollama-cloud/deepseek-v4-flash`, `modelAttachmentFallback` maps that key to `{ providerID: "ollama-cloud", modelID: "gemma4:31b" }`, and `attachmentFallback` points elsewhere
- **THEN** the runtime selects `ollama-cloud/gemma4:31b` as the effective fallback

#### Scenario: Global used when no per-model entry

- **WHEN** the primary has no key in `modelAttachmentFallback` and `attachmentFallback` is `{ providerID: "ollama-cloud", modelID: "gemma4:31b" }`
- **THEN** the runtime selects that global target

#### Scenario: Explicit per-model opt-out disables global

- **WHEN** `modelAttachmentFallback["provider/model"]` is `null` and a global `attachmentFallback` is set
- **THEN** the runtime treats the primary as having no vision fallback

#### Scenario: Unset fallback leaves legacy error path

- **WHEN** neither a per-model entry nor a global `attachmentFallback` is set
- **THEN** the runtime does not invent a fallback model and unsupported media remains subject to `unsupportedParts` ERROR text

### Requirement: Describe unsupported image and PDF parts via vision side-pass

When preparing outbound `ModelMessage[]` for the primary agent loop, if the primary model lacks `capabilities.input.image` and/or `capabilities.input.pdf`, and the messages contain file/image parts of those unsupported modalities, and an effective vision fallback target is resolved, the runtime SHALL invoke that fallback model in a tools-disabled side-pass to produce a text description for each unsupported part, replace the media part with that text (including a clear label that it came from the fallback), and then send the rewritten messages to the primary model. The primary session model SHALL NOT be swapped for the turn.

#### Scenario: Text-only primary with configured fallback receives description

- **WHEN** the primary model has `capabilities.input.image === false`, the outbound messages include an image part (user attach or Read-tool synthetic injection), and an effective fallback vision model is configured and loadable
- **THEN** the image part is replaced with a text description from the fallback model before the primary stream
- **AND** the primary model does not receive the `ERROR: Cannot read ... (this model does not support image input)` string for that part

#### Scenario: Vision-capable primary is unchanged

- **WHEN** the primary model has `capabilities.input.image === true` and messages include image parts
- **THEN** the runtime does not run the vision side-pass for those parts
- **AND** the image parts remain for the primary model

#### Scenario: PDF unsupported on primary uses fallback when capable

- **WHEN** the primary lacks `capabilities.input.pdf`, messages include a PDF file part, and the effective fallback model supports PDF or image input sufficient to describe it
- **THEN** the PDF part is rewritten to a text description via the side-pass

#### Scenario: Side-pass failure falls back to legacy error

- **WHEN** an effective fallback is configured but the side-pass fails to load the model or returns empty/error text
- **THEN** the original media part is left in place so `unsupportedParts` can emit the existing ERROR text
- **AND** the primary turn still proceeds without crashing the session loop

### Requirement: Surface describe result in the session transcript

When the vision side-pass successfully describes unsupported media on the current (last) user message, the runtime SHALL persist one synthetic+ignored text part per description on that user message, with `metadata.visionFallback: true` and the fallback provider/model/modality. The TUI SHALL render those parts as a collapsible “Vision fallback” section under the user message (collapsed by default when the body is long). The persisted part SHALL NOT be sent again to the primary model as ordinary user text (`ignored`), and SHALL NOT appear as the user’s typed bubble (`synthetic`).

#### Scenario: Successful describe appears under the user message

- **WHEN** a text-only primary turn triggers a successful vision describe for an attached image
- **THEN** the session stores a synthetic+ignored text part with `metadata.visionFallback`
- **AND** the TUI shows a “Vision fallback” section with the description body

#### Scenario: Describe is not double-fed to the primary

- **WHEN** a vision-fallback transcript part exists on the user message
- **THEN** `toModelMessages` omits it because it is `ignored`
- **AND** the primary still receives the outbound rewritten description text from the side-pass path

### Requirement: No Protocol or kancode.json dependency for v1

The v1 runtime vision fallback SHALL read only user-scope `state/model.json` (KanCode paths). It SHALL NOT require Schema/Protocol/Server/Client changes, SHALL NOT write `kancode.json`, and SHALL NOT depend on TUI packages.

#### Scenario: CLI and TUI share the same store

- **WHEN** the TUI has written `attachmentFallback` to `state/model.json` and the user continues in a session driven by `packages/kancode`
- **THEN** the runtime reads that same file and honors the configured fallback without an extra API round-trip
