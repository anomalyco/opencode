import { existsSync } from "fs"
import path from "path"
import { Console, Effect, Option } from "effect"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { type AgentDef, ConfigError } from "../contract"
import { decode } from "../config/agents"
import { load, parseJson } from "../config/config"
import { configDir, projectRoot } from "../util/paths"
import { redact, redactArgs, redactText, redactUrl } from "../util/redact"
import type { CliArgs } from "./args"

type Scope = "project" | "user"

export function notImplemented(what: string, phase: number) {
  return (_args: CliArgs, _input?: unknown) =>
    Effect.fail(new ConfigError({ message: `${what}: not implemented yet (phase ${phase})` }))
}

export function agentsList(args: CliArgs) {
  return Effect.gen(function* () {
    const cfg = yield* load(args)
    const agents = Object.values(cfg.agents).sort((a, b) => a.name.localeCompare(b.name))
    if (args.outputFormat !== "text")
      return yield* Console.log(
        JSON.stringify(agents.map((agent) => ({ name: agent.name, mode: agent.mode, description: agent.description, source: agent.source }))),
      )
    const width = Math.max(...agents.map((agent) => agent.name.length))
    yield* Console.log(
      agents
        .map((agent) =>
          [
            agent.name.padEnd(width),
            agent.mode.padEnd(8),
            (agent.read_only ? "read-only" : "").padEnd(9),
            agent.description ?? "",
            agent.source === "builtin" ? "" : `(${agent.source})`,
          ]
            .join("  ")
            .trimEnd(),
        )
        .join("\n"),
    )
  })
}

export function agentsShow(args: CliArgs, input: { name: string }) {
  return Effect.gen(function* () {
    const cfg = yield* load(args)
    const agent = cfg.agents[input.name]
    if (!agent)
      return yield* new ConfigError({
        message: `unknown agent "${input.name}" (available: ${Object.keys(cfg.agents).sort().join(", ")})`,
      })
    if (args.outputFormat !== "text") return yield* Console.log(JSON.stringify(redact(agent)))
    yield* Console.log(describeAgent(agent))
  })
}

function describeAgent(agent: AgentDef) {
  return [
    `name: ${agent.name}`,
    `mode: ${agent.mode}`,
    agent.description && `description: ${agent.description}`,
    `model: ${agent.model ?? "(inherit)"}`,
    `source: ${agent.source}`,
    `transport: ${agent.transport}${agent.mcp ? ` ${JSON.stringify(agent.mcp)}` : ""}`,
    `read_only: ${agent.read_only}  max_depth: ${agent.max_depth}  thinking: ${agent.thinking}`,
    agent.steps !== undefined && `steps: ${agent.steps}`,
    agent.max_context_tokens !== undefined && `max_context_tokens: ${agent.max_context_tokens}`,
    agent.tools && `tools: ${agent.tools.join(", ")}`,
    agent.permission.length > 0 &&
      ["permission:", ...agent.permission.map((rule) => `  ${rule.permission} ${rule.pattern} ${rule.action}`)].join("\n"),
    agent.prompt && `\n${agent.prompt}`,
  ]
    .filter((line) => typeof line === "string" && line.length > 0)
    .join("\n")
}

export function mcpList(args: CliArgs) {
  return Effect.gen(function* () {
    const cfg = yield* load(args)
    const names = Object.keys(cfg.mcp).sort()
    if (args.outputFormat !== "text") return yield* Console.log(JSON.stringify(redact(cfg.mcp)))
    if (!names.length) return yield* Console.log("No MCP servers configured.")
    yield* Console.log(
      names
        .map((name) => {
          const server = cfg.mcp[name]
          const target = server.type === "local" ? redactArgs(server.command).join(" ") : redactUrl(server.url)
          return redactText(`${name}: ${target} (${server.type})${server.enabled === false ? " [disabled]" : ""}`)
        })
        .join("\n"),
    )
  })
}

export function mcpGet(args: CliArgs, input: { name: string }) {
  return Effect.gen(function* () {
    const cfg = yield* load(args)
    const server = cfg.mcp[input.name]
    if (!server) return yield* new ConfigError({ message: `no MCP server named "${input.name}"` })
    const shown = server.type === "local" ? { ...server, command: redactArgs(server.command) } : server
    yield* Console.log(JSON.stringify(redact({ name: input.name, ...shown }), null, 2))
  })
}

