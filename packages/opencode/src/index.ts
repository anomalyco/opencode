import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "./util/log"
import { AuthCommand } from "./cli/cmd/auth"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { ModelsCommand } from "./cli/cmd/models"
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
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { CompletionCommand } from "./cli/cmd/completion"
import { SetupCommand } from "./cli/cmd/setup"
import { AliasCommand } from "./cli/cmd/alias"
import { PluginsCommand } from "./cli/cmd/plugins"
import { OpenRouterCommand } from "./cli/cmd/openrouter"

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
  .scriptName("opencode")
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
    process.env.OPENCODE = "1"

    Log.Default.info("opencode", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })
  })
  .usage("\n" + UI.logo())
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(TuiSpawnCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(AuthCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(CompletionCommand)
  .command(SetupCommand)
  .command(AliasCommand)
  .command(PluginsCommand)
  .command(OpenRouterCommand)
  .fail((msg) => {
    // Enhanced error handling with suggestions
    if (msg.startsWith("Unknown command:")) {
      const unknownCmd = msg.split(":")[1]?.trim()
      if (unknownCmd) {
        const { Suggestions } = require("./cli/suggestions")
        const { RichUI } = require("./cli/rich-ui")

        UI.println()
        UI.error(`Unknown command: '${unknownCmd}'`)
        UI.println()

        // Check for common typo
        const typoCorrection = Suggestions.checkCommonTypo(unknownCmd)
        if (typoCorrection) {
          UI.println(UI.Style.TEXT_INFO_BOLD + RichUI.Icons.info + " " + UI.Style.TEXT_NORMAL + `Did you mean '${UI.Style.TEXT_HIGHLIGHT}${typoCorrection}${UI.Style.TEXT_NORMAL}'?`)
          UI.println()
          UI.println("Run: " + UI.Style.TEXT_HIGHLIGHT + `opencode ${typoCorrection} --help` + UI.Style.TEXT_NORMAL)
        } else {
          // Find similar commands
          const similar = Suggestions.findSimilarCommands(unknownCmd)
          if (similar.length > 0) {
            UI.println(UI.Style.TEXT_INFO + "Did you mean one of these?" + UI.Style.TEXT_NORMAL)
            similar.forEach((cmd) => {
              UI.println("  " + UI.Style.TEXT_HIGHLIGHT + "opencode " + cmd + UI.Style.TEXT_NORMAL)
            })
          }
        }

        // Check if trying to use another CLI tool
        const otherCli = Suggestions.detectOtherCli(unknownCmd)
        if (otherCli) {
          UI.println()
          UI.println(UI.Style.TEXT_WARNING + RichUI.Icons.warning + " " + UI.Style.TEXT_NORMAL + otherCli)
        }

        UI.println()
        UI.println("Run " + UI.Style.TEXT_HIGHLIGHT + "opencode --help" + UI.Style.TEXT_NORMAL + " to see all available commands")
        UI.println()
      }
    } else if (
      msg.startsWith("Unknown argument") ||
      msg.startsWith("Not enough non-option arguments") ||
      msg.startsWith("Invalid values:")
    ) {
      cli.showHelp("log")
    } else {
      UI.error(msg)
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
