## Context

`tui-user-vision-fallback` already persists:

```jsonc
{
  "attachmentFallback": { "providerID": "...", "modelID": "..." } | null,
  "modelAttachmentFallback": {
    "provider/model": { "providerID": "...", "modelID": "..." } | null
  }
}
```

in `Global.Path.state/model.json` (XDG state, e.g. `~/.local/state/kancode/model.json` on Linux; Windows equivalent). The TUI and CLI already share this path (`packages/tui` via runtime `paths.state`; `packages/kancode` via `Global.Path.state` — same XDG app dir `kancode`).

Runtime path today:

1. `SessionPrompt` builds `ModelMessage[]` via `MessageV2.toModelMessagesEffect` (user attaches + Read-tool images injected as synthetic user file parts).
2. `LLM.stream` → `ProviderTransform.message` → `unsupportedParts()` strips any modality the primary `model.capabilities.input` lacks into an ERROR text part.

Confirmed repro: text-only primary (`ollama-cloud/deepseek-v4-flash`) with global fallback (`ollama-cloud/gemma4:31b`) still receives the ERROR string; fallback is never invoked.

Upstream OpenCode feature requests (#24948 / #22828) describe the same product intent: **auto-describe via a vision side-pass**, then feed text to the primary — not swap the session model.

## Goals / Non-Goals

**Goals:**

- Resolve effective fallback: per-model map entry (including explicit `null` opt-out) first, else global `attachmentFallback`.
- When primary lacks `image`/`pdf` input and messages contain those parts, invoke the fallback model to describe each unsupported part and replace it with text before the primary stream.
- Leave vision-capable primaries untouched.
- When no fallback is configured (or opted out), keep today’s ERROR behavior from `unsupportedParts`.
- Stay inside `packages/kancode` session/provider code; read user state only from KanCode paths.
- Persist successful describe results as synthetic+ignored text parts on the user message so the TUI can show a collapsible “Vision fallback” section without feeding the text back into the primary as a second user bubble.

**Non-Goals:**

- Protocol/Server/Client schema changes or `bun run generate`.
- `kancode.json` config keys for fallback (follow-up).
- Auto-discovering a vision model when none is configured.
- Audio/video modality fallback.
- A full second assistant message for the describe side-pass.
- Changing TUI model-dialog / `/vision-fallback` picker UX from `tui-user-vision-fallback` (this change only adds transcript rendering).

## Decisions

### 1. Describe side-pass (not model swap)

**Decision:** Before `handle.process` / primary `llm.stream`, rewrite unsupported image/PDF `ModelMessage` parts into text descriptions produced by a one-shot vision model call. The session’s primary model ID stays unchanged.

**Why:** Matches user-scope “fallback-vision” product language and upstream OpenCode #24948. Swapping the primary for the turn would change tools/agent behavior and surprise users who picked a coding model on purpose.

**Alternative considered:** Temporarily route the whole turn to the vision model — rejected (wrong cost/latency profile; breaks “coding model + vision helper” intent).

### 2. Read `state/model.json` from Core/app runtime (no Protocol)

**Decision:** Add a small helper (e.g. `packages/kancode/src/session/model-state.ts` or under `provider/`) that reads `path.join(Global.Path.state, "model.json")` with the same defensive validation the TUI uses, and exposes `fallbackFor(primary: { providerID, modelID })`.

**Why:** Package boundaries: Client/TUI may use Schema/Protocol; Core/session must not depend on TUI. The file is already shared user state (`Provider.defaultModel` already reads `recent` from it). Passing fallback on every HTTP prompt would require Protocol changes the proposal explicitly avoids.

**Alternative considered:** Plumb fallback through prompt request body — rejected for v1 (TUI↔server Protocol churn; CLI/`bun run` would still need the file).

### 3. Hook after `toModelMessagesEffect`, before primary process

**Decision:** In `packages/kancode/src/session/prompt.ts` (main agent loop), after `MessageV2.toModelMessagesEffect(msgs, model)`:

```
modelMsgs = yield* VisionFallback.describeUnsupported({
  messages: modelMsgs,
  model,
  sessionID,
  user: lastUser,
})
```

Then pass rewritten messages into `handle.process`. Compaction / title paths that intentionally `stripMedia` stay unchanged.

**Why:** At this point media from user attaches and Read-tool synthetic injections are already present as file/image parts. `unsupportedParts` still runs later as a safety net for any remaining unsupported modalities.

**Alternative considered:** Patch `unsupportedParts` itself — rejected because it is sync and cannot call the LLM.

### 4. Scope of media rewritten

**Decision:** Rewrite only parts whose MIME maps to `image` or `pdf` **and** for which `model.capabilities.input[modality] === false`. Do not touch parts the primary already supports. Do not invent audio/video fallbacks.

**Why:** The TUI picker selects vision-capable targets (`input.image` / `attachment` / `input.pdf`). Matching those modalities keeps runtime aligned with what users can configure.

### 5. Side-pass invocation shape

**Decision:** Reuse the existing `LLM.stream` + hidden-agent pattern from title generation:

- Resolve fallback model via `Provider.getModel`.
- If fallback model itself lacks the needed modality, skip describe for that part (leave for `unsupportedParts` ERROR).
- Call `llm.stream` with `small: true`, empty tools, a dedicated describe system/user prompt, and the single media part.
- Collect text deltas; wrap as:

  ```
  [Image description via <provider>/<model>]: <text>
  ```

  (or `[PDF description via ...]`).

- Prefer a built-in hidden agent (e.g. `vision` / reuse a minimal inline `Agent.Info`) with tools denied — same as `title`.

**Why:** Keeps one LLM entrypoint, auth/provider options, and abort wiring. Avoids a second HTTP client.

### 6. Failure behavior

**Decision:**

| Case | Behavior |
|------|----------|
| No fallback / explicit opt-out `null` | No rewrite; `unsupportedParts` ERROR as today |
| Fallback model missing / unloadable | Log + leave part; ERROR as today |
| Describe call fails / empty text | Leave original part; ERROR as today |
| Primary already supports modality | No-op |

Do **not** silently invent another vision model.

### 7. Caching

**Decision:** No persistent describe cache in v1. Re-describe on each turn that still includes the media in the outbound prompt window. (History compaction that strips media avoids re-work naturally.)

**Why:** Correctness over micro-optimization; caching would need content-addressed keys and invalidation.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Extra latency/cost per image turn | Only runs when primary lacks modality **and** fallback is set; `small: true` options where applicable |
| Fallback provider auth missing | Fail soft to ERROR; user already sees vision picker across providers in TUI |
| Describe quality varies by model | Prompt asks for factual UI/code/diagram detail useful for coding agents |
| Double-transform if describe leaves a file part | Always replace with text; never leave image MIME for a non-vision primary |
| Reading model.json on every step | Cheap JSON read; optional later memoization |
| Compaction / title paths accidentally describe | Only wire the main prompt loop; leave `stripMedia` callers alone |

## Migration Plan

- Additive runtime behavior; no state migration.
- Existing `model.json` with fallback keys starts working without TUI changes.
- Rollback: remove the describe hook; store keys remain harmless.

## Open Questions

1. ~~Should describe results be persisted into session parts?~~ **Resolved:** Persist as `synthetic: true` + `ignored: true` text parts on the **last user message** with `metadata.visionFallback`, so the TUI can render a collapsible section without double-feeding the primary (`ignored` skips `toModelMessages`; `synthetic` skips the normal user bubble). Outbound rewrite for the primary remains separate and still runs each turn.
2. ~~Should the user see a TUI toast/status while describing?~~ Deferred — optional UX polish; transcript section is the v1 visibility surface.
