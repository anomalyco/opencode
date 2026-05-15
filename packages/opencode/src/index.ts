import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Filesystem } from "@/util/filesystem"
import { EOL } from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { errorMessage } from "./util/error"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"
import { isRecord } from "@/util/record"
import { lazy } from "./cli/lazy"
import { TuiThreadSpec } from "./cli/cmd/tui/thread-spec"

// Heavy modules — deferred so parser-only paths (`--help`, `--version`,
// completion) and commands whose handlers don't need them skip their
// import-time bootstrap.
const loadLog = () => import("@opencode-ai/core/util/log")
const loadInstallation = () => import("./installation").then((m) => m.Installation)
const loadHeap = () => import("./cli/heap").then((m) => m.Heap)
const loadNamedError = () => import("@opencode-ai/core/util/error").then((m) => m.NamedError)
const loadFormatError = () => import("./cli/error").then((m) => m.FormatError)

const processMetadata = ensureProcessMetadata("main")

process.on("unhandledRejection", async (e) => {
  const Log = await loadLog()
  Log.Default.error("rejection", {
    e: errorMessage(e),
  })
})

process.on("uncaughtException", async (e) => {
  const Log = await loadLog()
  Log.Default.error("exception", {
    e: errorMessage(e),
  })
})

const args = hideBin(process.argv)

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text)
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
    if (opts.pure) {
      process.env.OPENCODE_PURE = "1"
    }

    const [Log, Installation, Heap] = await Promise.all([loadLog(), loadInstallation(), loadHeap()])

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel === "DEBUG" || opts.logLevel === "INFO" || opts.logLevel === "WARN" || opts.logLevel === "ERROR") {
          return opts.logLevel
        }
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)

    Log.Default.info("opencode", {
      version: InstallationVersion,
      args: process.argv.slice(2),
      process_role: processMetadata.processRole,
      run_id: processMetadata.runID,
    })

    const marker = path.join(Global.Path.data, "opencode.db")
    if (!(await Filesystem.exists(marker))) {
      const tty = process.stderr.isTTY
      process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
      const width = 36
      const orange = "\x1b[38;5;214m"
      const muted = "\x1b[0;2m"
      const reset = "\x1b[0m"
      let last = -1
      if (tty) process.stderr.write("\x1b[?25l")
      try {
        const [{ JsonMigration }, { Database }, { drizzle }] = await Promise.all([
          import("@/storage/json-migration"),
          import("@/storage/db"),
          import("drizzle-orm/bun-sqlite"),
        ])
        await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
          progress: (event) => {
            const percent = Math.floor((event.current / event.total) * 100)
            if (percent === last && event.current !== event.total) return
            last = percent
            if (tty) {
              const fill = Math.round((percent / 100) * width)
              const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
              process.stderr.write(
                `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
              )
              if (event.current === event.total) process.stderr.write("\n")
            } else {
              process.stderr.write(`sqlite-migration:${percent}${EOL}`)
            }
          },
        })
      } finally {
        if (tty) process.stderr.write("\x1b[?25h")
        else {
          process.stderr.write(`sqlite-migration:done${EOL}`)
        }
      }
      process.stderr.write("Database migration complete." + EOL)
    }
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(lazy({ command: "acp", describe: "start ACP (Agent Client Protocol) server" }, () => import("./cli/cmd/acp").then((m) => m.AcpCommand)))
  .command(lazy({ command: "mcp", describe: "manage MCP (Model Context Protocol) servers" }, () => import("./cli/cmd/mcp").then((m) => m.McpCommand)))
  .command(
    // Default ($0) command — yargs renders its option spec inline in
    // top-level `--help`, so the spec must be resolvable synchronously.
    // `TuiThreadSpec` is the single source of truth (also consumed by
    // `cli/cmd/tui/thread.ts`); the handler still defers loading the
    // implementation module.
    TuiThreadSpec.command,
    TuiThreadSpec.describe,
    TuiThreadSpec.builder,
    async (args) => {
      const { TuiThreadCommand } = await import("./cli/cmd/tui/thread")
      await TuiThreadCommand.handler(args as Parameters<typeof TuiThreadCommand.handler>[0])
    },
  )
  .command(lazy({ command: "attach <url>", describe: "attach to a running opencode server" }, () => import("./cli/cmd/tui/attach").then((m) => m.AttachCommand)))
  .command(lazy({ command: "run [message..]", describe: "run opencode with a message" }, () => import("./cli/cmd/run").then((m) => m.RunCommand)))
  .command(lazy({ command: "generate" }, () => import("./cli/cmd/generate").then((m) => m.GenerateCommand)))
  .command(lazy({ command: "debug", describe: "debugging and troubleshooting tools" }, () => import("./cli/cmd/debug").then((m) => m.DebugCommand)))
  .command(lazy({ command: "console", describe: false }, () => import("./cli/cmd/account").then((m) => m.ConsoleCommand)))
  .command(lazy({ command: "providers", aliases: ["auth"], describe: "manage AI providers and credentials" }, () => import("./cli/cmd/providers").then((m) => m.ProvidersCommand)))
  .command(lazy({ command: "agent", describe: "manage agents" }, () => import("./cli/cmd/agent").then((m) => m.AgentCommand)))
  .command(lazy({ command: "upgrade [target]", describe: "upgrade opencode to the latest or a specific version" }, () => import("./cli/cmd/upgrade").then((m) => m.UpgradeCommand)))
  .command(lazy({ command: "uninstall", describe: "uninstall opencode and remove all related files" }, () => import("./cli/cmd/uninstall").then((m) => m.UninstallCommand)))
  .command(lazy({ command: "serve", describe: "starts a headless opencode server" }, () => import("./cli/cmd/serve").then((m) => m.ServeCommand)))
  .command(lazy({ command: "web", describe: "start opencode server and open web interface" }, () => import("./cli/cmd/web").then((m) => m.WebCommand)))
  .command(lazy({ command: "models [provider]", describe: "list all available models" }, () => import("./cli/cmd/models").then((m) => m.ModelsCommand)))
  .command(lazy({ command: "stats", describe: "show token usage and cost statistics" }, () => import("./cli/cmd/stats").then((m) => m.StatsCommand)))
  .command(lazy({ command: "export [sessionID]", describe: "export session data as JSON" }, () => import("./cli/cmd/export").then((m) => m.ExportCommand)))
  .command(lazy({ command: "import <file>", describe: "import session data from JSON file or URL" }, () => import("./cli/cmd/import").then((m) => m.ImportCommand)))
  .command(lazy({ command: "github", describe: "manage GitHub agent" }, () => import("./cli/cmd/github").then((m) => m.GithubCommand)))
  .command(lazy({ command: "pr <number>", describe: "fetch and checkout a GitHub PR branch, then run opencode" }, () => import("./cli/cmd/pr").then((m) => m.PrCommand)))
  .command(lazy({ command: "session", describe: "manage sessions" }, () => import("./cli/cmd/session").then((m) => m.SessionCommand)))
  .command(lazy({ command: "plugin <module>", aliases: ["plug"], describe: "install plugin and update config" }, () => import("./cli/cmd/plug").then((m) => m.PluginCommand)))
  .command(lazy({ command: "db", describe: "database tools" }, () => import("./cli/cmd/db").then((m) => m.DbCommand)))
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
  let data: Record<string, any> = {}
  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  const NamedError = await loadNamedError()
  if (e instanceof NamedError) {
    const obj = e.toObject()
    if (isRecord(obj.data)) {
      for (const [key, value] of Object.entries(obj.data)) {
        if (key === "name" || key === "stack" || key === "cause") continue
        data[key] = value
      }
    }
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
  const Log = await loadLog()
  Log.Default.error("fatal", data)
  const FormatError = await loadFormatError()
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
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
