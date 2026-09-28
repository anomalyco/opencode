// `oclite debug prompt [--tokens] [--check]` and `oclite debug server [--reprobe]` (ARCHITECTURE §9, §10).
// Stand-in composition until runtime/context.ts and tools/registry.ts land: system = harness prompt + agent prompt +
// env block; tools = the profile's list with profile descriptions (opencode .txt for default) and minimal schemas.
import path from "path"
import { Console, Effect, Layer, Stream } from "effect"
import { Message, ToolDefinition } from "@opencode-ai/llm"
import { type AgentDef, AppConfig, ConfigError, LlmGateway, type LlmGatewayShape, type ModelHandle, type Profile, type ResolvedConfig } from "../contract"
import { load } from "../config/config"
import { fallbackNotices, layer, tokenUsage } from "../llm/client"
import type { CapabilityRecord } from "../llm/probe"
import { descriptions, harnessPrompt, select } from "../profile/profiles"
import type { CliArgs } from "./args"
import EDIT from "@/tool/edit.txt"
import GLOB from "@/tool/glob.txt"
import GREP from "@/tool/grep.txt"
import QUESTION from "@/tool/question.txt"
import READ from "@/tool/read.txt"
import SKILL from "@/tool/skill.txt"
import TASK from "@/tool/task.txt"
import TODOWRITE from "@/tool/todowrite.txt"
import WEBFETCH from "@/tool/webfetch.txt"
import WRITE from "@/tool/write.txt"

const OPENCODE: Record<string, string> = { edit: EDIT, glob: GLOB, grep: GREP, question: QUESTION, read: READ, skill: SKILL, task: TASK, todowrite: TODOWRITE, webfetch: WEBFETCH, write: WRITE }
const object = (props: Record<string, string>, required: string[]) => ({
  type: "object", required,
  properties: Object.fromEntries(Object.entries(props).map(([key, type]) => [key, type === "array" ? { type, items: { type: "object" } } : { type }])),
})
// Parameter names match opencode exactly (ADR "Tools"), so the default profile can reuse opencode's .txt texts.
const SCHEMAS: Record<string, ReturnType<typeof object>> = {
  bash: object({ command: "string", timeout: "integer", workdir: "string" }, ["command"]),
  edit: object({ filePath: "string", oldString: "string", newString: "string", replaceAll: "boolean" }, ["filePath", "oldString", "newString"]),
  glob: object({ pattern: "string", path: "string" }, ["pattern"]),
  grep: object({ pattern: "string", path: "string", include: "string" }, ["pattern"]),
  question: object({ questions: "array" }, ["questions"]),
  read: object({ filePath: "string", offset: "integer", limit: "integer" }, ["filePath"]),
  skill: object({ name: "string" }, ["name"]),
  task: object({ description: "string", prompt: "string", subagent_type: "string", task_id: "string", background: "boolean" }, ["description", "prompt", "subagent_type"]),
  todowrite: object({ todos: "array" }, ["todos"]),
  webfetch: object({ url: "string", format: "string", timeout: "number" }, ["url", "format"]),
  write: object({ content: "string", filePath: "string" }, ["content", "filePath"]),
}

