import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { FormatError } from "./cli/error"
import { EOL } from "os"
import { errorMessage } from "./util/error"

const args = hideBin(process.argv)
const commandArgs = args.slice(0, args.indexOf("--") === -1 ? args.length : args.indexOf("--"))

const commandLoaders = {
  acp: async () => {
    const { AcpCommand } = await import("./cli/cmd/acp")
    return AcpCommand
  },
  mcp: async () => {
    const { McpCommand } = await import("./cli/cmd/mcp")
    return McpCommand
  },
  attach: async () => {
    const { AttachCommand } = await import("./cli/cmd/attach")
    return AttachCommand
  },
  run: async () => {
    const { RunCommand } = await import("./cli/cmd/run")
    return RunCommand
  },
  generate: async () => {
    const { GenerateCommand } = await import("./cli/cmd/generate")
    return GenerateCommand
  },
  debug: async () => {
    const { DebugCommand } = await import("./cli/cmd/debug")
    return DebugCommand
  },
  console: async () => {
    const { ConsoleCommand } = await import("./cli/cmd/account")
    return ConsoleCommand
  },
  providers: async () => {
    const { ProvidersCommand } = await import("./cli/cmd/providers")
    return ProvidersCommand
  },
  agent: async () => {
    const { AgentCommand } = await import("./cli/cmd/agent")
    return AgentCommand
  },
  upgrade: async () => {
    const { UpgradeCommand } = await import("./cli/cmd/upgrade")
    return UpgradeCommand
  },
  uninstall: async () => {
    const { UninstallCommand } = await import("./cli/cmd/uninstall")
    return UninstallCommand
  },
  serve: async () => {
    const { ServeCommand } = await import("./cli/cmd/serve")
    return ServeCommand
  },
  web: async () => {
    const { WebCommand } = await import("./cli/cmd/web")
    return WebCommand
  },
  models: async () => {
    const { ModelsCommand } = await import("./cli/cmd/models")
    return ModelsCommand
  },
  stats: async () => {
    const { StatsCommand } = await import("./cli/cmd/stats")
    return StatsCommand
  },
  export: async () => {
    const { ExportCommand } = await import("./cli/cmd/export")
    return ExportCommand
  },
  import: async () => {
    const { ImportCommand } = await import("./cli/cmd/import")
    return ImportCommand
  },
  github: async () => {
    const { GithubCommand } = await import("./cli/cmd/github")
    return GithubCommand
  },
  pr: async () => {
    const { PrCommand } = await import("./cli/cmd/pr")
    return PrCommand
  },
  session: async () => {
    const { SessionCommand } = await import("./cli/cmd/session")
    return SessionCommand
  },
  plugin: async () => {
    const { PluginCommand } = await import("./cli/cmd/plug")
    return PluginCommand
  },
  db: async () => {
    const { DbCommand } = await import("./cli/cmd/db")
    return DbCommand
  },
}

const defaultCommandLoader = async () => {
  const { TuiThreadCommand } = await import("./cli/cmd/tui")
  return TuiThreadCommand
}

const commandOrder = [
  commandLoaders.acp,
  commandLoaders.mcp,
  defaultCommandLoader,
  commandLoaders.attach,
  commandLoaders.run,
  commandLoaders.generate,
  commandLoaders.debug,
  commandLoaders.console,
  commandLoaders.providers,
  commandLoaders.agent,
  commandLoaders.upgrade,
  commandLoaders.uninstall,
  commandLoaders.serve,
  commandLoaders.web,
  commandLoaders.models,
  commandLoaders.stats,
  commandLoaders.export,
  commandLoaders.import,
  commandLoaders.github,
  commandLoaders.pr,
  commandLoaders.session,
  commandLoaders.plugin,
  commandLoaders.db,
]

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

function commandToken() {
  for (let i = 0; i < commandArgs.length; i++) {
    const arg = commandArgs[i]
    if (arg === "--log-level") {
      i++
      continue
    }
    if (arg.startsWith("--log-level=")) continue
    if (arg.startsWith("-")) continue
    return arg
  }
}

async function selectedCommands() {
  const token = commandToken()
  if (
    token === "completion" ||
    token === "help" ||
    (!token && commandArgs.some((arg) => arg === "-h" || arg === "--help"))
  ) {
    return Promise.all(commandOrder.map((load) => load()))
  }

  const name = token === "auth" ? "providers" : token === "plug" ? "plugin" : token
  if (name && Object.hasOwn(commandLoaders, name)) {
    return [await commandLoaders[name as keyof typeof commandLoaders]()]
  }

  if (commandArgs.some((arg) => arg === "-v" || arg === "--version")) return []
  return [await defaultCommandLoader()]
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

    const { Heap } = await import("./cli/heap")
    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")

for (const command of await selectedCommands()) {
  cli.command(command)
}

cli
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
