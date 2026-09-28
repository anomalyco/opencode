# Recon A — model / tools / agent / prompt / request shaping / CLI

Cartographer report (Phase 0). The import path is `opencode/<path>` (the package exports `"./*": "./src/*.ts"`). "graph" means the number of modules transitively bundled from that entry point (measured with `bun build --metafile`).

| module | import path | key exports | required services | blockers | verdict |
|---|---|---|---|---|---|
| LLM client | `@opencode-ai/llm`, `@opencode-ai/llm/route` | LLMClient, Provider, Tool, ToolFailure, ToolRuntime.dispatch, isContextOverflow, LLM.request/stream/generate, LLMEvent (index.ts:1-34) | `LLMClient.layer` needs `RequestExecutor.Service` → `RequestExecutor.fetchLayer` (route/executor.ts:383) | none (only schema/effect/smithy/aws4fetch) | import |
| openai-compatible | `@opencode-ai/llm/providers/openai-compatible` | `configure({baseURL, apiKey?, provider?, headers?, generation?, limits?}).model(id)` (:22) | same | – | import |
| anthropic | `@opencode-ai/llm/providers/anthropic` | `configure({baseURL?, apiKey?}).model(id)`, falls back to ANTHROPIC_API_KEY | same | – | import |
| stream events | `@opencode-ai/llm` | text-start/delta/end, reasoning-start/delta/end, tool-input-*, tool-call, tool-result, tool-error, step-start, step-finish{usage}, finish{reason,usage}, provider-error (schema/events.ts:78-201); Usage (:51); `LLMEvent.is.*` | – | – | import |
| Tool.define | `opencode/tool/tool` | define, Context, InvalidArgumentsError | Truncate.Service + Agent.Service | graph 3,134 modules incl. server/tui | copy (~100 lines) |
| truncate | `opencode/tool/truncate` | MAX_LINES=2000, MAX_BYTES=50K, output() | FSUtil | graph 1,362 incl. database | copy |
| read/write/edit/apply_patch | `opencode/tool/*` | – | InstanceState, FSUtil, LSP, EventV2Bridge, Format, Watcher, Snapshot | bus, LSP | copy |
| glob/grep | `opencode/tool/*` | – | InstanceState, FSUtil, Ripgrep (core) | Tool.define graph | copy, reusing `@opencode-ai/core/ripgrep` |
| shell | `opencode/tool/shell`, `opencode/tool/shell/prompt` | ShellPrompt.render | Config, Plugin, RuntimeFlags, … | Plugin | copy the tool; path-import `shell/prompt` |
| webfetch/todo/skill | – | – | HttpClient / Todo / Skill | – | copy |
| task | `opencode/tool/task` | Parameters | Session, DB, … | heavy | copy the contract |
| registry | `opencode/tool/registry` | – | ~25 services | – | copy the selection logic |
| core v2 tools | `@opencode-ai/core/tool/*` | Tool.make, ToolRegistry, BuiltInTools | Location, PermissionV2 (DB), ToolOutputStore | graph 480-671 incl. sqlite | evaluate in Phase 1 |
| subagent perms | `opencode/agent/subagent-permissions` | `deriveSubagentSessionPermission({parentSessionPermission, subagent}): Ruleset` (:14) | none (type-only Agent import) | graph 1 | path-import |
| Agent.Info | `opencode/agent/agent` | name, description, mode, native, hidden, topP, temperature, color, permission, model, variant, prompt, options, steps (35-55) | heavy | – | copy the schema |
| AgentV2 | `@opencode-ai/core/agent` | ID, Info, Service | State | graph 119 | import |
| ConfigAgentV1 | `@opencode-ai/core/v1/config/agent` | Info | – | graph 86 | import |
| markdown | `@opencode-ai/core/config/markdown` | ConfigMarkdown.parse, sanitize | – | graph 45 | import |
| agent loader | `opencode/config/agent` | load(dir) | – | `@/` aliases | copy (~30 lines) |
| variable subst | `opencode/config/variable` | substitute | – | `@/util/filesystem` | path-import or copy |
| system prompt | `opencode/session/system` | provider(model) | heavy | graph 2,471 | copy the selection; import the `.txt` files |
| instructions/reminders | `opencode/session/{instruction,reminders}` | – | heavy | – | copy |
| transform | `opencode/provider/transform` | maxOutputTokens, options | none at runtime | graph 11; type-imports `ai` | path-import or copy |

## LLM details
- `request.http.body` is deep-merged over the protocol body (route/transport/http.ts:73-85).
  - A denylist (:31-68) blocks model, messages, stream, stream_options, max_tokens, tools, tool_choice, temperature, top_p, seed, stop, thinking.
  - `chat_template_kwargs`, `prompt_cache_key`, `parallel_tool_calls` and `reasoning_effort` are allowed.
- `stream_options.include_usage` is always sent (openai-chat.ts:360).
- Only `delta.reasoning_content` is decoded (openai-chat.ts:147, 419). `delta.reasoning` is not decoded, and there is no `<think>` splitting.

## Ground-truth corrections
1. `Tool.define` and truncation can't be path-imported (graph 3.1k incl. server and tui), so both are copied.
2. Built-in tools use InstanceState/bus/LSP, so none import cleanly. Core v2 tools exist but were left out of the spec.
3. The shell description is a template: 1,269 chars rendered to 4,672.
4. default.txt is 8,528 chars (≈2,132 tok), not 9,300.
5. Request-shaping flags are keyed on `api.npm` rather than provider id. gpt-5 ids get reasoningEffort from any provider. `prompt_cache_key` is sent only for deepinfra and cerebras.
6. In opencode `@opencode-ai/llm` native is opt-in; the AI SDK is the default runtime.
7. Task tool:
   - Background mode is gated by `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` (task.ts:98-101).
   - Depth is `subagent_depth ?? 1`.
   - Parameters: description, prompt, subagent_type, task_id?, command?, background? (42-62).
   - Envelope: `<task id="…" state="running|completed|error">[<summary>…</summary>]<task_result>|<task_error>…</task>` (64-79).
8. `packages/cli` has no `exports`.

## Baseline (local build agent, 11 tools)
| item | chars | ≈tok |
|---|---|---|
| default.txt | 8,528 | 2,132 |
| bash (rendered) | 4,672 | |
| read | 1,158 | |
| glob | 517 | |
| grep | 657 | |
| edit | 1,369 | |
| write | 623 | |
| task | 2,305 | |
| webfetch | 750 | |
| todowrite | 2,012 | |
| skill | 399 | |
| question | 657 | |
| **tool descriptions** | **15,119** | **≈3,780** |
| task agent list | ~680 | ~170 |

Total with ~1,000 of schema envelopes and ~125 of env/skills: ≈ 7,200 tok (the spec says 7,300; within ±10%).

## packages/cli
The framework imports Daemon (→ server/auth, sdk) and has no exports, so it can't be imported. The reusable part is on `effect/unstable/cli` (bundled with effect). The options are to copy about 60 lines or to use yargs 18.

## Risks
- The `@/` alias may break when oclite imports opencode files. Smoke-test before relying on path-imports.
- vLLM `delta.reasoning` is not decoded.
- The http.body denylist blocks `thinking`.
- Copying tools is roughly 1,700 lines of forked code.
- Truncate forks an hourly cleanup fiber.
- Hidden gates: `question` depends on OPENCODE_CLIENT, background on an experimental flag.
