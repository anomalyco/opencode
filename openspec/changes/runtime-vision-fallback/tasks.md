## 1. Model-state resolver

- [x] 1.1 Add `packages/kancode/src/session/model-state.ts` that reads `path.join(Global.Path.state, "model.json")` with defensive validation matching the TUI loader for `attachmentFallback` / `modelAttachmentFallback`
- [x] 1.2 Export `fallbackFor(primary: { providerID: string; modelID: string })` implementing per-model-then-global resolution (including explicit `null` opt-out → no fallback)
- [x] 1.3 Unit-test resolver cases: per-model wins, global fallback, opt-out, missing/malformed file

## 2. Vision describe side-pass

- [x] 2.1 Add `packages/kancode/src/session/vision-fallback.ts` that scans `ModelMessage[]` for image/PDF parts unsupported by the primary model
- [x] 2.2 Implement describe Effect: resolve fallback via `fallbackFor`, load fallback model with `Provider.getModel`, skip when unset/unloadable/fallback lacks modality
- [x] 2.3 For each unsupported part, call `LLM.stream` (tools empty, `small: true`, hidden agent / inline agent mirroring title generation) with a describe prompt; replace part with labeled text description
- [x] 2.4 On describe failure or empty text, leave the original part unchanged (legacy `unsupportedParts` ERROR path)

## 3. Wire into prompt loop

- [x] 3.1 In `packages/kancode/src/session/prompt.ts`, after `MessageV2.toModelMessagesEffect` in the main agent loop, run the vision-fallback rewrite before `handle.process`
- [x] 3.2 Do not wire compaction/title/`stripMedia` paths; leave vision-capable primaries as no-ops

## 4. Transcript visibility

- [x] 4.1 Return `surfaces` from `describeUnsupported` for the last user message; persist as synthetic+ignored text parts with `metadata.visionFallback` in `prompt.ts` (dedupe if already present)
- [x] 4.2 TUI: render collapsible “Vision fallback” section under the user message for those parts
- [x] 4.3 Update openspec design/spec to lift the “ephemeral only” non-goal

## 5. Tests and verify

- [x] 5.1 Add tests for message rewrite (unsupported image → description text; vision primary unchanged; no fallback → unchanged) and surface collection
- [x] 5.2 Run `bun typecheck` from `packages/kancode` and `packages/tui`
- [x] 5.3 Run the new/related tests from package dirs (not repo root)
