# oclite — architecture (Phase 1)

Status: design only, no code. Companion: `docs/ADR.md` (one line per reuse decision). Inputs: `docs/SPEC.md`,
`docs/recon/A-*.md`, `docs/recon/B-*.md`, `docs/PROGRESS.md`. Values marked **[R]** in SPEC stay [R] here.
Items marked **[LEAD]** need a lead or human decision (collected in §15).

## 0. Measurements behind the big decisions

Warm `bun -e 'await import(X)'` from `packages/oclite` (wall time, 3 runs; `bun -e 1` = 0.01 s). Module
counts from `Bun.build({metafile})`, run in the scratchpad.

| entry | wall s | modules | notes |
|---|---|---|---|
| `effect` | 0.08 | – | paid by everything |
| `effect` + `@opencode-ai/llm` + openai-compatible + anthropic | 0.12 | 158 (llm) | no db/server/tui |
| `effect/unstable/cli` + `@effect/platform-node/{NodeServices,NodeRuntime}` | 0.11 | – | CLI framework, no new dep |
| yargs 18 (standalone) | 0.04–0.07 | – | would need a new `package.json` entry |
| planned startup set (effect, llm, cli, ConfigAgentV1, ConfigMCPV1, ConfigMarkdown, Wildcard, subagent-permissions, redact) | 0.17–0.18 | – | status line can print at about 0.2 s |
| `opencode/mcp/index` (MCP.Service) | 0.43–0.52 | 1,620 | 126 db/drizzle modules, server + tui files |
| SDK client + stdio + streamableHttp + sse | 0.09–0.11 | ~175 | |
| `opencode/mcp/catalog` | 0.15 | 151 | pulls `ai` for `dynamicTool` |
| `opencode/mcp/auth` | 0.21 | 192 | imports `core/global`, which mkdirs `~/.local/share/opencode/*` on import |
| `opencode/mcp/oauth-provider` / `oauth-callback` | 0.10 / – | 49 / 3 | |
| `opencode/permission/index` | 0.25 | 434 | 126 db modules via EventV2Bridge |
| `opencode/config/variable` | 0.19 | 185 | via `@/util/filesystem` |
| `@opencode-ai/core/session/compaction` | 0.12 | 176 | no db |
| `@opencode-ai/core/ripgrep` | 0.21 | 223 | lazy, only when grep/glob run |
| `opencode/agent/subagent-permissions`, `opencode/cli/cmd/debug/redact` | 0.03 | 1 / 1 | |
| `opencode/provider/transform` | 0.03 | 11 | type-imports `ai` |

Verified in the scratchpad: `LayerNode.compile(McpAuth.node)` builds and runs from `packages/oclite`.
`@/session/prompt/default.txt` resolves at runtime through oclite's tsconfig `paths` (8,528 chars).
`opencode/…/x.txt` does **not** resolve, because opencode's `exports` map appends `.ts`.

## 1. Package tree and ownership

Budget: ≤ 45 TS files in `src` (this plan has 42 including 4 forked and the existing ambient `.d.ts`), and
≤ 7,000 lines excluding `src/forked/`. The caps below add up to about 6,640 lines, leaving about 360 in
reserve. Forked files come to about 230 lines, reported separately. Non-TS assets (`.txt`, `.json`, `.md`)
don't count towards the budget.

```
packages/oclite/
  package.json  tsconfig.json  README.md (Phase 7)
  agents/                         build.md plan.md explore.md code.md audit.md      (runtime-engineer)
  scripts/size-budget.ts          counts src/**/*.ts; forked reported separately     (cli-engineer, Phase 2)
  src/
    index.ts              90  bin; parses argv, prints the first status line, lazy-imports the rest (cli)
    contract.ts          200  shared types + Context.Service tags; frozen after Phase 2 (cli writes it, lead owns changes)
    opencode-ambient.d.ts  3  existing
    util/paths.ts         50  XDG paths for oclite, ids, loopback test                   (cli)
    util/redact.ts        50  the ONE redaction helper                                   (cli)
    cli/args.ts          160  effect/unstable/cli command tree → CliArgs                 (cli)
    cli/run.ts           170  -p one-shot, output formats, exit codes                    (cli)
    cli/repl.ts          220  readline REPL, slash commands, @mentions, REPL Asker       (cli)
    cli/commands.ts      180  mcp add|list|remove|get|auth, agents, session              (cli)
    cli/debug.ts         140  debug prompt [--tokens], debug server [--reprobe]          (perf)
    config/config.ts     250  schema, layering, precedence, --mcp-config import          (cli)
    config/agents.ts     160  md agents (+ .claude compat, built-ins, extensions)        (cli)
    render/event.ts       60  RenderEvent helpers (tool summary, byte/duration format)   (cli)
    render/text.ts       200  text renderer: stdout text, dim stderr reasoning, status   (cli)
    render/json.ts        80  json + stream-json emitters                                (cli)
    runtime/runtime.ts   200  Runtime service + app layer composition                    (runtime)
    runtime/loop.ts      380  agent loop (one llm.stream per turn)                       (runtime)
    runtime/context.ts   190  system prompt layering, instructions, env, reminders       (runtime)
    runtime/compaction.ts160  threshold, stubbing, compaction, overflow retry            (runtime)
    session/records.ts   110  JSONL record Schemas                                       (runtime)
    session/store.ts     150  append/read/replay/list                                    (runtime)
    subagent/manager.ts  230  lifecycle state machine, limits, background queue          (runtime)
    subagent/task.ts     150  `task` tool                                                (runtime)
    tools/registry.ts    220  ToolSet build + wrapper (permission→hooks→exec→timeout→truncate) (tools)
    tools/fs.ts          220  read, write, edit                                          (tools)
    tools/search.ts      120  grep, glob (core Ripgrep, lazy)                            (tools)
    tools/bash.ts        150  bash (process group, timeout)                              (tools)
    tools/extra.ts       160  webfetch, todowrite, skill, question                       (tools)
    tools/text-protocol.ts130 text tool grammar + tolerant parser                        (tools)
    permission/permission.ts 220 rulesets, modes, check, ask routing, headless Asker     (tools)
    hooks/hooks.ts       100  PreToolUse/PostToolUse/Stop runner                         (tools)
    profile/profiles.ts  150  profile table (data) + selection + description tables      (perf)
    profile/local.txt  local-min.txt  tools.local.json  tools.local-min.json            (perf, not counted)
    llm/client.ts        290  model resolution, LlmGateway, fetch shim, shaping, queue   (perf)
    llm/probe.ts         230  capability probe + cache                                   (perf)
    llm/think.ts          70  <think> splitter (LLMEvent stream transform)               (perf)
    mcp/client.ts        300  thin MCP client manager on the SDK                         (mcp)
    mcp/tools.ts         170  MCP → OcliteTool, naming, tool_search, prompts/resources   (mcp)
    mcp/server.ts        380  `mcp serve`: 7 tools, prompts, resources, stdio + HTTP     (mcp)
    mcp/child.ts         150  transport:mcp child client                                 (mcp)
    forked/permission-rules.ts  ~45  evaluate/fromConfig/expand  ← opencode/src/permission/index.ts
    forked/variable.ts          ~90  substitute                  ← opencode/src/config/variable.ts
    forked/task-contract.ts     ~60  BACKGROUND_* texts, renderOutput, param descriptions ← opencode/src/tool/task.ts
    forked/system-prompt.ts     ~35  per-model prompt selection  ← opencode/src/session/system.ts
  test/  lib/ fixture/ <area>/     (see §14; not counted)
```

Ownership is disjoint. `forked/` belongs to whoever imports the file: permission-rules → tools,
variable → cli, task-contract → runtime, system-prompt → runtime. `contract.ts` is written in Phase 2 from
§2 and then frozen; changing it needs lead sign-off, because every dir codes against it. Every forked file
starts with `// forked-from: packages/opencode/src/<path>@ab6c8a6`.

Import rules (dependency direction inside the leaf):
`contract ← util ← {config, profile, session, permission, hooks} ← {llm, tools, mcp} ← {subagent, runtime} ← {render, cli}`.
Arrows point from the dependency to its consumer. `mcp/server.ts` and `mcp/child.ts` may import `runtime`
types only through `contract.ts`. Heavy modules (MCP SDK, ripgrep, compaction, oauth, ShellPrompt) load
through dynamic `import()` inside the branch that needs them (AGENTS.md rule).

## 2. Cross-dir interfaces (`src/contract.ts`)

