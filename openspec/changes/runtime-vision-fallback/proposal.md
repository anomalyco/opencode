## Why

The TUI already persists a user-scope vision fallback (`attachmentFallback` / `modelAttachmentFallback` in `state/model.json`), but the session runtime never reads it. When the primary model lacks image input, `ProviderTransform.unsupportedParts()` still replaces image parts with `ERROR: Cannot read ... (this model does not support image input)`. Users configure a fallback and still get a dead-end error — the feature is incomplete until the runtime honors the same store.

## What Changes

- **Honor user-scope vision fallback at runtime** — before the primary model stream runs, if the primary lacks image/PDF input and the message history contains those media parts, resolve the effective fallback from `state/model.json` (per-model override first, then global; honor explicit `null` opt-out) and run a **describe side-pass** on a vision-capable fallback model.
- **Replace stripped media with usable text** — image/PDF parts that the primary cannot accept are rewritten to text descriptions produced by the fallback model, so the primary receives content instead of the hard error string. Vision-capable primaries are unchanged.
- **Shared store, no Protocol churn** — read the same `Global.Path.state/model.json` file the TUI already writes (same path `Provider.defaultModel` already uses for `recent`). No Schema/Protocol/Server/Client changes and no `bun run generate`.
- **Keep TUI picker UX intact** — do not regress the existing `tui-user-vision-fallback` dialogs/store; reuse the same key names and resolution order. Transcript may show a collapsible describe section.

Non-goals:

- `kancode.json`-level `attachment.image.fallback_model` / per-model config schema (separate follow-up).
- Session-scope per-turn override.
- Swapping the primary session model to the vision model for the whole turn.
- Changing TUI model dialogs, keybinds, or capability-line UI.
- Auto-picking an arbitrary vision model when no fallback is configured (fail as today when unset / opted out).
- Emitting a second full assistant message for the describe side-pass.

## Capabilities

### New Capabilities

- `runtime-vision-fallback`: session runtime resolves user-scope vision fallback from `state/model.json` and auto-describes unsupported image/PDF parts via a vision side-pass before the primary model call.

### Modified Capabilities

- _(none — existing `model-user-state` already defines the store shape; this change consumes it at runtime without changing those TUI requirements)_

## Impact

- `packages/kancode/src/session/` — new vision-fallback module; wire into the main prompt loop after `toModelMessagesEffect` and before `handle.process`.
- `packages/kancode/src/provider/` or session helpers — shared resolver for `attachmentFallback` / `modelAttachmentFallback` from `state/model.json` (mirrors defensive TUI loaders).
- `packages/kancode/test/` — unit/integration coverage for resolution order, opt-out, describe rewrite, and no-op when primary already supports vision.
- No TUI store/UI changes required for correctness (coordinate key names only).
- No Protocol / Server / Client / SDK generation.
