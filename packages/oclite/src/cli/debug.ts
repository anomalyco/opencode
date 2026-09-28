// `oclite debug prompt [--tokens] [--check]` and `oclite debug server [--reprobe]` (ARCHITECTURE §9, §10).
// The prompt report uses the same composition as Runtime.start: tools/registry.ts builds the ToolSet and
// runtime/context.ts layers the system prompt, so the numbers are those of a real first request.
import { Console, Effect, Stream } from "effect"
import { Message, ToolDefinition } from "@opencode-ai/llm"
import { type AgentDef, ConfigError, LlmGateway, type LlmGatewayShape, Mcp, type ModelHandle, Permission, type Profile, type ResolvedConfig, Runtime, ToolRegistry } from "../contract"
import { load } from "../config/config"
import { fallbackNotices, tokenUsage } from "../llm/client"
import type { CapabilityRecord } from "../llm/probe"
import { headlessAsker } from "../permission/permission"
import { harnessPrompt, select } from "../profile/profiles"
import { system } from "../runtime/context"
import { mcpForRun } from "../mcp/tools"
import { appLayer } from "../runtime/runtime"
import { taskTool } from "../subagent/task"
import { clean } from "../render/event"
import { redact, redactUrl } from "../util/redact"
import type { CliArgs } from "./args"

export function debugPrompt(args: CliArgs) {
  return withApp(args, (cfg, gateway) =>
    Effect.gen(function* () {
      const agent = cfg.agents[cfg.default_agent]!
      const handle = yield* gateway.resolve(agent.model ?? cfg.model)
      const profile = select({ explicit: cfg.profile, handle })
      const request = yield* first(cfg, handle, profile, agent)
      const tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description.length, schema: JSON.stringify(tool.inputSchema).length }))
      const chars = request.system.length + JSON.stringify(request.tools.map(wire)).length
      const measured = args.tokens || args.check ? yield* fixed(gateway, handle, request) : undefined
      const tokens = measured?.tokens ?? Math.ceil(chars / 4)
      const over = args.check === true && tokens > profile.budgetTokens
      const report = { profile: profile.name, model: handle.ref, budget: profile.budgetTokens, system_chars: request.system.length, tools, fixed: measured?.tokens, estimated: measured?.estimated ?? true, over }
      yield* Console.log(clean(args.outputFormat === "text" ? [
        `profile ${profile.name} · model ${handle.ref} · budget ${profile.budgetTokens} tok`,
        `--- system (${request.system.length} chars)`, request.system, "--- tools",
        ...tools.map((tool) => `${tool.name.padEnd(12)} description ${String(tool.description).padStart(5)} chars · schema ${String(tool.schema).padStart(4)} chars`),
        `total ${chars} chars ≈ ${Math.ceil(chars / 4)} tok (chars/4)`,
        ...(measured ? [`fixed overhead: ${measured.tokens} tok${measured.estimated ? " (est.)" : " (server-reported)"}`] : []),
        ...(over ? [`over budget: ${tokens} > ${profile.budgetTokens}`] : []),
      ].join("\n") : JSON.stringify(report)))
      if (over) process.exitCode = 1
    }),
  )
}

export function debugServer(args: CliArgs) {
  return withApp(args, (cfg, gateway) =>
    Effect.gen(function* () {
      const handle = yield* gateway.resolve(cfg.agents[cfg.default_agent]?.model ?? cfg.model, { reprobe: args.reprobe })
      const record = handle.capabilities as CapabilityRecord
      if (args.outputFormat !== "text") return yield* Console.log(clean(JSON.stringify(redact(record))))
      const keys = Object.keys(record.sources) as Array<keyof CapabilityRecord["sources"]>
      yield* Console.log(clean([
        `server ${redactUrl(handle.baseURL)} · model ${handle.model.id}${handle.local ? " (loopback)" : ""}`,
        ...keys.map((key) => `${key.padEnd(16)} ${JSON.stringify(record[key])}  (${record.sources[key]})`),
        ...(record.ttft_ms ? [`ttft_ms          ${record.ttft_ms.map(Math.round).join(" → ")}`] : []),
        ...fallbackNotices(handle).map((item) => `notice: ${item.message}`),
      ].join("\n")))
    }),
  )
}

function withApp<A>(args: CliArgs, body: (cfg: ResolvedConfig, gateway: LlmGatewayShape) => Effect.Effect<A, ConfigError, ToolRegistry | Permission | Mcp | Runtime>) {
  return Effect.gen(function* () {
    const cfg = yield* load(args)
    return yield* Effect.gen(function* () {
      const gateway = yield* LlmGateway
      return yield* body(cfg, gateway)
    }).pipe(Effect.provide(appLayer(cfg, headlessAsker)))
  })
}

/** The first request's system + tool definitions, composed exactly as Runtime.start does (byte-stable, tools sorted). */
function first(cfg: ResolvedConfig, handle: ModelHandle, profile: Profile, agent: AgentDef) {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry
    const permission = yield* Permission
    const mcp = yield* Mcp
    const runtime = yield* Runtime
    const servers = yield* mcpForRun(mcp, profile, () => Effect.void, () => Effect.void)
    const ruleset = permission.ruleset({ agent, mode: cfg.permissionMode, mcpReadOnly: servers.readOnly })
    const ctx = { session_id: "ses_debug", cwd: cfg.cwd, agent, depth: 0, ruleset, sink: () => Effect.void, profile }
    const tools = yield* registry.build(ctx, [...servers.extra, taskTool({ ctx, subagents: runtime.subagents, cfg, parentReadOnly: cfg.permissionMode === "plan" || agent.read_only })], handle.capabilities)
    const mcpInstructions = yield* servers.bind(tools, [])
    const prompt = yield* Effect.promise(() =>
      system({ harness: harnessPrompt(profile, handle), agent, cfg, profile, textProtocolPrompt: tools.textProtocolPrompt, mcpInstructions }),
    )
    return { system: prompt.text, tools: tools.definitions }
  })
}

/** `first` outside an Effect context (profile tests). */
export function compose(cfg: ResolvedConfig, handle: ModelHandle, profile: Profile, agent: AgentDef) {
  return Effect.runPromise(first(cfg, handle, profile, agent).pipe(Effect.provide(appLayer(cfg, headlessAsker))))
}

const wire = (tool: ToolDefinition) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })

/** §9: A = the request with maxTokens 1, B = the same with no system and no tools; fixed = A.input − B.input. */
function fixed(gateway: LlmGatewayShape, handle: ModelHandle, request: { system: string; tools: ToolDefinition[] }) {
  const input = (system: string, tools: ToolDefinition[]) =>
    gateway.stream(handle, { session_id: "ses_debug", label: "debug prompt", system, messages: [Message.user(".")], tools, thinking: undefined, maxTokens: 1, onQueued: () => Effect.void })
      .pipe(Stream.runCollect, Effect.map((events) => tokenUsage(events.flatMap((event) => (event.type === "finish" ? [event.usage] : [])).at(-1))))
  return Effect.gen(function* () {
    const a = yield* input(request.system, request.tools)
    const b = yield* input("", [])
    return { tokens: a.input - b.input, estimated: a.estimated || b.estimated }
  }).pipe(Effect.mapError((error) => new ConfigError({ message: `debug prompt --tokens: ${error.message}` })))
}
