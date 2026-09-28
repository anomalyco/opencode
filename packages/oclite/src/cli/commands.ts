import { existsSync } from "fs"
import path from "path"
import { Console, Effect, Layer, Logger, Option } from "effect"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { type AgentDef, AppConfig, ConfigError, Mcp, type McpShape, type ResolvedConfig } from "../contract"
import { decode } from "../config/agents"
import { type LoadedConfig, load, parseJson, trust, trustNotice } from "../config/config"
import { configDir, dataDir, projectRoot } from "../util/paths"
import { redact, redactArgs, redactText, redactUrl } from "../util/redact"
import type { CliArgs } from "./args"

type Scope = "project" | "user"

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

/** `--check` connects to every server (in parallel, per-server timeout) and adds its live status. */
export function mcpList(args: CliArgs, input: { check: boolean } = { check: false }) {
  return Effect.gen(function* () {
    const cfg = yield* load(args)
    yield* warnUntrusted(cfg)
    const names = Object.keys(cfg.mcp).sort()
    const live = input.check && names.length ? yield* withMcp(cfg, (mcp) => mcp.connectAll(() => Effect.void).pipe(Effect.andThen(mcp.status()))) : []
    const status = (name: string) => live.find((item) => item.name === name)
    if (args.outputFormat !== "text")
      return yield* Console.log(JSON.stringify(redact(input.check ? Object.fromEntries(names.map((name) => [name, { ...cfg.mcp[name], live: status(name) }])) : cfg.mcp)))
    if (!names.length) return yield* Console.log("No MCP servers configured.")
    const { statusText } = yield* Effect.promise(() => import("../mcp/tools"))
    yield* Console.log(
      names
        .map((name) => {
          const server = cfg.mcp[name]
          const target = server.type === "local" ? redactArgs(server.command).join(" ") : redactUrl(server.url)
          const found = status(name)
          return redactText(`${name}: ${target} (${server.type})${server.enabled === false ? " [disabled]" : ""}${found ? ` · ${statusText(found).slice(name.length + 2)}` : ""}`)
        })
        .join("\n"),
    )
  })
}

/** `oclite mcp serve`: stdout is the MCP channel over stdio, so logs go to stderr. */
export function mcpServe(args: CliArgs, input: { transport: "stdio" | "http"; port: number; host: string; iUnderstandRemoteBypass: boolean }) {
  return Effect.gen(function* () {
    const cfg = yield* load(args)
    yield* warnUntrusted(cfg)
    const { serve } = yield* Effect.promise(() => import("../mcp/server"))
    yield* serve(cfg, { transport: input.transport, host: input.host, port: input.port, allowRemoteBypass: input.iUnderstandRemoteBypass })
    // stdio returns once stdin closed and every run was cancelled (and its layer closed); stdin's handle would keep us alive.
    process.exit(0)
  }).pipe(Effect.provideService(Logger.LogToStderr, true))
}

/** `oclite mcp auth <name>`: the OAuth browser flow; tokens go to the mcp-auth.json shared with opencode. */
export function mcpAuth(args: CliArgs, input: { name: string }) {
  return Effect.gen(function* () {
    const cfg = yield* load(args)
    const status = yield* withMcp(cfg, (mcp) =>
      mcp.authenticate(input.name).pipe(Effect.mapError((error) => new ConfigError({ message: `mcp auth: ${error.message}` }))),
    )
    const { statusText } = yield* Effect.promise(() => import("../mcp/tools"))
    yield* Console.log(redactText(statusText(status)))
  })
}

function withMcp<A>(cfg: ResolvedConfig, body: (mcp: McpShape) => Effect.Effect<A, ConfigError>) {
  return Effect.gen(function* () {
    const client = yield* Effect.promise(() => import("../mcp/client"))
    return yield* Effect.gen(function* () {
      const mcp = yield* Mcp
      return yield* body(mcp)
    }).pipe(Effect.provide(client.layer.pipe(Layer.provide(Layer.succeed(AppConfig, cfg)))))
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

export function sessionList(args: CliArgs) {
  return Effect.gen(function* () {
    const store = yield* sessions
    const items = yield* store.list({ cwd: path.resolve(process.cwd()), limit: 50 })
    if (args.outputFormat !== "text") return yield* Console.log(JSON.stringify(items))
    if (!items.length) return yield* Console.log("No sessions in this directory.")
    yield* Console.log(items.map((item) => [item.id, new Date(item.created_at).toISOString().slice(0, 16).replace("T", " "), item.agent, item.model, item.profile].join("  ")).join("\n"))
  })
}

export function sessionShow(args: CliArgs, input: { id: string }) {
  return Effect.gen(function* () {
    const records = yield* sessionRecords(input.id)
    if (args.outputFormat !== "text") return yield* Console.log(JSON.stringify(records))
    const lines = records.flatMap((record) => {
      if (record.type === "session") return [`session ${record.id} · ${record.agent} · ${record.model} · ${record.profile} · ${record.cwd}`]
      if (record.type === "user" && !record.synthetic) return [`\n> ${record.text}`]
      if (record.type === "text") return [record.text]
      if (record.type === "tool_result") return [`[${record.name} ${record.status} · ${record.bytes} B]`]
      if (record.type === "end") return [`\n(end: ${record.reason}, ${record.turns} turns, in ${record.usage.input} / out ${record.usage.output} tok)`]
      return []
    })
    yield* Console.log(lines.join("\n"))
  })
}

export function sessionExport(_args: CliArgs, input: { id: string }) {
  return sessionRecords(input.id).pipe(Effect.flatMap((records) => Console.log(records.map((record) => JSON.stringify(record)).join("\n"))))
}

function sessionRecords(id: string) {
  return sessions.pipe(
    Effect.flatMap((store) => store.read(id)),
    Effect.flatMap((records) => (records.length ? Effect.succeed(records) : Effect.fail(new ConfigError({ message: `unknown session "${id}"` })))),
  )
}

// Lazy: the store pulls @opencode-ai/llm, which `agents list` and `mcp list` never need.
const sessions = Effect.promise(() => import("../session/store")).pipe(Effect.map((store) => store.make(path.join(dataDir(), "sessions"))))

/** `oclite trust [path] [--yes]`: prints what the project layer sets that untrusted runs ignore, then records its hash. */
export function trustProject(args: CliArgs, input: { path: Option.Option<string>; yes: boolean }) {
  return Effect.gen(function* () {
    const cwd = path.resolve(Option.getOrElse(input.path, () => process.cwd()))
    const cfg = yield* load(args, { cwd, storedTrustOnly: true })
    if (cfg.trust.trusted) return yield* Console.log(`${cfg.trust.root} is already trusted`)
    yield* Console.log(`${cfg.trust.root}: ${cfg.trust.skipped.length ? `defines ${cfg.trust.skipped.join(", ")}` : "nothing beyond prompts and agents"}`)
    const yes = input.yes || (process.stdin.isTTY === true && (prompt(`Trust ${cfg.trust.root}? [y/N]`) ?? "").trim().toLowerCase() === "y")
    if (!yes) {
      process.exitCode = 1
      return yield* Console.log("not trusted (re-run with --yes to record it)")
    }
    yield* attempt(() => trust(cfg.trust.root))
    yield* Console.log(`trusted ${cfg.trust.root} (a change to its config, agents or instructions revokes it)`)
  })
}

const warnUntrusted = (cfg: LoadedConfig) => Effect.sync(() => trustNotice(cfg) && console.error(`oclite: notice: ${trustNotice(cfg)}`))

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
