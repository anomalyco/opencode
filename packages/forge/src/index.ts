import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "./util/log"
import { AuthCommand } from "./cli/cmd/auth"
import { AgentCommand } from "./cli/cmd/agent"
import { AgentsCommand } from "./cli/cmd/agents"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { ModelsCommand } from "./cli/cmd/models"
import { ModesCommand } from "./cli/cmd/modes"
import { CheckCommand } from "./cli/cmd/check"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { NamedError } from "./util/error"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/tui/attach"
import { TuiThreadCommand } from "./cli/cmd/tui/thread"
import { TuiSpawnCommand } from "./cli/cmd/tui/spawn"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { InstallAgentCommand } from "./cli/cmd/install"
import { UninstallAgentCommand } from "./cli/cmd/uninstall"

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

const cli = yargs(hideBin(process.argv))
  // Prevent array options (e.g., --agent) from greedily consuming positionals
  .parserConfiguration({ "greedy-arrays": false })
  .scriptName("forge")
  // Disable wrapping so help lines don't break
  .wrap(null)
  .option("agent", {
    describe: 'agent spec: --agent claude or --agent "name=claude model=opus mode=bypassPermissions"',
    alias: "a",
    type: "string",
  })
  .option("plan-agent", {
    describe: 'plan agent spec: --plan-agent claude or --plan-agent "name=claude model=opus"',
    type: "string",
  })
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
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
  .middleware(async (opts) => {
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    process.env.AGENT = "1"
    process.env.FORGE = "1"

    Log.Default.info("forge", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })
  })
  .usage("\n" + UI.logo())
  .command(TuiThreadCommand)
  .command(InstallAgentCommand)
  .command(UninstallAgentCommand)
  .command(AgentsCommand)
  .command(CheckCommand)
  .command(ModelsCommand)
  .command(ModesCommand)
  .command(AttachCommand)
  .command(DebugCommand)
  .command(GenerateCommand)
  .command(McpCommand)
  .command(ServeCommand)
  .command(TuiSpawnCommand)
  .command(StatsCommand)
  .command(UpgradeCommand)
  .command(WebCommand)
  // .command(ExportCommand)
  // .command(ImportCommand)
  // .command(GithubCommand)
  // .command(PrCommand)
  .fail((msg) => {
    if (
      msg.startsWith("Unknown argument") ||
      msg.startsWith("Not enough non-option arguments") ||
      msg.startsWith("Invalid values:")
    ) {
      cli.showHelp("log")
    }
    process.exit(1)
  })
  .strict()

try {
  await cli.parse()
} catch (e) {
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    console.error(e)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