These are exact signatures. Schemas that decode these shapes live in the owning file and must decode to
these types (`satisfies`).

```ts
import { Context, Effect, Schema, Scope, Stream } from "effect"
import type { AnyExecutableTool, ContentPart, LLMError, LLMEvent, Message, Model, ToolDefinition } from "@opencode-ai/llm"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"

export type ProfileName = "default" | "local" | "local-min"
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions"
export type Thinking = "auto" | "on" | "off"
export type OutputFormat = "text" | "json" | "stream-json"

// ---- config (config/) ----
export interface AgentDef {                     // structurally assignable to opencode Agent.Info
  name: string; description?: string; mode: "primary" | "subagent" | "all"; prompt?: string
  model?: string                                // "provider/model"; undefined = inherit
  temperature?: number; steps?: number
  permission: PermissionV1.Ruleset              // already fromConfig()'d
  options: Record<string, unknown>; source: string   // source = file path or "builtin"
  transport: "in-process" | "mcp"; mcp?: { command?: string[]; url?: string }
  max_depth: number; read_only: boolean; max_context_tokens?: number; thinking: Thinking   // defaults 2, false, -, "auto"
  tools?: string[]                              // optional tools enabled for local profiles
}
export interface HookEntry { matcher: string; command: string; timeout_ms: number }
export interface ServerPins { capabilities?: Partial<Capabilities>; context_window?: number; max_tokens?: number; concurrency?: number }
export interface ProviderEntry {
  npm?: string; options?: { baseURL?: string; apiKey?: string; headers?: Record<string, string> }
  models?: Record<string, { limit?: { context?: number; output?: number }; reasoning?: boolean }>
}
export interface ResolvedConfig {
  cwd: string; projectRoot: string
  model: string; small_model?: string            // default "anthropic/claude-sonnet-5"
  profile?: ProfileName; default_agent: string   // profile undefined = auto; agent default "build"
  provider: Record<string, ProviderEntry>; mcp: Record<string, ConfigMCPV1.Info>
  permission: PermissionV1.Ruleset               // config.permission via fromConfig
  cliRules: PermissionV1.Ruleset                 // --allowed-tools (allow) then --disallowed-tools (deny)
  permissionMode: PermissionMode
  instructions: string[]                         // extra instruction files (concatenated across layers)
  hooks: { PreToolUse: HookEntry[]; PostToolUse: HookEntry[]; Stop: HookEntry[] }
  servers: Record<string, ServerPins>            // key = base URL without trailing slash
  agents: Record<string, AgentDef>
  permission_timeout_ms: number                  // 300000 [R]
  subagent: { max_depth: number; max_concurrent: number }   // 2, 4
  thinking?: Thinking; showThinking: boolean     // --thinking; --no-thinking → showThinking=false
  appendSystemPrompt?: string; maxTurns?: number
}
export class AppConfig extends Context.Service<AppConfig, ResolvedConfig>()("oclite/AppConfig") {}

// ---- capabilities (llm/probe.ts) ----
export type CapSource = "probe" | "config" | "default" | "static" | "error-400"
export interface Capabilities {
  context_window: number; usage_in_stream: boolean
  reasoning_field: "reasoning_content" | "reasoning" | "none"; think_tags: boolean; tools_native: boolean
  accepts: { chat_template_kwargs: boolean; prompt_cache_key: boolean; reasoning_effort: boolean; parallel_tool_calls: boolean }
  prefix_cache: boolean; concurrency: number
  tokenize: boolean                              // llama.cpp /tokenize available
  no_think_suffix: boolean                       // config pin only; default false (§10)
}

// ---- profiles (profile/) ----
export interface Profile {
  name: ProfileName
  promptMaxChars: number | undefined             // undefined = opencode's per-model prompt
  tools: readonly string[]; optionalTools: readonly string[]   // optional = enabled via AgentDef.tools
  descriptionMaxChars: number | undefined; mcp: "all" | "deferred"; instructionCapChars: number | undefined
  title: boolean; stubAfterTurns: number; compactAt: number; budgetTokens: number
}

// ---- render (render/) ----
export type RenderEvent = { session_id: string; agent_path: string[] } & (
  | { type: "system"; agent: string; model: string; profile: ProfileName; tools: string[]; mcp: Array<{ name: string; status: string }> }
  | { type: "status"; phase: StatusPhase; message: string; attempt?: number; wait_ms?: number }
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_start"; call_id: string; name: string; summary: string }
  | { type: "tool_end"; call_id: string; name: string; status: ToolStatus; summary: string; duration_ms: number; bytes: number }
  | { type: "step_finish"; step: number; usage: TokenUsage }
  | { type: "result"; state: RunState; text: string; turns: number; usage: TokenUsage; exit_code: number }
  | { type: "error"; message: string; retryable: boolean })
export type StatusPhase = "config" | "mcp" | "tools" | "instructions" | "git" | "probe" | "queued"
  | "retry" | "compact" | "permission" | "notice" | "subagent"
export type ToolStatus = "ok" | "error" | "denied" | "timeout" | "blocked"
export interface TokenUsage { input: number; output: number; reasoning?: number; cache_read?: number; estimated: boolean }
export type EventSink = (event: RenderEvent) => Effect.Effect<void>

// ---- permission (permission/) ----
export interface AskRequest {
  request_id: string; session_id: string; agent: string; tool: string
  patterns: string[]; always: string[]; summary: string; metadata: Record<string, unknown>
}
export type AskReply = "once" | "always" | "reject"
export interface AskerShape { readonly ask: (req: AskRequest) => Effect.Effect<AskReply> }
export class Asker extends Context.Service<Asker, AskerShape>()("oclite/Asker") {}
export interface PermissionShape {
  readonly ruleset: (input: { agent: AgentDef; mode: PermissionMode; parent?: PermissionV1.Ruleset; mcpReadOnly: readonly string[] }) => PermissionV1.Ruleset
  readonly check: (input: { session_id: string; agent: string; ruleset: PermissionV1.Ruleset; tool: string; patterns: string[]; always?: string[]; summary: string; metadata?: Record<string, unknown> })
    => Effect.Effect<void, PermissionV1.DeniedError | PermissionV1.RejectedError>
  readonly denials: (session_id: string) => Effect.Effect<number>
}
export class Permission extends Context.Service<Permission, PermissionShape>()("oclite/Permission") {}

// ---- hooks (hooks/) ----
export interface HookInput { session_id: string; tool_name?: string; tool_input?: unknown; tool_output?: string; cwd: string }
export type HookOutcome = { kind: "continue" } | { kind: "block"; message: string } | { kind: "warn"; message: string }
export interface HooksShape { readonly run: (hook: "PreToolUse" | "PostToolUse" | "Stop", input: HookInput) => Effect.Effect<HookOutcome> }
export class Hooks extends Context.Service<Hooks, HooksShape>()("oclite/Hooks") {}

// ---- tools (tools/, mcp/tools.ts, subagent/task.ts all produce OcliteTool) ----
export interface ToolAccess { permission: string; patterns: string[]; always?: string[] }
export interface OcliteTool {
  name: string; tool: AnyExecutableTool          // @opencode-ai/llm Tool.make(...)
  access: (input: unknown) => ToolAccess         // pure; called after decode
  readOnly: boolean                              // parallel-safe + allowed for read_only agents
  timeoutMs: number                              // bash 120000, others 30000, mcp per server
  summarize: (input: unknown) => string          // "read src/x.ts"
}
export interface RunToolContext { session_id: string; cwd: string; agent: AgentDef; depth: number; ruleset: PermissionV1.Ruleset; sink: EventSink; profile: Profile }
export interface ToolSet {
  tools: Record<string, AnyExecutableTool>       // wrapped, keyed by wire name
  definitions: ToolDefinition[]                  // sorted by name, byte-stable
  readOnly: ReadonlySet<string>
  textProtocolPrompt?: string                    // set when tools_native=false (≤ 400 chars + tool list)
  activate: (names: string[]) => Effect.Effect<void>   // tool_search → next request
}
export interface ToolRegistryShape { readonly build: (ctx: RunToolContext, extra: readonly OcliteTool[], caps: Capabilities) => Effect.Effect<ToolSet> }
export class ToolRegistry extends Context.Service<ToolRegistry, ToolRegistryShape>()("oclite/ToolRegistry") {}

// ---- llm (llm/) ----
export interface ModelHandle {
  ref: string; model: Model; local: boolean; baseURL: string
  capabilities: Capabilities; contextWindow: number; maxTokens: number; reasoning: boolean
}
export interface TurnRequest {
  session_id: string; label: string                        // label shown in "queued behind <label>"
  system: string; messages: readonly Message[]; tools: readonly ToolDefinition[]
  thinking: boolean | undefined; maxTokens?: number
  onQueued: (behind: string) => Effect.Effect<void>
}
export interface LlmGatewayShape {
  readonly resolve: (ref: string, opts?: { reprobe?: boolean }) => Effect.Effect<ModelHandle, ConfigError>
  readonly stream: (handle: ModelHandle, req: TurnRequest) => Stream.Stream<LLMEvent, LLMError>   // queued, shaped, think-split
  readonly notice: (key: string, message: string) => Effect.Effect<boolean>                         // true the first time per process
}
export class LlmGateway extends Context.Service<LlmGateway, LlmGatewayShape>()("oclite/LlmGateway") {}
export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()("oclite/ConfigError", { message: Schema.String }) {}  // exit 2

// ---- session (session/) ---- SessionHeader, SessionRecord, RecordInput (= SessionRecord minus seq/t) are the §7
// types, declared here; session/records.ts owns the matching Schemas.
export interface SessionStoreShape {
  readonly create: (header: Omit<SessionHeader, "type" | "v" | "seq" | "t">) => Effect.Effect<string>
  readonly append: (session_id: string, record: RecordInput) => Effect.Effect<void>   // redacts, assigns seq/t
  readonly read: (session_id: string) => Effect.Effect<readonly SessionRecord[]>
  readonly list: (filter?: { cwd?: string; limit?: number }) => Effect.Effect<readonly SessionHeader[]>
  readonly latest: (cwd: string) => Effect.Effect<string | undefined>
}
export class SessionStore extends Context.Service<SessionStore, SessionStoreShape>()("oclite/SessionStore") {}

// ---- mcp client (mcp/) ----
export interface McpStatus { name: string; status: "connected" | "failed" | "disabled" | "needs_auth" | "connecting"; error?: string; tools: number }
export interface McpShape {
  readonly connectAll: (onStatus: (s: McpStatus) => Effect.Effect<void>) => Effect.Effect<void>
  readonly status: () => Effect.Effect<McpStatus[]>
  readonly tools: () => Effect.Effect<OcliteTool[]>                          // all, named mcp__server__tool
  readonly search: (query: string, limit: number) => Effect.Effect<Array<{ name: string; description: string }>>
  readonly instructions: (toolNames: readonly string[]) => Effect.Effect<string[]>   // once per server with tools in request
  readonly prompts: () => Effect.Effect<Array<{ server: string; name: string; description?: string; arguments: string[] }>>
  readonly getPrompt: (server: string, name: string, args: Record<string, string>) => Effect.Effect<ContentPart[], McpError>
  readonly resources: () => Effect.Effect<Array<{ server: string; uri: string; name: string; mimeType?: string }>>
  readonly readResource: (server: string, uri: string) => Effect.Effect<{ text: string; path?: string }, McpError>
  readonly reconnect: (name?: string) => Effect.Effect<void>
  readonly authenticate: (name: string) => Effect.Effect<McpStatus, McpError>
}
export class Mcp extends Context.Service<Mcp, McpShape>()("oclite/Mcp") {}

// ---- runtime + subagents (runtime/, subagent/) ----
export type RunState = "pending" | "running" | "completed" | "failed" | "cancelled"
export interface RunInput {
  session_id?: string                           // resume; undefined = new
  agent: string; prompt: string | readonly ContentPart[]
  model?: string; profile?: ProfileName; permissionMode?: PermissionMode
  maxTurns?: number; thinking?: Thinking; cwd?: string
  parent?: { session_id: string; depth: number; ruleset: PermissionV1.Ruleset; call_id: string }
}
export interface RunResult { session_id: string; state: RunState; text: string; turns: number; usage: TokenUsage;
  reason: "stop" | "max_turns" | "cancelled" | "error"; denied: number; error?: string }
export interface RunHandle {
  session_id: string
  send: (message: string) => Effect.Effect<void>             // steer at next turn boundary
  cancel: Effect.Effect<void>
  status: Effect.Effect<{ state: RunState; step: number; started_at: number; tokens: TokenUsage; pending_permission?: AskRequest }>
  await: Effect.Effect<RunResult>
}
export interface SpawnInput {
  parent: { session_id: string; depth: number; ruleset: PermissionV1.Ruleset; call_id: string; cwd: string }
  agent: string; prompt: string; description: string; background: boolean
  task_id?: string; model?: string; permissionMode?: PermissionMode; sink: EventSink
}
export interface SubagentInfo { id: string; parent_session_id: string; agent: string; description: string; transport: "in-process" | "mcp";
  state: RunState; step: number; started_at: number; tokens: TokenUsage; result?: string; error?: string; pending_permission?: AskRequest }
export interface SubagentsShape {
  readonly spawn: (input: SpawnInput) => Effect.Effect<SubagentInfo, SpawnError>   // returns after admission (pending|running)
  readonly wait: (id: string, timeout_ms?: number) => Effect.Effect<SubagentInfo>
  readonly get: (id: string) => Effect.Effect<SubagentInfo | undefined>
  readonly send: (id: string, message: string) => Effect.Effect<boolean>
  readonly cancel: (id: string) => Effect.Effect<RunState | undefined>
  readonly takeFinished: (parent_session_id: string) => Effect.Effect<SubagentInfo[]>  // background completions not yet injected
  readonly running: (parent_session_id: string) => Effect.Effect<number>
  readonly envelope: (info: SubagentInfo) => string
}
export interface RuntimeShape {
  readonly start: (input: RunInput, sink: EventSink) => Effect.Effect<RunHandle, ConfigError>
  readonly subagents: SubagentsShape
}
export class Runtime extends Context.Service<Runtime, RuntimeShape>()("oclite/Runtime") {}
export class SpawnError extends Schema.TaggedErrorClass<SpawnError>()("oclite/SpawnError", { message: Schema.String }) {}
export class McpError extends Schema.TaggedErrorClass<McpError>()("oclite/McpError", { server: Schema.String, message: Schema.String }) {}

// ---- mcp child (mcp/child.ts) — used by subagent/manager.ts via dynamic import ----
export interface ChildSpec { command?: string[]; url?: string; token?: string; cwd: string; env: Record<string, string>
  onEvent: EventSink; onAsk: (req: AskRequest) => Effect.Effect<AskReply> }
export interface ChildClient {
  spawn: (input: { agent: string; prompt: string; background: true; permission_mode?: PermissionMode; model?: string }) => Effect.Effect<string, McpError>
  result: (id: string, timeout_ms: number) => Effect.Effect<{ state: RunState; text: string }, McpError>
  send: (id: string, message: string) => Effect.Effect<void, McpError>
  cancel: (id: string) => Effect.Effect<void>
}
// export const connectChild: (spec: ChildSpec) => Effect.Effect<ChildClient, McpError, Scope.Scope>
```

