# Rollover — Phase 0 Findings (OpenCode fork compatibility spike)

Status legend: `verified` | `fallback selected` | `STOP`. All runs against the isolated fork binary
(`dist/rollover-test/cli-darwin-arm64`), mock LLM on 127.0.0.1, sandbox under `/tmp/opencode-rollover-*`.

## Environment (recorded 2026-11-15)

| Item | Value |
|---|---|
| Fork root | `/Users/omeryasirkucuk/Desktop/omeryasirkucuk/Works/rollover/opencode` |
| Branch | `dev` |
| Commit SHA | `e3ed63c7de33ac90d326d3a4a3ccc4cd89312ca5` |
| OpenCode version | 2.3.0 source; built binary reports `opencode v0.0.0-dev-202611151753` |
| Bun version | 1.4.4 |
| Global install (untouched) | Desktop app `/Applications/OpenCode.app`; CLI `~/Library/Application Support/ai.opencode.desktop/cli/2.3.0-arm64/opencode-cli`; config `~/.config/opencode/opencode.json` |
| Isolation mechanism | `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_CACHE_HOME` / `XDG_STATE_HOME` → `packages/util/src/global-roots.ts`; `OPENCODE_CONFIG_DIR` → `packages/cli/src/server-process.ts:39`, `packages/util/src/global.ts:79` |
| Headless driver | `opencode run "msg" [-s <sessionID>] [-c] [-m provider/model]` (`packages/cli/src/commands/commands.ts:400`) |
| Serve + auth | `opencode serve --port N` prints Basic password to stdout; client uses `-u opencode:<pw>` (`packages/server/src/auth.ts:20`, `middleware/authorization.ts:33`) |
| Pre-existing fork modifications | none (`git status` clean at baseline) |

## P0 investigations

