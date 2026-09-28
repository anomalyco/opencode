import { existsSync } from "fs"
import os from "os"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { ConfigAgentV1 } from "@opencode-ai/core/v1/config/agent"
import { ConfigMCPV1 } from "@opencode-ai/core/v1/config/mcp"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { CliArgs } from "../cli/args"
import { AppConfig, ConfigError, type HookEntry, type ResolvedConfig } from "../contract"
import { substitute } from "../forked/variable"
import { configDir, projectRoot } from "../util/paths"
import { argSecrets, registerSecret, urlSecrets } from "../util/redact"
import { claudeTool, decode, fromConfig, loadAgents, mergeDeep } from "./agents"

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5"
const HOOK_TIMEOUT_MS = 10_000

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

// One struct for both hook shapes: oclite `{matcher, command, timeout(ms)}` and Claude
// `{matcher, hooks: [{type: "command", command, timeout(s)}]}`.
const Hook = Schema.Struct({
  matcher: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Finite),
  hooks: Schema.optional(
    Schema.Array(
      Schema.Struct({ type: Schema.optional(Schema.String), command: Schema.String, timeout: Schema.optional(Schema.Finite) }),
    ),
  ),
})

const Pins = Schema.Struct({
  context_window: Schema.optional(Count),
  usage_in_stream: Schema.optional(Schema.Boolean),
  reasoning_field: Schema.optional(Schema.Literals(["reasoning_content", "reasoning", "none"])),
  think_tags: Schema.optional(Schema.Boolean),
  tools_native: Schema.optional(Schema.Boolean),
  accepts: Schema.optional(
    Schema.Struct({
      chat_template_kwargs: Schema.optional(Schema.Boolean),
      prompt_cache_key: Schema.optional(Schema.Boolean),
      reasoning_effort: Schema.optional(Schema.Boolean),
      parallel_tool_calls: Schema.optional(Schema.Boolean),
    }),
  ),
  prefix_cache: Schema.optional(Schema.Boolean),
  concurrency: Schema.optional(Count),
  tokenize: Schema.optional(Schema.Boolean),
  no_think_suffix: Schema.optional(Schema.Boolean),
})

const Provider = Schema.Struct({
  npm: Schema.optional(Schema.String),
  options: Schema.optional(
    Schema.Struct({
      baseURL: Schema.optional(Schema.String),
      apiKey: Schema.optional(Schema.String),
      headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
  models: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        limit: Schema.optional(Schema.Struct({ context: Schema.optional(Count), output: Schema.optional(Count) })),
        reasoning: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
})

const HookList = Schema.optional(Schema.Array(Hook))

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  small_model: Schema.optional(Schema.String),
  profile: Schema.optional(Schema.Literals(["default", "local", "local-min"])),
  default_agent: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.Record(Schema.String, Provider)),
  mcp: Schema.optional(Schema.Record(Schema.String, ConfigMCPV1.Info)),
  permission: Schema.optional(ConfigPermissionV1.Info),
  agent: Schema.optional(Schema.Record(Schema.String, ConfigAgentV1.Info)),
  instructions: Schema.optional(Schema.Array(Schema.String)),
  hooks: Schema.optional(Schema.Struct({ PreToolUse: HookList, PostToolUse: HookList, Stop: HookList })),
  servers: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        capabilities: Schema.optional(Pins),
        context_window: Schema.optional(Count),
        max_tokens: Schema.optional(Count),
        concurrency: Schema.optional(Count),
      }),
    ),
  ),
  permission_timeout_ms: Schema.optional(Count),
  subagent: Schema.optional(Schema.Struct({ max_depth: Schema.optional(Count), max_concurrent: Schema.optional(Count) })),
})
export type Info = typeof Info.Type

// --mcp-config accepts oclite/opencode `{mcp}` or Claude `{mcpServers}`.
const McpFile = Schema.Struct({
  mcp: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  mcpServers: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        type: Schema.optional(Schema.String),
        command: Schema.optional(Schema.String),
        args: Schema.optional(Schema.Array(Schema.String)),
        env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
        url: Schema.optional(Schema.String),
        headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      }),
    ),
  ),
})