export function mcpAdd(
  args: CliArgs,
  input: {
    name: string
    target: ReadonlyArray<string>
    transport: Option.Option<"stdio" | "http" | "sse">
    scope: Scope
    env: Option.Option<Record<string, string>>
    header: ReadonlyArray<string>
    timeout: Option.Option<number>
  },
) {
  return Effect.gen(function* () {
    const target = [...input.target]
    const transport = Option.getOrUndefined(input.transport)
    const remote = transport === "http" || transport === "sse" || (!transport && target.length === 1 && /^https?:\/\//.test(target[0]))
    if (!target.length) return yield* new ConfigError({ message: "mcp add: missing command or URL" })
    if (remote && target.length !== 1) return yield* new ConfigError({ message: "mcp add: a remote server takes one URL" })
    const invalid = input.header.find((header) => !header.includes(":"))
    if (invalid) return yield* new ConfigError({ message: `mcp add: header "${invalid}" is not "Name: value"` })
    const headers = Object.fromEntries(
      input.header.map((header) => [header.slice(0, header.indexOf(":")).trim(), header.slice(header.indexOf(":") + 1).trim()]),
    )
    const timeout = Option.getOrUndefined(input.timeout)
    const environment = Option.getOrUndefined(input.env)
    const entry = remote
      ? { type: "remote", url: target[0], ...(input.header.length ? { headers } : {}), ...(timeout ? { timeout } : {}) }
      : { type: "local", command: target, ...(environment ? { environment } : {}), ...(timeout ? { timeout } : {}) }
    yield* attempt(async () => decode(ConfigMCPV1.Info, entry, "mcp add"))
    const file = scopeFile(input.scope)
    const raw = yield* attempt(() => readRaw(file))
    const servers = mcpBlock(raw)
    if (servers[input.name])
      return yield* new ConfigError({ message: `MCP server "${input.name}" already exists in ${file}` })
    yield* attempt(() => Bun.write(file, JSON.stringify({ ...raw, mcp: { ...servers, [input.name]: entry } }, null, 2) + "\n"))
    yield* Console.log(`Added ${entry.type} MCP server "${input.name}" to ${file}`)
  })
}

export function mcpRemove(args: CliArgs, input: { name: string; scope: Option.Option<Scope> }) {
  return Effect.gen(function* () {
    const scopes = Option.match(input.scope, { onNone: (): Scope[] => ["project", "user"], onSome: (scope) => [scope] })
    const files = yield* attempt(() =>
      Promise.all(scopes.map(async (scope) => ({ file: scopeFile(scope), raw: await readRaw(scopeFile(scope)) }))),
    )
    const found = files.find((item) => mcpBlock(item.raw)[input.name] !== undefined)
    if (!found)
      return yield* new ConfigError({ message: `no MCP server named "${input.name}" in ${scopes.join(" or ")} config` })
    const servers = Object.fromEntries(Object.entries(mcpBlock(found.raw)).filter((entry) => entry[0] !== input.name))
    yield* attempt(() => Bun.write(found.file, JSON.stringify({ ...found.raw, mcp: servers }, null, 2) + "\n"))
    yield* Console.log(`Removed MCP server "${input.name}" from ${found.file}`)
  })
}

function scopeFile(scope: Scope) {
  if (scope === "user") return path.join(configDir(), "config.json")
  return path.join(projectRoot(process.cwd()), ".oclite", "config.json")
}

// Raw (unsubstituted) JSON so `{env:…}` references survive a rewrite. Comments are not preserved.
async function readRaw(file: string): Promise<Record<string, unknown>> {
  if (!existsSync(file)) return {}
  const value: unknown = await parseJson(await Bun.file(file).text(), file)
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ConfigError({ message: `${file}: expected a JSON object` })
  return { ...value }
}

function mcpBlock(raw: Record<string, unknown>): Record<string, unknown> {
  return typeof raw.mcp === "object" && raw.mcp !== null ? { ...raw.mcp } : {}
}

function attempt<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (error) => (error instanceof ConfigError ? error : new ConfigError({ message: String(error) })),
  })
}
