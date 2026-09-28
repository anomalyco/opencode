import { Context, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import type { ConfigError, OutputFormat, PermissionMode, ProfileName, Thinking } from "../contract"

// The full SPEC §1 surface. Handlers load their module lazily so `--help` and `agents list` stay off the heavy
// import graph. Commands whose runtime lands in a later phase point at `notImplemented` until then.

export interface CliArgs {
  print?: string
  outputFormat: OutputFormat
  agent?: string
  model?: string
  profile?: ProfileName
  mcpConfig: string[]
  strictMcpConfig: boolean
  allowedTools: string[]
  disallowedTools: string[]
  permissionMode?: PermissionMode
  maxTurns?: number
  continue: boolean
  resume?: string
  appendSystemPrompt?: string
  thinking?: Thinking
  noThinking: boolean
  // command-specific flags, set only by the command that declares them
  transport?: "stdio" | "http"
  port?: number
  host?: string
  iUnderstandRemoteBypass?: boolean
  tokens?: boolean
  check?: boolean
  reprobe?: boolean
}

// Operands after `--` (e.g. `mcp add fs -- npx -y server`). effect/unstable/cli hands them to the root command
// instead of the selected subcommand, so index.ts splits them off and provides them here.
export class Operands extends Context.Service<Operands, readonly string[]>()("oclite/Operands") {}

export function splitOperands(argv: readonly string[]) {
  const end = argv.indexOf("--")
  if (end === -1) return { argv, operands: [] }
  return { argv: argv.slice(0, end), operands: argv.slice(end + 1) }
}

export const shared = {
  print: Flag.string("print").pipe(
    Flag.withAlias("p"),
    Flag.withDescription("Run one prompt non-interactively and exit"),
    Flag.optional,
  ),
  outputFormat: Flag.choice("output-format", ["text", "json", "stream-json"]).pipe(Flag.withDefault("text")),
  agent: Flag.string("agent").pipe(Flag.withDescription("Agent to run (default: build)"), Flag.optional),
  model: Flag.string("model").pipe(Flag.withDescription("Model as provider/model"), Flag.optional),
  profile: Flag.choice("profile", ["default", "local", "local-min"]).pipe(Flag.optional),
  mcpConfig: Flag.string("mcp-config").pipe(
    Flag.withDescription("MCP config file or JSON ({mcp} or Claude {mcpServers}); repeatable"),
    Flag.atMost(64),
  ),
  strictMcpConfig: Flag.boolean("strict-mcp-config").pipe(
    Flag.withDescription("Only use MCP servers from --mcp-config"),
  ),
  allowedTools: Flag.string("allowed-tools").pipe(
    Flag.withDescription('Allow rules, e.g. "read,bash(git *),mcp__github__*"'),
    Flag.atMost(64),
  ),
  disallowedTools: Flag.string("disallowed-tools").pipe(Flag.withDescription("Deny rules"), Flag.atMost(64)),
  permissionMode: Flag.choice("permission-mode", ["default", "acceptEdits", "plan", "bypassPermissions"]).pipe(
    Flag.optional,
  ),
  maxTurns: Flag.integer("max-turns").pipe(Flag.optional),
  continue: Flag.boolean("continue").pipe(Flag.withAlias("c"), Flag.withDescription("Continue the latest session")),
  resume: Flag.string("resume").pipe(Flag.withAlias("r"), Flag.withDescription("Resume a session id"), Flag.optional),
  appendSystemPrompt: Flag.string("append-system-prompt").pipe(Flag.optional),
  thinking: Flag.choice("thinking", ["auto", "on", "off"]).pipe(Flag.optional),
  noThinking: Flag.boolean("no-thinking").pipe(Flag.withDescription("Hide reasoning output")),
}

const root = Command.make("oclite").pipe(
  Command.withDescription("Small, fast agent harness with MCP as the primary contract"),
  Command.withSharedFlags(shared),
)

type SharedInput = Command.Command.Config.Infer<typeof shared>
type Commands = typeof import("./commands")

export function toCliArgs(flags: SharedInput, extra: Partial<CliArgs> = {}): CliArgs {
  return {
    print: Option.getOrUndefined(flags.print),
    outputFormat: flags.outputFormat,
    agent: Option.getOrUndefined(flags.agent),
    model: Option.getOrUndefined(flags.model),
    profile: Option.getOrUndefined(flags.profile),
    mcpConfig: [...flags.mcpConfig],
    strictMcpConfig: flags.strictMcpConfig,
    allowedTools: [...flags.allowedTools],
    disallowedTools: [...flags.disallowedTools],
    permissionMode: Option.getOrUndefined(flags.permissionMode),
    maxTurns: Option.getOrUndefined(flags.maxTurns),
    continue: flags.continue,
    resume: Option.getOrUndefined(flags.resume),
    appendSystemPrompt: Option.getOrUndefined(flags.appendSystemPrompt),
    thinking: Option.getOrUndefined(flags.thinking),
    noThinking: flags.noThinking,
    ...extra,
  }
}

function handler<I>(pick: (module: Commands) => (args: CliArgs, input: I) => Effect.Effect<void, ConfigError>) {
  return (input: I) =>
    Effect.gen(function* () {
      const flags = yield* root
      const module = yield* Effect.promise(() => import("./commands"))
      yield* pick(module)(toCliArgs(flags), input)
    })
}

const name = Argument.string("name")
const scope = Flag.choice("scope", ["project", "user"]).pipe(
  Flag.withAlias("s"),
  Flag.withDescription("project: <root>/.oclite/config.json, user: ~/.config/oclite/config.json"),
)

const mcp = Command.make("mcp").pipe(
  Command.withDescription("Manage MCP servers, or serve oclite over MCP"),
  Command.withSubcommands([
    Command.make(
      "serve",
      {
        transport: Flag.choice("transport", ["stdio", "http"]).pipe(Flag.withDefault("stdio")),
        port: Flag.integer("port").pipe(Flag.withDefault(4096)),
        host: Flag.string("host").pipe(Flag.withDefault("127.0.0.1")),
        iUnderstandRemoteBypass: Flag.boolean("i-understand-remote-bypass"),
      },
      handler((module) => module.notImplemented("mcp serve", 6)),
    ).pipe(Command.withDescription("Expose oclite agents as an MCP server")),
    Command.make(
      "add",
      {
        name,
        target: Argument.string("commandOrUrl").pipe(
          Argument.withDescription("Command and args (after --) or server URL"),
          Argument.variadic(),
        ),
        transport: Flag.choice("transport", ["stdio", "http", "sse"]).pipe(Flag.withAlias("t"), Flag.optional),
        scope: scope.pipe(Flag.withDefault("project")),
        env: Flag.keyValuePair("env").pipe(Flag.withAlias("e"), Flag.withDescription("KEY=value"), Flag.optional),
        header: Flag.string("header").pipe(
          Flag.withAlias("H"),
          Flag.withDescription('"Name: value"'),
          Flag.atMost(64),
        ),
        timeout: Flag.integer("timeout").pipe(Flag.withDescription("Request timeout in ms"), Flag.optional),
      },
      (input) =>
        Effect.gen(function* () {
          const operands = yield* Operands
          yield* handler((module) => module.mcpAdd)({ ...input, target: [...input.target, ...operands] })
        }),
    ).pipe(Command.withDescription("Add an MCP server (opencode ConfigMCPV1 shape)")),
    Command.make("list", {}, handler((module) => module.mcpList)).pipe(
      Command.withDescription("List configured MCP servers"),
    ),
    Command.make("get", { name }, handler((module) => module.mcpGet)).pipe(
      Command.withDescription("Show one MCP server"),
    ),
    Command.make("remove", { name, scope: scope.pipe(Flag.optional) }, handler((module) => module.mcpRemove)).pipe(
      Command.withDescription("Remove an MCP server"),
    ),
    Command.make("auth", { name }, handler((module) => module.notImplemented("mcp auth", 4))).pipe(
      Command.withDescription("Run the OAuth flow for a remote MCP server"),
    ),
  ]),
)

const agents = Command.make("agents").pipe(
  Command.withDescription("Inspect loaded agents"),
  Command.withSubcommands([
    Command.make("list", {}, handler((module) => module.agentsList)).pipe(Command.withDescription("List agents")),
    Command.make("show", { name }, handler((module) => module.agentsShow)).pipe(
      Command.withDescription("Show one agent"),
    ),
  ]),
)

const debug = Command.make("debug").pipe(
  Command.withDescription("Prompt and server diagnostics"),
  Command.withSubcommands([
    Command.make(
      "prompt",
      { tokens: Flag.boolean("tokens"), check: Flag.boolean("check") },
      (input) =>
        Effect.gen(function* () {
          const flags = yield* root
          const { debugPrompt } = yield* Effect.promise(() => import("./debug"))
          yield* debugPrompt(toCliArgs(flags, input))
        }),
    ).pipe(Command.withDescription("Composed system prompt, tool sizes, server-reported tokens")),
    Command.make("server", { reprobe: Flag.boolean("reprobe") }, (input) =>
      Effect.gen(function* () {
        const flags = yield* root
        const { debugServer } = yield* Effect.promise(() => import("./debug"))
        yield* debugServer(toCliArgs(flags, input))
      }),
    ).pipe(
      Command.withDescription("Capability record for the current provider/model"),
    ),
  ]),
)

const id = Argument.string("id")
const session = Command.make("session").pipe(
  Command.withDescription("Inspect saved sessions"),
  Command.withSubcommands([
    Command.make("list", {}, handler((module) => module.sessionList)).pipe(Command.withDescription("List sessions for this directory")),
    Command.make("show", { id }, handler((module) => module.sessionShow)).pipe(Command.withDescription("Show a session transcript")),
    Command.make("export", { id }, handler((module) => module.sessionExport)).pipe(Command.withDescription("Print a session's JSONL records")),
  ]),
)

export const command = root.pipe(
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const args = toCliArgs(flags)
      if (args.print !== undefined) {
        const { runPrint } = yield* Effect.promise(() => import("./run"))
        return yield* runPrint(args)
      }
      const { runRepl } = yield* Effect.promise(() => import("./repl"))
      yield* runRepl(args)
    }),
  ),
  Command.withSubcommands([mcp, agents, debug, session]),
)
