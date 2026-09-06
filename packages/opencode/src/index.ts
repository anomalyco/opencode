import type { CommandModule } from "yargs"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { lazyCommand } from "./cli/lazy-command"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { EOL } from "os"
import { Heap } from "./cli/heap"

const lazy = (spec: {
  readonly command: string
  readonly aliases?: readonly string[]
  readonly describe?: string | false
  readonly load: () => Promise<Record<string, any>>
  readonly resolve: (mod: Record<string, any>) => CommandModule
}) => lazyCommand<object, never>({ ...spec, load: spec.load as never, resolve: spec.resolve as never })

const args = hideBin(process.argv)

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
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

    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(lazy({ command: "acp", describe: "start ACP (Agent Client Protocol) server", load: () => import("./cli/cmd/acp"), resolve: (m) => m.AcpCommand }))
  .command(lazy({ command: "mcp", describe: "manage MCP (Model Context Protocol) servers", load: () => import("./cli/cmd/mcp"), resolve: (m) => m.McpCommand }))
  .command(lazy({ command: "$0 [project]", describe: "start opencode tui", load: () => import("./cli/cmd/tui"), resolve: (m) => m.TuiThreadCommand }))
  .command(lazy({ command: "attach <url>", describe: "attach to a running opencode server", load: () => import("./cli/cmd/attach"), resolve: (m) => m.AttachCommand }))
  .command(lazy({ command: "run [message..]", describe: "run opencode with a message", load: () => import("./cli/cmd/run"), resolve: (m) => m.RunCommand }))
  .command(lazy({ command: "generate", load: () => import("./cli/cmd/generate"), resolve: (m) => m.GenerateCommand }))
  .command(lazy({ command: "debug", describe: "debugging and troubleshooting tools", load: () => import("./cli/cmd/debug"), resolve: (m) => m.DebugCommand }))
  .command(lazy({ command: "console", describe: false, load: () => import("./cli/cmd/account"), resolve: (m) => m.ConsoleCommand }))
  .command(lazy({ command: "providers", aliases: ["auth"], describe: "manage AI providers and credentials", load: () => import("./cli/cmd/providers"), resolve: (m) => m.ProvidersCommand }))
  .command(lazy({ command: "agent", describe: "manage agents", load: () => import("./cli/cmd/agent"), resolve: (m) => m.AgentCommand }))
  .command(lazy({ command: "upgrade [target]", describe: "upgrade opencode to the latest or a specific version", load: () => import("./cli/cmd/upgrade"), resolve: (m) => m.UpgradeCommand }))
  .command(lazy({ command: "uninstall", describe: "uninstall opencode and remove all related files", load: () => import("./cli/cmd/uninstall"), resolve: (m) => m.UninstallCommand }))
  .command(lazy({ command: "serve", describe: "starts a headless opencode server", load: () => import("./cli/cmd/serve"), resolve: (m) => m.ServeCommand }))
  .command(lazy({ command: "web", describe: "start opencode server and open web interface", load: () => import("./cli/cmd/web"), resolve: (m) => m.WebCommand }))
  .command(lazy({ command: "models [provider]", describe: "list all available models", load: () => import("./cli/cmd/models"), resolve: (m) => m.ModelsCommand }))
  .command(lazy({ command: "stats", describe: "show token usage and cost statistics", load: () => import("./cli/cmd/stats"), resolve: (m) => m.StatsCommand }))
  .command(lazy({ command: "export [sessionID]", describe: "export session data as JSON", load: () => import("./cli/cmd/export"), resolve: (m) => m.ExportCommand }))
  .command(lazy({ command: "import <file>", describe: "import session data from JSON file or URL", load: () => import("./cli/cmd/import"), resolve: (m) => m.ImportCommand }))
  .command(lazy({ command: "github", describe: "manage GitHub agent", load: () => import("./cli/cmd/github"), resolve: (m) => m.GithubCommand }))
  .command(lazy({ command: "pr <number>", describe: "fetch and checkout a GitHub PR branch, then run opencode", load: () => import("./cli/cmd/pr"), resolve: (m) => m.PrCommand }))
  .command(lazy({ command: "session", describe: "manage sessions", load: () => import("./cli/cmd/session"), resolve: (m) => m.SessionCommand }))
  .command(lazy({ command: "plugin <module>", aliases: ["plug"], describe: "install plugin and update config", load: () => import("./cli/cmd/plug"), resolve: (m) => m.PluginCommand }))
  .command(lazy({ command: "db", describe: "database tools", load: () => import("./cli/cmd/db"), resolve: (m) => m.DbCommand }))
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
    const helpText = await cli.getHelp()
    show(helpText)
  } else {
    await cli.parse()
  }
} catch (e) {
  const { FormatError } = await import("./cli/error")
  const { errorMessage } = await import("./util/error")
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
