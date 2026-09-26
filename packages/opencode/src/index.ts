import yargs, { type Argv, type CommandModule } from "yargs"
import { hideBin } from "yargs/helpers"
import { TuiThreadCommand } from "./cli/cmd/tui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { EOL } from "os"
import { errorMessage } from "./util/error"
import { logo } from "./cli/logo-render"

const args = hideBin(process.argv)

// Lazy command registration: only `command`/`describe`/`aliases` are needed
// synchronously for parsing and top-level help. The implementation (builder +
// handler) is dynamically imported on dispatch, so `--version`/`--help` never
// evaluate the full command graph.
function lazyCommand(input: {
  command: string | readonly string[]
  describe?: string | false
  aliases?: string | readonly string[]
  load: () => Promise<unknown>
}): CommandModule {
  return {
    command: input.command,
    describe: input.describe,
    aliases: input.aliases,
    builder: async (y: Argv) => {
      const mod = (await input.load()) as {
        builder?: ((argv: Argv) => Argv | Promise<Argv>) | Record<string, object>
      }
      if (typeof mod.builder === "function") return mod.builder(y)
      if (mod.builder) return y.options(mod.builder as never)
      return y
    },
    handler: async (argv) => {
      const mod = (await input.load()) as { handler?: (args: never) => unknown }
      await mod.handler?.(argv as never)
    },
  }
}

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("opencode")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.printLogs) process.env.OPENCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.OPENCODE_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.OPENCODE_PURE = "1"
    }

    // Heap pulls in Flag/Global (effect). Only load it when snapshots are
    // enabled; the env check mirrors Flag.OPENCODE_AUTO_HEAP_SNAPSHOT.
    const snapshot = process.env.OPENCODE_AUTO_HEAP_SNAPSHOT?.toLowerCase()
    if (snapshot === "true" || snapshot === "1") {
      const { Heap } = await import("./cli/heap")
      Heap.start()
    }

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(
    lazyCommand({
      command: "acp",
      describe: "start ACP (Agent Client Protocol) server",
      load: () => import("./cli/cmd/acp").then((mod) => mod.AcpCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "mcp",
      describe: "manage MCP (Model Context Protocol) servers",
      load: () => import("./cli/cmd/mcp").then((mod) => mod.McpCommand),
    }),
  )
  .command(TuiThreadCommand)
  .command(
    lazyCommand({
      command: "attach <url>",
      describe: "attach to a running opencode server",
      load: () => import("./cli/cmd/attach").then((mod) => mod.AttachCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "run [message..]",
      describe: "run opencode with a message",
      load: () => import("./cli/cmd/run").then((mod) => mod.RunCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "generate",
      load: () => import("./cli/cmd/generate").then((mod) => mod.GenerateCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "debug",
      describe: "debugging and troubleshooting tools",
      load: () => import("./cli/cmd/debug").then((mod) => mod.DebugCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "console",
      describe: false,
      load: () => import("./cli/cmd/account").then((mod) => mod.ConsoleCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "providers",
      aliases: ["auth"],
      describe: "manage AI providers and credentials",
      load: () => import("./cli/cmd/providers").then((mod) => mod.ProvidersCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "agent",
      describe: "manage agents",
      load: () => import("./cli/cmd/agent").then((mod) => mod.AgentCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "upgrade [target]",
      describe: "upgrade opencode to the latest or a specific version",
      load: () => import("./cli/cmd/upgrade").then((mod) => mod.UpgradeCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "uninstall",
      describe: "uninstall opencode and remove all related files",
      load: () => import("./cli/cmd/uninstall").then((mod) => mod.UninstallCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "serve",
      describe: "starts a headless opencode server",
      load: () => import("./cli/cmd/serve").then((mod) => mod.ServeCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "web",
      describe: "start opencode server and open web interface",
      load: () => import("./cli/cmd/web").then((mod) => mod.WebCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "models [provider]",
      describe: "list all available models",
      load: () => import("./cli/cmd/models").then((mod) => mod.ModelsCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "stats",
      describe: "show token usage and cost statistics",
      load: () => import("./cli/cmd/stats").then((mod) => mod.StatsCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "export [sessionID]",
      describe: "export session data as JSON",
      load: () => import("./cli/cmd/export").then((mod) => mod.ExportCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "import <file>",
      describe: "import session data from JSON file or URL",
      load: () => import("./cli/cmd/import").then((mod) => mod.ImportCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "github",
      describe: "manage GitHub agent",
      load: () => import("./cli/cmd/github").then((mod) => mod.GithubCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "pr <number>",
      describe: "fetch and checkout a GitHub PR branch, then run opencode",
      load: () => import("./cli/cmd/pr").then((mod) => mod.PrCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "session",
      describe: "manage sessions",
      load: () => import("./cli/cmd/session").then((mod) => mod.SessionCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "plugin <module>",
      aliases: ["plug"],
      describe: "install plugin and update config",
      load: () => import("./cli/cmd/plug").then((mod) => mod.PluginCommand),
    }),
  )
  .command(
    lazyCommand({
      command: "db",
      describe: "database tools",
      load: () => import("./cli/cmd/db").then((mod) => mod.DbCommand),
    }),
  )
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const { FormatError } = await import("./cli/error")
  const { UI } = await import("./cli/ui")
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