Other exported functions that implementers can code against:

| file | export |
|---|---|
| `config/config.ts` | `load(args: CliArgs): Effect<ResolvedConfig, ConfigError>`, `layer(cfg): Layer<AppConfig>` |
| `config/agents.ts` | `loadAgents(input: { projectRoot; cwd; home; overrides: Record<string, ConfigAgentV1.Info> }): Promise<Record<string, AgentDef>>` |
| `cli/args.ts` | `type CliArgs` (every flag in SPEC §1, camelCased), `command: Command` |
| `profile/profiles.ts` | `PROFILES: Record<ProfileName, Profile>`, `select(input: { explicit?; handle: ModelHandle }): Profile`, `descriptions(profile, tool): string \| undefined`, `harnessPrompt(profile, handle): string` |
| `llm/probe.ts` | `probe(input: { baseURL; model; apiKey?; pins?: ServerPins; reprobe: boolean }): Effect<Capabilities & { sources: Record<keyof Capabilities, CapSource> }, ConfigError>`, `STATIC: Capabilities` |
| `llm/think.ts` | `splitThink: <E>(s: Stream<LLMEvent, E>) => Stream<LLMEvent, E>` |
| `llm/client.ts` | `layer: Layer<LlmGateway, never, AppConfig>`, `layerWith(http: Layer<HttpClient>)` for tests |
| `tools/registry.ts` | `layer: Layer<ToolRegistry, never, Permission \| Hooks \| AppConfig>` |
| `tools/text-protocol.ts` | `grammar(tools: ToolDefinition[]): string`, `parse(text: string): { call?: { name: string; input: unknown }; error?: string }` |
| `permission/permission.ts` | `layer: Layer<Permission, never, Asker \| SessionStore \| AppConfig>`, `headlessAsker: Layer<Asker>` |
| `hooks/hooks.ts` | `layer: Layer<Hooks, never, AppConfig>` |
| `session/store.ts` | `layer: Layer<SessionStore, never, AppConfig>`, `replay(records): { messages: Message[]; todos; activated: string[]; summary?: string; turn: number }` |
| `mcp/client.ts` | `layer: Layer<Mcp, never, AppConfig>` (scoped; closes clients on exit) |
| `mcp/server.ts` | `serve(cfg: ResolvedConfig, input: { transport: "stdio" \| "http"; host: string; port: number; allowRemoteBypass: boolean }): Effect<void, ConfigError>`. It builds its own Asker (bound to its connection registry) and calls `appLayer(cfg, asker)` itself, which avoids a Runtime↔Asker cycle. |
| `runtime/runtime.ts` | `appLayer(cfg: ResolvedConfig, asker: Layer<Asker>, http?: Layer<HttpClient>): Layer<Runtime \| Mcp \| SessionStore \| LlmGateway \| AppConfig>` |
| `util/redact.ts` | `redact(value: unknown): unknown`, `redactText(text: string, secrets: readonly string[]): string`, `registerSecret(s: string): void` |
| `render/text.ts` / `render/json.ts` | `textSink(opts: { showThinking; tty }): EventSink`, `streamJsonSink(): EventSink`, `jsonCollector(): { sink; result(): RenderEvent }` |

