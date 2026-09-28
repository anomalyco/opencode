// Shared cross-dir types and service tags (docs/ARCHITECTURE.md §2, §7). Frozen after Phase 2: changes need lead sign-off.
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
export interface ServerPins { capabilities?: Partial<Omit<Capabilities, "accepts">> & { accepts?: Partial<Capabilities["accepts"]> }; context_window?: number; max_tokens?: number; concurrency?: number; probe_timeout_ms?: number }
export interface ProviderEntry {
  npm?: string; options?: { baseURL?: string; apiKey?: string; headers?: Record<string, string> }
  models?: Record<string, { limit?: { context?: number; output?: number }; reasoning?: boolean; options?: Record<string, unknown> }>
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
export type SessionHeader = { type: "session"; v: 1; id: string; cwd: string; agent: string; model: string; profile: ProfileName;
  parent_id?: string; parent_call_id?: string; depth: number; created_at: number; title?: string }
export type RecordInput =
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
  | { type: "end"; reason: RunResult["reason"]; turns: number; usage: TokenUsage }
export type SessionRecord = { seq: number; t: number } & RecordInput
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