| # | Question | Status | Observation (empirical) | Consequence |
|---|---|---|---|---|
| P0-0 | Provider config shape for local OpenAI-compatible endpoint | **verified** | `opencode.json` (v1 format) in `OPENCODE_CONFIG_DIR`: `provider.<id>.npm = "@ai-sdk/openai-compatible"` (mapped to builtin `@opencode/ai/providers/openai-compatible`, `aisdk-native.ts:127`), `options.baseURL`, `models.<id>.limit.context/output`. `model: "provider/id"` pin + `-m` flag both work. Config key for provider SDK is **`npm`** (v1), not `package` (v2 schema) | Sandbox config template fixed in `spike/run-p0.sh`; benchmark uses same shape |
| P0-1 | Transform-equivalent hook fires per LLM step with full history | **verified** | `ctx.session.hook("context", cb)` fires once per primary model request; messages array = full transcript each call (msgsLen 1 → 3 across a 2-step tool flow). Retries re-fire with the same history (11 connection-error retries = 11 calls) | `onTransform` equivalent registered on `context` only; decision state must be idempotent per user message |
| P0-2 | Hook mutation reaches model only, not DB/UI | **verified** | Spike deleted `messages[0]` on a 3-message call (`SPIKE_MUTATE=delete-first` → newLen 2). The model payload lacked it (mock-llm recorded body). Continuing the session next turn showed the original message back at index 0 (msgsLen 5, firstText = original prompt). Session DB/continuation unaffected | In-place `splice` on `event.messages` is model-facing only. Architecture holds |
| P0-3 | sessionID source | **verified** | `event.sessionID` present on context/idle/tool hooks; `event.model = {providerID, id, variant}` also present | Use `event.sessionID` directly (better than spec's msgs[0] fallback) |
| P0-4 | Message/part shapes; message identity | **verified** | LLM-level `Message` classes: user/assistant messages carry real session message ids (`msg_…`); `tool`-role messages have `id: null`; tool-call part `{type:"tool-call", id, name, input, providerExecuted}`; tool-result part `{type:"tool-result", id, name, result:{type,value}}`; pairing by part `id`. Fixtures: `tests/fixtures/p0/context-*.json` | Cursors use message `id` when present (user/assistant); tool-role messages never carry cursors. D4 fingerprint needed only as defensive fallback |
| P0-5 | Usage semantics; context formula | **verified** | `session.usage.updated` events (ephemeral) with `data: {sessionID, cost, tokens: {input, output, reasoning, cache: {read, write}}}`; per-step values match scripted mock usage. `session.usage.recorded` is the durable variant | `ctx = tokens.input + cache.read + cache.write` per completed step via `event.subscribe` |
| P0-6 | Background wake-up identification | **verified** | `ctx.session.hook("experimental.idle")` fires with `background: [{kind:"shell", sessionID, shellID, command}]` while running, then again with `[]` after completion. The wake-up step arrives as a **user message whose text starts with `<shell id="sh_…" state="completed" command="…"`.** | Wake-ups identifiable by `<shell id=` prefix → treat as synthetic in decideSwap (no swap on them); open_item process handling uses the same marker. Fallback rule (all-user-messages-real) not needed |
| P0-7 | Stateless extraction call | **verified** | `ctx.experimental.generate.text({ prompt, model: {providerID, id} })` → `{ text }` — no session created, no tools run (mock tool-call script not executed for it). Requires explicit `model` when the session default is unset | D2 confirmed: extraction/consolidation via generate.text; usage unavailable → metrics tokens null |
| P0-8 | Command registration + invocation | **verified** | `ctx.command.transform(editor.add({name, execute}))` — direct execution, zero LLM calls for dispatch. Invoked via `POST /api/session/<sid>/command {name, text}` (TUI `/`-commands use the same path). Response 204; plugin `execute` ran | `/rollover` command = direct execute (cheaper than spec's subtask fallback; no `command.execute.before` needed). Reply via session message API |
| P0-9 | Small/summary model resolution | **verified** | v1 config key `small_model: "provider/id"` accepted (`config/normalize.ts:137` legacy normalization) | Resolution order: `cfg.extractionModel` → `small_model` (config file read) → omit model (session default) |
| P0-10 | Plugin loading | **verified** | `.opencode/plugin/*.ts` file loaded with **default export `{ id, effect }`** (`core/src/plugin/module.ts:81-94`); log line `loading plugin` confirms; host provides `effect` and `@opencode/plugin/*` module specifiers to plugin code (`plugin/src/runtime-modules.ts`) | Adapter entry = default-export effect plugin; no build step needed for local loading |
| P0-11 | Compaction events | **verified** | Event names in schema: `session.compaction.started/delta/ended/failed` (`schema/src/session-event.ts:600-637`). Compaction hook `ctx.session.hook("compaction")` exists and is NOT registered by us (D5) | Log-only per spec §5; harness compaction untouched |
| P0-12 | Tool names + file-arg extraction | **verified** | Tool names: `shell` (NOT bash; input `{command, background?}`), `edit`/`write`/`patch` (input `{path}`), `read`, `glob`, `grep`, `subagent`, `todowrite` (`core/src/tool/plugin/*.ts` `export const name`). `tool.execute.before/after` events carry tool, sessionID, messageID, callID, input | §8.7 tool set: edit/write/patch (no multiedit in 2.x); path from `input.path`; delta bash lines read `shell` tool name |
| P0-13 | TUI toast from a plugin | **verified (API), visual check deferred** | TUI plugin API confirmed from source: `define({id, setup(ctx)})` with `ctx.toast.show({message, variant, sessionID})` (`plugin/src/tui/context.ts:269-282,492`). Headless runs have no TUI; visual confirmation happens in Task 17 with the real TUI | D3 bridge: TUI plugin polls state.json; effect plugin only persists `lastRollover` |
| P0-14 | Model context limit lookup | **verified** | `ctx.model.transform(editor => editor.get(providerID, id))` → `Model.Info` with `limit: {context, output}` (logged `{context: 100000, output: 4000}`) | Threshold computation uses this per session; hook event supplies the ref |

## Stop conditions

Neither architectural stop condition fired: the transform-equivalent hook executes for every primary model request (P0-1) and mutations stay model-facing (P0-2). Implementation proceeds.

## Operational notes discovered during the spike

- `opencode run` with no `-m` and unreachable config providers falls back to models.dev defaults and may hit **real providers using ambient env credentials**. All Rollover drivers must (a) always pass `-m`, (b) scrub `*KEY*/*TOKEN*/*SECRET*` env vars (run-p0.sh does both).
- `Bun.write` overwrites; plugin-side JSONL logging must append (node:fs `appendFileSync`).
- Tool-role messages never carry message ids; assistant tool-call parts and tool-result parts pair by part `id` — never break these pairs when projecting (Review Focus #3).
- The context hook also fires for model retries; swap decisions must be keyed by user-message id (already in the contract).
- `session.usage.updated` is ephemeral (no replay after restart); `session.usage.recorded` is the durable variant. Track lastContextTokens from either, tolerating missed events (estimate fallback).