## 3. Effect layer graph

```
AppConfig ─────────────── Layer.succeed(cfg)  (cli builds cfg; nothing reads files later)
Asker ─────────────────── one of: permission.headlessAsker | cli/repl.replAsker | mcp/server.askerLayer
SessionStore.layer ◄──── AppConfig
Hooks.layer ◄─────────── AppConfig
Permission.layer ◄────── Asker, SessionStore, AppConfig
Mcp.layer (scoped) ◄──── AppConfig                       (SDK imported on first connectAll)
ToolRegistry.layer ◄──── Permission, Hooks, AppConfig
LlmGateway.layer ◄────── AppConfig, LLMClient.layer ◄ RequestExecutor.layer ◄ FetchHttpClient.layer + Fetch(shim)
Runtime.layer ◄───────── LlmGateway, ToolRegistry, SessionStore, Mcp, Permission, Hooks, AppConfig
                         (builds Subagents via subagent/manager.make({ start }) internally; no cycle)
```

The CLI entry does `Effect.provide(Runtime.appLayer(cfg, asker))` and then runs `run`, `repl` or `serve`. It
uses `NodeServices.layer` + `NodeRuntime.runMain` for `effect/unstable/cli`. In tests, `appLayer` takes an
`http` layer (the http-recorder `HttpRecorder.http(...)`) instead of Fetch.

## 4. Startup and status line (constraint 2)

`index.ts` imports only `effect`, `effect/unstable/cli`, platform-node and `render/text.ts` (~0.11 s). In the
default command it prints `status config` straight to stderr, then does `await import("./runtime/runtime")`
etc. The phase order and statuses are `config → probe (first use only) → mcp (only if servers) → tools →
instructions → git → queued (if waiting)`. Target: first status at ≤ 150 ms and the model request sent at
≤ 300 ms after process start, excluding MCP and probe network time, which have their own statuses.
`git` reads `.git/HEAD` directly, with no `git` spawn. The title call is started only in `default` with a
`small_model`, never blocks the main turn, and goes through the queue.

## 5. Agent loop (runtime/loop.ts)

One `LlmGateway.stream` per provider turn. Pseudocode (the loop is Effect-based; state is in-memory and
mirrored in JSONL):

```
run(input):
  handle   = gateway.resolve(agent.model ?? input.model ?? cfg.model)
  profile  = profiles.select({explicit, handle})
  ruleset  = permission.ruleset({agent, mode, parent: input.parent?.ruleset, mcpReadOnly})
  tools    = registry.build(ctx, [...mcpTools|toolSearch, taskTool?], handle.capabilities)
  system   = context.system(profile, agent, handle, tools)        // computed ONCE per run, byte-stable
  history  = store.replay(records)                                 // resume: drops trailing parts after last complete tool_result
  append user record; turn = 0
  loop:
    if turn >= min(agent.steps, maxTurns): end("max_turns")
    reminders = [steers, takeFinished() envelopes, todo state, hook Stop messages]   // volatile, last user msg only
    compaction.maybe(history, handle, profile, agent)             // §6; may emit status compact
    thinking = agent.thinking=="auto" ? (lastUserIsFresh ? true : false) : agent.thinking=="on"
    events = gateway.stream(handle, {system, messages: toMessages(history, reminders), tools: tools.definitions, thinking, onQueued})
             |> retry(2s,4s,8s ×3 on transport/5xx; status retry {attempt, wait_ms})
    fold events:
      text-delta → sink text_delta          reasoning-delta → sink reasoning_delta
      tool-call  → sink tool_start; store tool_call; collect
      text-end / reasoning-end → store text|reasoning (one line per completed part)
      step-finish/finish → sink step_finish; store step
    on LLMError isContextOverflow → compaction.force(); retry turn once
    on 400 "maximum context length is N" → persist N (source error-400), compaction to 75%, retry once
    if tools.textProtocolPrompt: parse text → ≤1 call; malformed → feed error once, then end (exit 3 headless)
    if turn ended inside <think> (think splitter state) and thinking was on → retry once with thinking=false
    if no calls:
      if subagents.running(session) > 0: wait for next finish, inject, continue
      outcome = hooks.run("Stop"); block → add reminder, continue ; else end("stop")
    dispatch: readOnly calls concurrently (Effect.all concurrency "unbounded"), others sequential in order,
              each via ToolRuntime.dispatch(tools.tools, call) (wrapper does permission/hooks/timeout/truncate)
              sink tool_end; store tool_result
    turn++
```

Tool wrapper order (`tools/registry.ts`, used by native and text-protocol calls alike):
`decode (llm) → access(input) → external_directory check → Permission.check → Hooks PreToolUse (exit 2 →
result "blocked: <stderr>") → execute under Effect.timeout(timeoutMs) (timeout → "timed out after N s", process
group SIGKILL) → truncate (2000 lines / 50 KB; full output to
~/.local/share/oclite/tool-output/<session>/<call>.txt, path in the hint) → Hooks PostToolUse`. A denial
becomes a tool error result `permission denied: <tool> <pattern>` and the model continues. In headless mode
the run's `denied` count makes the exit code 3.

Ask routing: `Permission.check` evaluates `findLast` over `[...defaults, ...cfg.permission, ...agent.permission,
...modeRules, ...derivedParent, ...cfg.cliRules, ...sessionAlways]`.
`allow` → go; `deny` → DeniedError; `ask` → `Asker.ask` (serialized per process with a Semaphore(1)):
REPL → readline prompt `[y]es / [a]lways / [n]o`; `-p` → reject and count it; `mcp serve` → elicitation, else
notification + `agent_permission_reply`, else deny at `permission_timeout_ms`; in-process sub-agent → the
parent's Asker, with `agent_path` in the summary; transport:mcp child → the child elicits, and the parent's
`onAsk` routes it to the parent's Asker.

`once` → go; `always` → push `{permission, pattern: always[i], action: allow}` into sessionAlways and persist a
permission record; `reject` → RejectedError. Every decision is written as a permission record.

Default rules: `* ask`; `read glob grep todowrite skill tool_search question: allow`; `external_directory: ask`.
Mode rules: acceptEdits → `edit write: allow`; plan → same as read_only; bypassPermissions → `* allow` (cliRules
and parent denies still apply after it; refused over remote MCP transport unless the flag is set).

read_only rules: deny `edit write apply_patch mcp__*` and `bash *`; allow bash `git status*`, `git diff*`,
`git log*`, `ls*`, `pwd`; then allow each name in `mcpReadOnly` (MCP tools whose `annotations.readOnlyHint ===
true`). Bash access patterns: the command string. A command containing any of `; & | > < $( \` newline` gets
pattern `<complex>` so `git status*` can't match `git status; rm -rf`.

Queue: `llm/client.ts` keeps `Map<baseURL, Semaphore>` sized by `servers[url].concurrency ?? caps.concurrency`
(1 for loopback, 8 for hosted). Every call goes through it: main, sub-agent, background, compaction, title
and probe. If a permit isn't free right away, `onQueued(holderLabel)` fires, and the renderer shows
`queued behind main agent`.