export function debugPrompt(args: CliArgs) {
  return withGateway(args, (cfg, gateway) =>
    Effect.gen(function* () {
      const agent = cfg.agents[cfg.default_agent]!
      const handle = yield* gateway.resolve(agent.model ?? cfg.model)
      const profile = select({ explicit: cfg.profile, handle })
      const request = yield* Effect.promise(() => compose(cfg, handle, profile, agent))
      const tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description.length, schema: JSON.stringify(tool.inputSchema).length }))
      const chars = request.system.length + JSON.stringify(request.tools.map(wire)).length
      const measured = args.tokens || args.check ? yield* fixed(gateway, handle, request) : undefined
      const tokens = measured?.tokens ?? Math.ceil(chars / 4)
      const over = args.check === true && tokens > profile.budgetTokens
      const report = { profile: profile.name, model: handle.ref, budget: profile.budgetTokens, system_chars: request.system.length, tools, fixed: measured?.tokens, estimated: measured?.estimated ?? true, over }
      yield* Console.log(args.outputFormat === "text" ? [
        `profile ${profile.name} · model ${handle.ref} · budget ${profile.budgetTokens} tok`,
        `--- system (${request.system.length} chars)`, request.system, "--- tools",
        ...tools.map((tool) => `${tool.name.padEnd(12)} description ${String(tool.description).padStart(5)} chars · schema ${String(tool.schema).padStart(4)} chars`),
        `total ${chars} chars ≈ ${Math.ceil(chars / 4)} tok (chars/4)`,
        ...(measured ? [`fixed overhead: ${measured.tokens} tok${measured.estimated ? " (est.)" : " (server-reported)"}`] : []),
        ...(over ? [`over budget: ${tokens} > ${profile.budgetTokens}`] : []),
      ].join("\n") : JSON.stringify(report))
      if (over) process.exitCode = 1
    }),
  )
}

export function debugServer(args: CliArgs) {
  return withGateway(args, (cfg, gateway) =>
    Effect.gen(function* () {
      const handle = yield* gateway.resolve(cfg.agents[cfg.default_agent]?.model ?? cfg.model, { reprobe: args.reprobe })
      const record = handle.capabilities as CapabilityRecord
      if (args.outputFormat !== "text") return yield* Console.log(JSON.stringify(record))
      const keys = Object.keys(record.sources) as Array<keyof CapabilityRecord["sources"]>
      yield* Console.log([
        `server ${handle.baseURL} · model ${handle.model.id}${handle.local ? " (loopback)" : ""}`,
        ...keys.map((key) => `${key.padEnd(16)} ${JSON.stringify(record[key])}  (${record.sources[key]})`),
        ...(record.ttft_ms ? [`ttft_ms          ${record.ttft_ms.map(Math.round).join(" → ")}`] : []),
        ...fallbackNotices(handle).map((item) => `notice: ${item.message}`),
      ].join("\n"))
    }),
  )
}

function withGateway<A>(args: CliArgs, body: (cfg: ResolvedConfig, gateway: LlmGatewayShape) => Effect.Effect<A, ConfigError>) {
  return Effect.gen(function* () {
    const cfg = yield* load(args)
    return yield* Effect.gen(function* () {
      const gateway = yield* LlmGateway
      return yield* body(cfg, gateway)
    }).pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(AppConfig, cfg)))))
  })
}

/** Exact first-turn system + tool definitions for this agent/profile (byte-stable: tools sorted, env date only). */
export async function compose(cfg: ResolvedConfig, handle: ModelHandle, profile: Profile, agent: AgentDef) {
  const names = [...new Set([...profile.tools, ...(agent.tools ?? []).filter((name) => profile.optionalTools.includes(name))])].sort()
  const tools = await Promise.all(names.map(async (name) =>
    new ToolDefinition({ name, description: descriptions(profile, name) ?? (await opencodeDescription(name)), inputSchema: SCHEMAS[name] ?? object({}, []) }),
  ))
  const head = await Bun.file(path.join(cfg.projectRoot, ".git", "HEAD")).text().catch(() => "")
  const branch = head.startsWith("ref: refs/heads/") ? head.slice(16).trim() : head.trim().slice(0, 12)
  const env = ["<env>", `cwd: ${cfg.cwd}`, `platform: ${process.platform}`, `date: ${new Date().toISOString().slice(0, 10)}`,
    ...(branch ? [`git branch: ${branch}`] : []), "</env>"].join("\n")
  return { system: [harnessPrompt(profile, handle), agent.prompt, env].filter(Boolean).join("\n\n"), tools }
}

async function opencodeDescription(name: string) {
  if (name !== "bash") return OPENCODE[name] ?? ""
  // Lazy: ShellPrompt imports core/global (mkdirs opencode data dirs); only the default profile reaches it.
  const { ShellPrompt } = await import("opencode/tool/shell/prompt")
  return ShellPrompt.render("bash", process.platform, { maxLines: 2000, maxBytes: 50 * 1024 }, 120_000).description
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