export interface LoadContext {
  cwd?: string
  home?: string
  configDir?: string
}

export function load(args: CliArgs, ctx: LoadContext = {}) {
  return Effect.tryPromise({
    try: () => resolve(args, ctx),
    catch: (error) => (error instanceof ConfigError ? error : new ConfigError({ message: String(error) })),
  })
}

export function layer(cfg: ResolvedConfig) {
  return Layer.succeed(AppConfig, cfg)
}

async function resolve(args: CliArgs, ctx: LoadContext): Promise<ResolvedConfig> {
  const cwd = path.resolve(ctx.cwd ?? process.cwd())
  const home = ctx.home ?? os.homedir()
  const userDir = ctx.configDir ?? configDir()
  const root = projectRoot(cwd)
  const files = [
    await readConfig(path.join(userDir, "config.json"), userDir),
    await readConfig(path.join(root, ".oclite", "config.json"), root),
  ].map((layer): Info => (args.strictMcpConfig ? { ...layer, mcp: undefined } : layer))
  const imported = await Promise.all(args.mcpConfig.map((value) => readMcpConfig(value, cwd)))
  const merged = [...files, ...imported.map((mcp): Info => ({ mcp }))].reduce(mergeLayer, {})

  const agents = await loadAgents({ projectRoot: root, cwd, home, configDir: userDir, overrides: merged.agent ?? {} })
  if (merged.small_model && agents.explore && !agents.explore.model) agents.explore.model = merged.small_model
  const defaultAgent = args.agent ?? merged.default_agent ?? "build"
  if (!agents[defaultAgent])
    throw new ConfigError({ message: `unknown agent "${defaultAgent}" (available: ${Object.keys(agents).join(", ")})` })

  registerSecrets(merged)
  return {
    cwd,
    projectRoot: root,
    model: args.model ?? merged.model ?? DEFAULT_MODEL,
    small_model: merged.small_model,
    profile: args.profile ?? merged.profile,
    default_agent: defaultAgent,
    provider: merged.provider ?? {},
    mcp: merged.mcp ?? {},
    permission: fromConfig(merged.permission ?? {}),
    cliRules: [...cliRules(args.allowedTools, "allow"), ...cliRules(args.disallowedTools, "deny")],
    permissionMode: args.permissionMode ?? "default",
    instructions: [...(merged.instructions ?? [])],
    hooks: {
      PreToolUse: hooks(merged.hooks?.PreToolUse),
      PostToolUse: hooks(merged.hooks?.PostToolUse),
      Stop: hooks(merged.hooks?.Stop),
    },
    servers: Object.fromEntries(Object.entries(merged.servers ?? {}).map(([url, pins]) => [url.replace(/\/+$/, ""), pins])),
    agents,
    permission_timeout_ms: merged.permission_timeout_ms ?? 300_000,
    subagent: { max_depth: merged.subagent?.max_depth ?? 2, max_concurrent: merged.subagent?.max_concurrent ?? 4 },
    thinking: args.thinking,
    showThinking: !args.noThinking,
    appendSystemPrompt: args.appendSystemPrompt,
    maxTurns: args.maxTurns,
  }
}

/** Reads one config layer; missing file = empty layer. Relative instruction paths resolve against `base`. */
export async function readConfig(file: string, base: string): Promise<Info> {
  const raw = await readJson(file)
  if (raw === undefined) return {}
  const info = decode(Info, raw, file)
  return info.instructions ? { ...info, instructions: info.instructions.map((item) => resolvePath(base, item)) } : info
}

async function readMcpConfig(value: string, cwd: string) {
  const inline = value.trimStart().startsWith("{")
  const file = inline ? "--mcp-config" : resolvePath(cwd, value)
  if (!inline && !existsSync(file)) throw new ConfigError({ message: `--mcp-config: ${file} does not exist` })
  const raw = inline ? await parseJson(await substitute({ type: "virtual", source: file, dir: cwd, text: value }), file) : await readJson(file)
  const parsed = decode(McpFile, raw, file)
  const claude = Object.entries(parsed.mcpServers ?? {}).map(([name, server]) => {
    const remote = server.url !== undefined && server.type !== "stdio"
    return [
      name,
      remote
        ? { type: "remote", url: server.url, headers: server.headers }
        : { type: "local", command: [server.command, ...(server.args ?? [])], environment: server.env },
    ]
  })
  return decode(Schema.Record(Schema.String, ConfigMCPV1.Info), { ...parsed.mcp, ...Object.fromEntries(claude) }, file)
}