## 6. Overflow, stubbing, compaction (runtime/compaction.ts)

- Limit: `L = agent.max_context_tokens ?? handle.contextWindow`. `contextWindow` is never 0: pin → probe →
  32768 with a notice. This fixes opencode's context-0 skip.
- Estimate: `E = lastStep.usage.input (server) + chars/4 of messages appended since`, plus a 25% safety
  margin when `usage.estimated`.
- Trigger: `E ≥ profile.compactAt × L` (0.75 or 0.60), checked before every turn.
- Step 1, stub: replace the output of every tool_result older than `profile.stubAfterTurns` turns with
  `[output elided: <summary>, <bytes> B — re-run the tool if needed]`. Persist `{type:"prune", before_turn}`
  so later requests stay byte-identical. If `E` is under the trigger afterwards, stop.
- Step 2, compact: a side LLM call through the queue with system `@/agent/prompt/compaction.txt` and user
  `SessionCompaction.buildPrompt({ previousSummary, context })`. The core V2 import is lazy. `context` is the
  serialized history with tool outputs capped at 2000 chars. `maxTokens` is 4096. Persist `{type:"compaction",
  summary, through_seq}`.
- History after compaction: `[user: <compaction-summary> + original first user message (≤ 2000 chars) + open
  todos + live sub-agent ids]` followed by the latest user turn.
- Forced paths (`isContextOverflow`, parsed 400) run step 1 and step 2 unconditionally, and retry once.

## 7. JSONL session records (session/records.ts)

Path: `~/.local/share/oclite/sessions/<id>.jsonl`, append-only, one record per line, written with
`Bun.file().writer()` + `flush()` after every line. Ids are `ses_<ulid>`. `util/redact` runs on every
record before write. Common fields on every record: `seq: number` (monotonic from 0), `t: number` (epoch ms).

```ts
type SessionHeader = { type: "session"; v: 1; id: string; cwd: string; agent: string; model: string; profile: ProfileName;
  parent_id?: string; parent_call_id?: string; depth: number; created_at: number; title?: string }
type SessionRecord = { seq: number; t: number } & (
  | SessionHeader
  | { type: "user"; turn: number; text: string; synthetic: boolean;
      attachments?: Array<{ kind: "file" | "resource"; ref: string; bytes: number }> }
  | { type: "reminder"; turn: number; text: string }                      // volatile block that was sent
  | { type: "text"; turn: number; text: string }
  | { type: "reasoning"; turn: number; text: string }
  | { type: "tool_call"; turn: number; call_id: string; name: string; input: unknown }
  | { type: "tool_result"; turn: number; call_id: string; name: string; status: ToolStatus; output: string;
      overflow_path?: string; duration_ms: number; bytes: number }
  | { type: "step"; turn: number; reason: string; usage: TokenUsage }
  | { type: "subagent"; call_id: string; child_id: string; agent: string; state: RunState; transport: "in-process" | "mcp"; background: boolean }
  | { type: "permission"; request_id: string; tool: string; patterns: string[]; decision: "allow" | "deny" | "ask";
      reply?: AskReply; via: "rule" | "repl" | "elicitation" | "reply_tool" | "timeout" | "headless"; always?: string[] }
  | { type: "tools_activated"; names: string[] }
  | { type: "prune"; before_turn: number }
  | { type: "compaction"; summary: string; through_seq: number }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "end"; reason: RunResult["reason"]; turns: number; usage: TokenUsage })
```

`replay`:
1. Fold the records in order. Apply the last `compaction` (drop records at or before `through_seq`) and every
   `prune`.
2. Drop a trailing incomplete step: parts after the last `tool_result` that belong to a step with no
   `step`/`end` record, and tool_calls without results.
3. The run then continues from the last complete tool result.

`sessionAlways` is rebuilt from permission records with `reply: "always"`.

## 8. Config schema and precedence (config/config.ts)

Precedence, low → high: built-in defaults → `~/.config/oclite/config.json` → `<projectRoot>/.oclite/config.json`
(`projectRoot` = nearest ancestor of cwd with `.oclite/` or `.git`, else cwd) → `--mcp-config <file>` (repeatable) → CLI flags.

Objects deep-merge, `instructions` arrays concatenate, and other arrays replace. `{env:NAME}` and
`{file:path}` are substituted on the raw text before JSON parse (forked/variable.ts). `--strict-mcp-config`
drops `mcp` from layers 2–3.

```jsonc
{
  "$schema": "…",
  "model": "anthropic/claude-sonnet-5", "small_model": "…", "profile": "local",
  "default_agent": "build",
  "provider": { "<id>": { "npm": "@ai-sdk/openai-compatible", "options": { "baseURL": "http://127.0.0.1:8000/v1", "apiKey": "{env:KEY}", "headers": {} },
                          "models": { "local-qwen": { "limit": { "context": 32768, "output": 4096 }, "reasoning": true } } } },
  "mcp": { "<name>": ConfigMCPV1.Info },          // opencode shape, unchanged
  "permission": ConfigPermissionV1.Info,           // opencode shape, e.g. { "bash": { "git *": "allow" }, "edit": "ask" }
  "agent": { "<name>": ConfigAgentV1.Info },       // field overrides on loaded agents
  "instructions": ["docs/STYLE.md"],
  "hooks": { "PreToolUse": [ { "matcher": "bash", "command": "./check.sh", "timeout": 10000 } ],
             "PostToolUse": [], "Stop": [] },
  "servers": { "http://127.0.0.1:8000/v1": { "capabilities": { "tools_native": false }, "context_window": 32768, "max_tokens": 4096, "concurrency": 1 } },
  "permission_timeout_ms": 300000,
  "subagent": { "max_depth": 2, "max_concurrent": 4 }
}
```

- Provider resolution for `provider/model`: id `anthropic` or `npm` `@ai-sdk/anthropic` → llm `providers/anthropic`;
  `openai` → `providers/openai`; anything with `options.baseURL` → `providers/openai-compatible`; otherwise ConfigError (exit 2).
