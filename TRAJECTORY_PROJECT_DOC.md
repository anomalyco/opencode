# Trajectory Recording – Architecture, Philosophy, and Spec

## Purpose
- Provide a single reference for how OpenCode records complete execution trajectories (sessions, tools, streams, compaction, summaries).
- Document architecture touchpoints, design principles, required data, storage format, configuration, and testing expectations.

## Architecture Snapshot
- **Session loop** (`packages/opencode/src/session/prompt.ts`): Drives agent steps. Creates assistant messages, resolves system prompts/tools, streams LLM responses, handles subtasks and compaction, records session start/end and per-step events.
- **LLM calls**:
  - Main loop: `streamText` in `prompt.ts`
  - Title + summary generation: `generateText` in `packages/opencode/src/session/summary.ts`
  - Compaction summaries: `streamText` in `packages/opencode/src/session/compaction.ts`
- **Stream processing** (`packages/opencode/src/session/processor.ts`): Consumes stream events (text, reasoning, tool calls/results, step boundaries) and records them when stream capture is enabled.
- **Tools** (`resolveTools` in `prompt.ts`): Wraps tool execution, records start/completion/error with full args and outputs. Covers built-ins, MCP tools, and TaskTool subtasks.
- **Storage** (`packages/opencode/src/session/index.ts` + `message-v2.ts`): Persists messages/parts; recorder writes JSONL trajectories to disk.
- **Compaction** (`packages/opencode/src/session/compaction.ts`): Triggers when context overflows; records compaction lifecycle and its LLM call.

## Design Philosophy
- Always-on by default; opt-out only if explicitly disabled.
- Record everything verbatim: no truncation or redaction of inputs, outputs, tool args/results, or stream deltas.
- Fail fast on recording errors (disk, permissions) instead of silently dropping data.
- Accurate accounting: never default input/output/cache tokens to zero; require real usage from providers. Totals are mandatory per interaction and per session.
- Minimal branching defensiveness; correctness over hiding issues.
- Simple, explicit step numbering for correlating events.
- JSONL format for append-only, stream-friendly writes and easy analysis.

## Spec – What to Record
- **File format**: JSONL at `.opencode/trajectories/trajectory_{sessionID}_{timestamp}.jsonl` by default (configurable path/template).
- **Event types**:
  - `session_start`: session metadata (agent, model, cwd/root, config).
  - `agent_step`: loop boundaries and exit checks with step index.
  - `llm_interaction`: all LLM calls (main loop, title, summary, compaction) with full prompts, responses, finish reason, timing, and usage totals (`input`, `output`, `cache` read/write + totals).
  - `tool_execution`: start/completed/error with full args, outputs, metadata, timing; includes MCP and TaskTool subtasks.
  - `stream_event`: optional per-delta events from `streamText` (text, reasoning, tool-call/result, step-finish, finish).
  - `compaction`: start/prune/summarize/end details and resulting summary text.
  - `session_end`: final status (completed/aborted/error), totals (tokens, costs, counts, steps), and any error info.
- **Token accounting**:
  - Each interaction includes `totalInputTokens`, `totalOutputTokens`, `totalCacheTokens` in addition to per-part fields.
  - Session totals accumulate actual usage only; zeros are not acceptable defaults.
- **Payload integrity**: store full tool inputs/outputs and LLM prompts/responses; keep ordering; flush at end of each LLM stream and on session end.

## Configuration
- Defaults: recording enabled, output dir `.opencode/trajectories`, filename template `trajectory_{sessionID}_{timestamp}.jsonl`.
- Config (via `opencode.json[c]`): disable recording, override directory, override filename template, toggle stream event capture.
- Model/provider defaults follow loaded providers; offline mode removed (real models or explicit env-provided models must be used and at least one provider must exist).

## Testing Expectations
- Unit: recorder JSONL writing, buffering/flush, template resolution, error fail-fast.
- Integration: full conversation with all event types, tool success/error, compaction path, stream-event capture.
- Network E2E: optional test hitting a real provider when `OPENCODE_NETWORK_PROVIDER` and `OPENCODE_NETWORK_MODEL` are set; asserts non-zero tokens.
- Running tests: `cd packages/opencode && bun test test/trajectory` (set env vars for network test when desired).

## Operational Notes
- Trajectories live in `.opencode/trajectories` with session/timestamped filenames.
- To run this version locally: `cd packages/opencode && bun dev` for UI/dev server or `bun run src/index.ts` to launch the CLI; ensure the `opencode` command points to this workspace build when invoking.