async function readJson(file: string) {
  if (!existsSync(file)) return undefined
  const text = await Bun.file(file).text()
  const substituted = await substitute({ type: "path", path: file, text }).catch((error) => {
    throw new ConfigError({ message: `${file}: ${error?.data?.message ?? String(error)}` })
  })
  return parseJson(substituted, file)
}

// JSONC so comments and trailing commas copied from opencode.jsonc keep working.
export function parseJson(text: string, file: string) {
  return Promise.try(() => Bun.JSONC.parse(text)).catch((error) => {
    throw new ConfigError({ message: `${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})` })
  })
}

function mergeLayer(base: Info, next: Info): Info {
  return {
    ...mergeDeep(base, next),
    // MCP entries replace per server so a local entry never picks up a remote entry's fields.
    mcp: base.mcp || next.mcp ? { ...base.mcp, ...next.mcp } : undefined,
    instructions: [...(base.instructions ?? []), ...(next.instructions ?? [])],
  }
}

function hooks(list: ReadonlyArray<typeof Hook.Type> | undefined): HookEntry[] {
  return (list ?? []).flatMap((hook) => {
    const matcher = hook.matcher || "*"
    if (hook.hooks)
      return hook.hooks.flatMap((item) => {
        // Claude also has non-shell hook types (e.g. prompt); oclite only runs commands.
        if (item.type !== "command") {
          console.error(`oclite: notice: skipping hook of type "${item.type ?? "(none)"}" (only "command" hooks run)`)
          return []
        }
        const timeout_ms = item.timeout === undefined ? HOOK_TIMEOUT_MS : item.timeout * 1000
        return [{ matcher, command: item.command, timeout_ms }]
      })
    if (!hook.command) return []
    return [{ matcher, command: hook.command, timeout_ms: hook.timeout ?? HOOK_TIMEOUT_MS }]
  })
}

/** `--allowed-tools "read,bash(git *),Bash(npm test:*),mcp__github__*"` → rules. Claude's `:*` suffix = prefix match. */
export function cliRules(values: readonly string[], action: PermissionV1.Action): PermissionV1.Rule[] {
  return values
    .flatMap((value) => value.match(/[^\s,()]+(?:\([^)]*\))?/g) ?? [])
    .map((token) => {
      const open = token.indexOf("(")
      const tool = open === -1 ? token : token.slice(0, open)
      const pattern = open === -1 ? "*" : token.slice(open + 1, -1).replace(/:\*$/, "*")
      return { permission: claudeTool(tool), pattern: pattern || "*", action }
    })
}

function registerSecrets(cfg: Info) {
  Object.values(cfg.provider ?? {}).forEach((provider) => {
    if (provider.options?.apiKey) registerSecret(provider.options.apiKey)
    urlSecrets(provider.options?.baseURL ?? "").forEach(registerSecret)
    Object.values(provider.options?.headers ?? {}).forEach(registerSecret)
  })
  Object.values(cfg.mcp ?? {}).forEach((server) => {
    if (server.type === "remote") {
      Object.values(server.headers ?? {}).forEach(registerSecret)
      urlSecrets(server.url).forEach(registerSecret)
      if (server.oauth && server.oauth.clientSecret) registerSecret(server.oauth.clientSecret)
      return
    }
    argSecrets(server.command).forEach(registerSecret)
    Object.entries(server.environment ?? {})
      .filter((entry) => /key|token|secret|password|auth|credential/i.test(entry[0]))
      .forEach((entry) => registerSecret(entry[1]))
  })
}

function resolvePath(base: string, value: string) {
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2))
  return path.resolve(base, value)
}