- `apiKey`: config, then the provider's usual env var. It's registered with `redact.registerSecret`.
- `--mcp-config` accepts `{ "mcp": {…} }` (oclite/opencode) or Claude's `{ "mcpServers": { name: { command, args, env } |
  { type: "http"|"sse", url, headers } } }`, converted to `ConfigMCPV1.Local`/`Remote`.
- Hooks accept both oclite's `{matcher, command, timeout?}` and Claude's
  `{matcher, hooks: [{type: "command", command, timeout?}]}`. Claude's timeout is in seconds, so it's
  multiplied by 1000. `matcher` is case-insensitive, `|`-alternated glob matched against the oclite tool
  name. Claude names (`Bash`, `Edit|Write`, `Read`) match because comparison is lowercase.
- Agents, low → high: `packages/oclite/agents/*.md` (built-in) → `~/.config/oclite/agents/**/*.md` →
  `<root>/.claude/agents/*.md` (compat, read-only) → `<root>/.opencode/{agent,agents}/**/*.md` →
  `<root>/.oclite/agents/**/*.md` → config `agent` overrides. Each file goes through `ConfigMarkdown.parse` then `ConfigAgentV1.Info` decode. Unknown keys land in
  `options`; oclite extensions (`transport, mcp, max_depth, read_only, max_context_tokens, thinking, tools`)
  are read from `options` with an oclite Schema.
- Claude compat, before decode: `tools: "Read, Grep"` (string or array) maps Read→read, Write→write,
  Edit/MultiEdit→edit, Bash→bash, Grep→grep, Glob/LS→glob, WebFetch→webfetch, Task→task, TodoWrite→todowrite,
  `mcp__*` unchanged. The result is allow rules for the listed tools and deny rules for every other built-in and
  unlisted `mcp__*`. `model: sonnet|opus|haiku|inherit` → inherit.
- Instructions: `AGENTS.md`, then `CLAUDE.md` if there is no AGENTS.md, walking up from cwd to projectRoot.
  Then `~/.config/oclite/AGENTS.md` and `~/.claude/CLAUDE.md`, then `instructions[]`. Each file is capped
  at `profile.instructionCapChars` with the cut reported once as a notice.

## 9. Profiles (profile/profiles.ts): data

| field | default | local | local-min |
|---|---|---|---|
| promptMaxChars | undefined (opencode per-model txt via forked/system-prompt.ts) | 600 (`local.txt`) | 300 (`local-min.txt`) |
| tools | bash edit glob grep question read skill task todowrite webfetch write | bash edit glob grep read write | bash edit grep read |
| optionalTools | – | task todowrite question skill webfetch | – |
| descriptionMaxChars | undefined (`@/tool/*.txt`, bash via ShellPrompt.render) | 300 (`tools.local.json`) | 150 (`tools.local-min.json`) |
| mcp | all | deferred (`tool_search`) | deferred |
| instructionCapChars | undefined | 2000 | 1000 |
| title | true (only with small_model) | false | false |
| stubAfterTurns | 6 [R] | 6 [R] | 3 |
| compactAt | 0.75 | 0.75 | 0.60 |
| budgetTokens | 2500 **[LEAD]** see §15 | 1200 | 600 |

All profiles: `maxTokens = pin ?? model limit.output ?? 4096`, at least 8192 when `handle.reasoning` [R]. Tools
are sorted by name. The env block is `cwd, platform, date (YYYY-MM-DD), git branch`, with no time.
`prompt_cache_key = session_id` when accepted. `parallel_tool_calls` is sent only when accepted, as `false`
unless the model pin says true.

Selection: `--profile` or config `profile`; otherwise `local` when the provider is openai-compatible and the
baseURL host is loopback; `local` becomes `local-min` when `caps.prefix_cache === false` (notice). `local-min`
is never chosen automatically on a hosted provider.

Estimated default-profile overhead with `anthropic.txt`: 8,212 chars. Tool descriptions: bash 4,672 + read
1,158 + glob 517 + grep 657 + edit 1,369 + write 623 + task 2,305 + webfetch 750 + todowrite 2,012 + skill 399
+ question 657, about 15,100 chars. Schemas are about 1,000 tokens. The total is about 6,900 tokens, so 2,500
is not reachable with opencode's texts (see §15).

`oclite debug prompt --tokens` (cli/debug.ts):
1. Build the exact first-turn request (system, tool definitions, reminders) for the chosen agent/profile with
   user message `"."`, and print the system prompt, per-tool description chars and schema chars.
2. With `--tokens`, send A = that request with `maxTokens: 1`, and B = the same request with no system and no
   tools. Report `fixed = A.usage.inputTokens − B.usage.inputTokens` (server-reported).
3. If `usage_in_stream` is false: use llama.cpp `/tokenize` when `caps.tokenize`, else chars/4 labelled `est.`.
4. Exit 1 if `fixed > budgetTokens` when `--check` is given. The tests use this.

## 10. Capability record and probe (llm/probe.ts)

Cache: `~/.local/share/oclite/servers/<host>_<port>-<sanitized model>.json`, TTL 7 days, `--reprobe`
forces. Hosted anthropic/openai get the `STATIC` record (all true, concurrency 8, context from models config)
and are never probed.

```ts
type CapabilityRecord = Capabilities & { v: 1; base_url: string; model: string; probed_at: number; ttl_ms: 604800000;
  sources: Record<keyof Capabilities, CapSource>; ttft_ms?: [number, number]; notes: string[] }
```

Probe, at most 3 requests, with config pins applied first so pinned fields are never probed:
1. **R1 `GET {base}/models`.** Context comes from `max_model_len` (vLLM), `context_length` (LM Studio,
   OpenRouter), or `meta.n_ctx_train`/`n_ctx` (llama.cpp), else pin, else 32768 (source `default`, notice).
   `owned_by: "llamacpp"` → `tokenize: true`. A connection failure → ConfigError → exit 2 with the base URL
   and the error.
2. **R2 stream chat.** Request: system = deterministic ~2k-token pad + "Use tools when asked"; user "Call the
   probe tool with x=1"; `tools: [probe{x:int}]`, `max_tokens: 256`, `stream_options.include_usage`, and every
   optional param (`chat_template_kwargs:{enable_thinking:true}`, `prompt_cache_key`, `reasoning_effort:"low"`,
   `parallel_tool_calls:false`). Observed: `delta.tool_calls` → `tools_native`; `delta.reasoning_content` or
   `delta.reasoning` → `reasoning_field`; `<think>` in content → `think_tags`; a usage chunk → `usage_in_stream`;
   TTFT₁ = time to the first delta. On 400: every optional param named in the body → `accepts[p]=false`. If none is named, all four are
     false. If the body names `tool`, `tools_native=false`.
3. **R3.** The same messages without rejected params and with `enable_thinking:false` if accepted. TTFT₂ gives
   `prefix_cache = TTFT₂ ≤ 0.7·TTFT₁`. R3 also re-checks `tools_native` if R2 ended by `length` inside
   reasoning. If R2 was a 400, R3 is the canary and `prefix_cache=false` (source `default`, notice "pin
   servers.<url>.capabilities.prefix_cache").

`concurrency` = pin ?? 1, never probed. `no_think_suffix` = pin ?? false. `debug server` prints every field
with its source, so there are no `unknown` values.

Fallback ladder, mapped to code sites:

| missing | site | behaviour |
|---|---|---|
| tools_native=false | `tools/registry.ts` (sends `tools: []`, sets textProtocolPrompt) + `tools/text-protocol.ts` + `runtime/loop.ts` (parse, ≤1 call, one malformed retry) | notice `tool calls: text protocol (server has no tool-call parser)` |
| reasoning_field=reasoning | `llm/client.ts` Fetch shim renames `delta.reasoning`→`reasoning_content` in SSE lines | notice once |
| reasoning none + think_tags | `llm/think.ts` via `gateway.stream` | notice |
| both none | nothing | – |
| context_window unknown | `llm/probe.ts` default, `runtime/loop.ts` 400 parse → `probe.persist({context_window,source:"error-400"})` | notice |
| usage_in_stream=false | `llm/client.ts` (estimate chars/4 or /tokenize), `TokenUsage.estimated=true` → renderer adds "est." | notice |
| prefix_cache=false | `profile/profiles.ts` select → local-min | notice |
| accepts.p=false | `llm/client.ts` builds `http.body` from caps only; a runtime 400 naming p → set false, persist, retry once | notice |
| concurrency=1 | `llm/client.ts` semaphore; title off | status queued |
| slow prefill | `runtime/loop.ts` thinking resolution → `chat_template_kwargs.enable_thinking` or `/no_think` (only if `no_think_suffix` pinned) | – |
| 5xx / drop mid-stream | `runtime/loop.ts` retry 2/4/8 s ×3 | status retry |
| tool hang | `tools/registry.ts` timeout + `tools/bash.ts` kill(-pgid) | tool_end timeout |
| unreachable at start | `llm/probe.ts` R1 / first stream → ConfigError exit 2; REPL `/reconnect` → `gateway.resolve(ref,{reprobe:true})` | error |

About executor retries: `RequestExecutor` already retries status failures twice (500 ms base). oclite's loop
retry covers mid-stream drops and whatever is left after that.

## 11. Render event model (render/)

Every producer emits `RenderEvent` (§2) into an `EventSink`: the loop (deltas, tools, steps, result), the
gateway (through `onQueued`/notice), MCP connect (as status), and sub-agents (re-emitted with `agent_path`
extended).

Sinks:
- **text** (`textSink`): `text_delta` → `process.stdout.write`, unbuffered. `reasoning_delta` → stderr, dim
  (`\x1b[2m`), hidden when `showThinking=false`. `status` → stderr, a single in-place line on a TTY
  (`\r\x1b[K`), cleared on the first delta. `tool_start` → `⚙ read src/x.ts`; `tool_end` → `✓ read src/x.ts ·
  12 ms · 3.4 KB`, rewritten in place on a TTY. `step_finish` → `step 2 · in 812 / out 64 tok` (`est.` if
  estimated). Sub-agent lines are indented by `agent_path.length`.
- **stream-json**: `JSON.stringify(event)` + `\n` per event, with nothing else on stdout.
- **json**: collects silently and prints one `{type:"result", …}` at the end.

`-p` text mode writes only assistant text to stdout, so it can be piped. Everything else goes to stderr.

The `<think>` splitter sits in `llm/think.ts`. It's applied inside `LlmGateway.stream` when `think_tags &&
reasoning_field==="none"`, before the runtime. The runtime, JSONL and every renderer see real
`reasoning-*`/`text-*` events, so think text never enters the history. It buffers only a partial-tag tail of
up to 8 chars across deltas.

## 12. MCP (mcp/)

**Client** (`mcp/client.ts`): a thin manager on `@modelcontextprotocol/sdk`.
- Transports: stdio (`StdioClientTransport`, stderr piped to debug log); remote = StreamableHTTP then SSE,
  stopping on an auth error (opencode's order).
- Client capabilities: `{ roots: {} }`, plus `elicitation: {}` only in `mcp/child.ts` clients.
- Listing uses the path-imported `McpCatalog.defs/prompts/resources/resourceTemplates`.
- Tool calls use `callTool(..., { timeout, resetTimeoutOnProgress: true, onprogress })`.
- Default timeout is 30,000 ms per request (opencode code default; see ADR). Connect uses the same timeout.
- `notifications/tools/list_changed` → re-list, and new tools apply from the next run. The tool list is kept
  stable within a run for the prefix cache.
- OAuth, only for remote servers with `oauth !== false`, via lazy imports of `McpOAuthProvider`,
  `McpOAuthCallback` and `LayerNode.compile(McpAuth.node)`. Tokens are shared with opencode's
  `mcp-auth.json` (ADR). `oclite mcp auth <name>` runs the browser flow.
- Header values and tokens are registered as secrets.

**Tools** (`mcp/tools.ts`):
- Wire name `mcp__<server>__<tool>`. Each part is sanitized `[^A-Za-z0-9_-]→_`. Names over 64 chars become the
  first 55 + `_` + 8 hex chars of sha1.
- Description is `[<server>] <description>`. For local profiles it's truncated to `descriptionMaxChars`.
- `readOnly = annotations.readOnlyHint === true`; `access = { permission: name, patterns: ["*"] }`.
- `default` sends all schemas. `local` and `local-min` send only `tool_search`:
  - input `{query: string, limit?: number(≤10, default 5)}`;
  - output: lines of `name — description`;
  - side effect `toolset.activate(names)`: matching schemas join from the next request, and the activation is
    persisted as `tools_activated`.
- Server `instructions` are appended once per server, only when its tools are in the request.
- Prompts: REPL `/mcp__<server>__<prompt> k=v …` → `getPrompt` → the user message.
- Resources: `@<server>:<uri>` → `readResource`. Text over 8 KB is written to a temp file and attached by path.

**Server** (`mcp/server.ts`): low-level SDK `Server` with raw JSON Schemas (no zod), capabilities
`{tools:{}, prompts:{}, resources:{}, logging:{}}`.
- stdio: `StdioServerTransport`. stdin close → cancel all and exit 0.
- http: `Bun.serve({hostname: "127.0.0.1", port: 4096})` + `WebStandardStreamableHTTPServerTransport` per MCP
  session at `/mcp`. `Authorization: Bearer <OCLITE_MCP_TOKEN>` is required, compared with
  `crypto.timingSafeEqual(sha256(given), sha256(expected))` so lengths never leak. A missing env token → refuse
  to start (exit 2). `--host` other than loopback prints a warning. `bypassPermissions` over http → error
  unless `--i-understand-remote-bypass`.

The server holds `Map<id, RunHandle | SubagentInfo>`. Top-level spawns use `Runtime.start`. With `parent_id`,
it uses `runtime.subagents.spawn` with the parent's ruleset and depth. The root depth comes from env
`OCLITE_DEPTH` (default 0).

Control tools. Each result is `content:[{type:"text", text: JSON}]` plus `structuredContent`, and an
`outputSchema` is declared. Errors are `isError: true` with `{error}`.

| tool | inputSchema | output |
|---|---|---|
| `agent_list` | `{type:object, properties:{}}` | `{agents: [{name, description?, mode}]}` |
| `agent_spawn` | `{agent: string, prompt: string, background?: boolean=false, parent_id?: string, model?: string, cwd?: string, permission_mode?: "default"\|"acceptEdits"\|"plan"\|"bypassPermissions"}` required `[agent,prompt]` | `{id, state, envelope?}`. `envelope` is present when foreground; the call then blocks until done and sends progress when the request carries `_meta.progressToken`. |
| `agent_send` | `{id: string, message: string}` | `{ok: boolean, delivery: "steer"\|"not_running"}` |
| `agent_status` | `{id: string}` | `{id, agent, state, step, started_at (ISO), tokens:{input,output,estimated}, pending_permission?: {request_id, tool, patterns, summary}}` |
| `agent_result` | `{id: string, wait?: boolean=true, timeout_ms?: number=300000}` | `{id, state, envelope?}` (`envelope` once terminal; `state:"running"` on timeout or `wait:false`) |
| `agent_cancel` | `{id: string}` | `{status: "cancelled"\|"already_finished"\|"not_found"}` |
| `agent_permission_reply` | `{id: string, request_id: string, action: "allow"\|"deny"\|"always"}` | `{ok: boolean, error?: "unknown_request"\|"expired"}` |

`envelope` is `<task id="<id>" state="completed|error">…</task>` (§13). Annotations: `agent_list`,
`agent_status` and `agent_result` have `readOnlyHint: true`; the others false.

- Prompts: each primary agent becomes a prompt `{name: agent, description, arguments: [{name: "task",
  required: true}]}`. `getPrompt` returns one user message telling the client to call `agent_spawn` with
  that agent and task.
- Resources: `oclite://sessions/<id>`, mime `application/x-ndjson`. The redacted JSONL is listed only for sessions this server started, or whose cwd is under the serve cwd (Phase 6/7 change).
- Progress: foreground calls with a `progressToken` get `notifications/progress {progress: step, message:
  "<one-line event>"}`. Every run also emits `notifications/message {level: "info", logger: "oclite/<id>", data: RenderEvent}`,
    which includes reasoning deltas batched every 50 ms and tool lifecycle.
- Ask (`askerLayer`):
  - If `getClientCapabilities()?.elicitation`, call `elicitInput({message: summary, requestedSchema: {type:
    "object", properties: {action: {type: "string", enum: ["allow", "deny", "always"]}}, required:
    ["action"]}})`. `accept` maps the action; decline or cancel → reject.
  - Otherwise send `notifications/message {level: "warning", logger: "oclite/<id>", data: {type:
    "permission_request", id, request_id, tool, patterns, summary, reply_with: "agent_permission_reply"}}`
    and wait on a Deferred.
  - Both paths are bounded by `permission_timeout_ms`, after which the result is reject with `via:
    "timeout"`.
  - Reply mapping: allow→once, deny→reject, always→always.

**transport: mcp children** (`mcp/child.ts`, called by `subagent/manager.ts`):
1. `command` defaults to `["oclite", "mcp", "serve"]`. A leading `"oclite"` is rewritten to `[process.execPath,
   <abs path of src/index.ts>]`, so tests don't need a PATH install. Alternatively a `url` + token.
2. Env: parent env + `OCLITE_DEPTH=<depth+1>`.
3. The client declares `elicitation`, and its elicitation handler calls `onAsk` (the parent's Asker).
4. The child `notifications/message` → `onEvent` with `agent_path` extended.
5. Flow: `agent_spawn{background: true}` → `agent_result{wait: true}` with the sub-agent timeout.
6. Scope finalizer: `agent_cancel`, then `client.close()`. The transport sends SIGTERM, then SIGKILL after 2 s.
   A parent `process.on("exit")` kills the remaining child pids. The child exits when stdin closes.

## 13. Sub-agents (subagent/)

State machine, per child:

```
pending ──admit (slot ≤ max_concurrent per parent, depth ok)──► running ──text-only end──► completed
   │                                                              ├──error/step budget──────► failed
   └──cancel──► cancelled                                         └──cancel/parent exit─────► cancelled
```

- `task` tool: params come from forked/task-contract.ts (`description, prompt, subagent_type, task_id?,
  background?`; opencode's `command` param is dropped). Access is `{permission: "task", patterns:
  [subagent_type]}`.
- Depth: `parent.depth + 1 > min(parentAgent.max_depth, cfg.subagent.max_depth)` → tool error `Subagent depth
  limit reached (N)`. Unknown `subagent_type` → error listing the subagents available.
- `task_id` resumes: `Runtime.start({session_id: task_id, …})`. The child must belong to the same parent.
- Isolation: the child run builds its own system prompt from the child agent, its own tools, and the
  instruction files. Its history is only the brief.
- Child ruleset: `permission.ruleset({agent: child, parent: parentRuleset})`. Inside it uses
  `deriveSubagentSessionPermission({parentSessionPermission, subagent: child})`, appended after the child's
  own rules, so parent denies and external_directory rules win.
- Envelope: `renderOutput({sessionID: id, state: completed ? "completed" : "error", summary?, text})`, which
  gives `<task id state><task_result|task_error>…</task>`. Text is the child's final assistant text,
  truncated to 4000 tokens (16,000 chars) with `…[truncated]`. Handbacks are data: the parent loop never
  parses them for approvals.
- Foreground: the tool waits (`wait(id)`) and returns the envelope.
- Background: the tool returns the envelope with state `running`, summary `Background task started` and text
  `BACKGROUND_STARTED`. When the child finishes, it's queued. At the parent's next turn boundary,
  `takeFinished` → a `<system-reminder>` holding the envelope with summary `Background task completed|failed:
  <description>`, in the last user message. `task` with the `task_id` of a running background child → `send`
  + `BACKGROUND_UPDATED`.
- Limits: ≤ 4 running children per parent (extra ones wait `pending`), `steps` per agent, `max_context_tokens`
  per agent, and the shared LLM queue.
- Built-in roles (`agents/*.md`): `build` (primary, full tools); `plan` (primary, read_only, produces a plan);
  `explore` (subagent, read_only, `model` = small_model if set, "≤ 800 words"); `code` (subagent, edit + bash,
  told to stay within the paths in the brief); `audit` (subagent, read_only, reviews diffs/commands for
  destructive ops and secret leaks, returns findings as a data list, never an automatic gate).

## 14. Test plan

Rules: no mocks, no `globalThis` patching. Tests run from `packages/oclite` (`bun test`). Harness pieces:
- `test/lib/local-server.ts`: the one sanctioned double, a `Bun.serve` OpenAI-compatible fake adapted from
  opencode's `test/lib/llm-server.ts` idea (scripted reply queue).
- `test/lib/cli.ts`: spawns `bun src/index.ts …` with a temp HOME/XDG. Adapted from opencode's `cli-process.ts`.
- `test/lib/tmp.ts`.
- `test/fixture/mcp-everything.ts`: a stdio MCP server on the SDK (**deviation**: it replaces
  `@modelcontextprotocol/server-everything`, which isn't installed). It has:
  - tools `echo`, `add`, `slow` (sends progress), `crash` (exits), `write_file` (readOnlyHint false),
    `lookup` (readOnlyHint true);
  - prompt `greet(name)`;
  - resource `fixture://readme` and a template `fixture://item/{id}`;
  - it emits `tools/list_changed`.

  It's modelled on `opencode/test/fixture/mcp-lifecycle-stdio.ts`.

`local-server.ts` toggles, one per §10 field plus failure injection:
`models: "vllm"|"llamacpp"|"lmstudio"|"none"`, `context_window`, `usage_in_stream`, `reasoning_field:
"reasoning_content"|"reasoning"|"none"`, `think_tags`, `tools: "native"|"text"`, `reject_params: string[]`
(400 naming each), `prefix_cache` (simulated prefill delay ∝ prompt chars, cut 80% on repeat prefix),
`context_limit` (400 "maximum context length is N tokens"), `fail_status: {code, times}`,
`drop_after_chunks`, `hang`, `tokenize`, `chunk_delay_ms`, and `usage` = chars/4 of the rendered request, so
budgets are deterministic.

Scripted replies: `text`, `reasoning`, `think` (inline tags), `tool_call{name,args}`, `text_tool_call{format:
"fenced"|"bare"|"hermes"}`. There's a request log for assertions: bodies, headers, byte-equality of
system+tools across turns, and `prompt_cache_key`.

| phase | tests (dir) |
|---|---|
| 2 | `test/cli/args.test.ts`; `test/config/config.test.ts` (precedence, `{env:}`/`{file:}`, Claude `mcpServers` import, `--strict-mcp-config`, hooks both shapes); `test/config/agents.test.ts` (.claude compat tools mapping, extensions, override order); `test/cli/commands.test.ts` (subprocess `agents list`, `mcp list`, `mcp add/remove`); `test/budget/size-budget.test.ts` (passes on src, fails on an oversized fixture dir) |
| 3 | `test/llm/probe.test.ts` (each field per toggle, ≤ 3 requests counted, cache TTL, pins skip probing, `debug server` no `unknown`); `test/llm/fallback.test.ts` (one test per §10 row incl. `delta.reasoning` shim, 400 param strip, context 400 parse+persist+retry, 5xx then success, drop mid-stream, `/no_think` only when pinned); `test/llm/think.test.ts` (tags split across deltas); `test/llm/queue.test.ts` (concurrency 1, queued status); `test/runtime/loop.test.ts` (`-p "list files" --output-format json` subprocess; max-turns → exit 3; first reasoning delta before first text delta; text-protocol path incl. malformed once); `test/runtime/compaction.test.ts` (75%/60% triggers, stubbing first, unknown-context not skipped, overflow retry once); `test/session/store.test.ts` (round trip, resume from last complete tool result, redaction of apiKey/Authorization/MCP headers); `test/permission/permission.test.ts` (evaluate order, modes, `--allowed-tools "bash(git *)"`, read_only complex-bash, headless deny → exit 3, always persisted); `test/hooks/hooks.test.ts` (exit 0/2/other, timeout 10 s, stdin JSON shape); `test/tools/{fs,search,bash,truncate}.test.ts` (bash timeout kills process group; overflow file path hint); `test/tools/text-protocol.test.ts` (fenced, bare, `<tool_call>`, trailing comma, no argument widening); `test/profile/budget.test.ts` (`debug prompt --tokens --check` per profile vs fake); `test/render/render.test.ts` (status line < 300 ms from spawn, per-event render latency < 50 ms via timestamps in stream-json vs server send time, step tokens in text format) |
| 4 | `test/mcp/client.test.ts` vs `mcp-everything.ts`: tool call, prompt as slash command, resource @-mention, naming + 64-char rule, deferred `tool_search` activation, timeout, crash mid-call reported as tool error, list_changed |
| 5 | `test/subagent/subagent.test.ts`: foreground, background + reminder injection at next turn, resume by task_id, depth-limit denial, 4-concurrency cap, read_only `explore` cannot call `mcp__fixture__write_file` nor spawn a writer, envelope truncation |
| 6 | `test/mcp/serve.test.ts`: stdio SDK client with elicitation, and without (reply fallback round trip), permission timeout → deny, HTTP 401 without/with wrong token, bypass refusal over HTTP, oclite↔oclite `transport: mcp` child (spawn, events, ask bubbles to parent, cleanup on cancel/exit, no orphan pids); Claude Code e2e (`claude mcp add` + `-p`) runs only if a `claude` binary is on PATH, otherwise skipped with a Deviation note |
| 7 | `test/failure/*.test.ts`: MCP server dies mid-call, provider 5xx then success, overflow, cancel mid-tool (exit 130, JSONL end cancelled); `test/llm/recorded.test.ts` with `@opencode-ai/http-recorder` (replays when a cassette exists, records when `ANTHROPIC_API_KEY` is set, else skipped: Deviation) |

## 15. Open decisions for the lead **[LEAD]**

1. **Default-profile budget.** The original table legibly says `≤ 2500 tok`, but the same row says default
   uses opencode's per-model prompt and `.txt` descriptions, which come to about 6,900 tokens. Suggested
   resolution: keep default = opencode fidelity and record a Deviation with budget ≤ 7,300 (the opencode
   baseline). The local profiles carry the savings. The alternative is to redefine `default` to use
   mid-length descriptions (≤ 600 chars) and a trimmed prompt.
2. **mcp-auth.json sharing.** This plan shares opencode's file, so tokens from `opencode mcp auth` work. The
   catch is that importing `core/global` creates `~/.local/share/opencode/*` directories as a side effect. The
   alternative is an oclite `McpAuth.Interface` implementation over `~/.local/share/oclite/mcp-auth.json`
   (~40 lines).
3. **Headless exit 3 on denial.** This plan continues the run after a denial (the model gets an error) and
   exits 3 at the end if any denial happened. Claude Code `-p` exits 0 in that case.
4. **`apply_patch` is omitted** from all profiles, because opencode only offers it for GPT-family models. It
   can be added later as an optional tool.
5. The `@/…` tsconfig path is used only for `.txt` asset imports from opencode, because `opencode/*` resolves
   to `*.ts`. `.ts` modules use `opencode/<path>`.


## 16. Post-implementation notes

- `transport: mcp` children receive the parent's deny/ask rules and permission mode via `agent_spawn.parent_rules` / `permission_mode`. A client's `permission_mode` can only tighten the serve-time mode.
- Project trust (Phase 7) gates project-layer `provider`, `mcp`, `hooks`, `servers`, permission allows, `{file:}`/`{env:}` and agent `transport`/`mcp`. See README Security notes.
- `question` is not implemented. REPL `/compact` is a stub (Deviation).
