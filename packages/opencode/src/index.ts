import * as Log from "@opencode-ai/core/util/log"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { NamedError } from "@opencode-ai/core/util/error"
import { FormatError } from "./cli/error"
import { Filesystem } from "@/util/filesystem"
import { EOL } from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { errorMessage } from "./util/error"
import { Heap } from "./cli/heap"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"
import { isRecord } from "@/util/record"
import "./performance"
import type { Argv } from "yargs"

const processMetadata = ensureProcessMetadata("main")
const startupClock = globalThis as { __galStarted?: bigint }
if (!startupClock.__galStarted) {
  startupClock.__galStarted = process.hrtime.bigint()
}

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: errorMessage(e),
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: errorMessage(e),
  })
})

const args = process.argv.slice(2)

const commandImporters = {
  acp: async () => (await import("./cli/cmd/acp")).AcpCommand,
  mcp: async () => (await import("./cli/cmd/mcp")).McpCommand,
  attach: async () => (await import("./cli/cmd/tui/attach")).AttachCommand,
  run: async () => (await import("./cli/cmd/run")).RunCommand,
  generate: async () => (await import("./cli/cmd/generate")).GenerateCommand,
  debug: async () => (await import("./cli/cmd/debug")).DebugCommand,
  console: async () => (await import("./cli/cmd/account")).ConsoleCommand,
  providers: async () => (await import("./cli/cmd/providers")).ProvidersCommand,
  agent: async () => (await import("./cli/cmd/agent")).AgentCommand,
  upgrade: async () => (await import("./cli/cmd/upgrade")).UpgradeCommand,
  uninstall: async () => (await import("./cli/cmd/uninstall")).UninstallCommand,
  serve: async () => (await import("./cli/cmd/serve")).ServeCommand,
  web: async () => (await import("./cli/cmd/web")).WebCommand,
  models: async () => (await import("./cli/cmd/models")).ModelsCommand,
  stats: async () => (await import("./cli/cmd/stats")).StatsCommand,
  export: async () => (await import("./cli/cmd/export")).ExportCommand,
  import: async () => (await import("./cli/cmd/import")).ImportCommand,
  github: async () => (await import("./cli/cmd/github")).GithubCommand,
  pr: async () => (await import("./cli/cmd/pr")).PrCommand,
  session: async () => (await import("./cli/cmd/session")).SessionCommand,
  plugin: async () => (await import("./cli/cmd/plug")).PluginCommand,
  db: async () => (await import("./cli/cmd/db")).DbCommand,
}
type CommandName = keyof typeof commandImporters

function isCommandName(value: string): value is CommandName {
  return value in commandImporters
}

async function defaultCommand() {
  return (await import("./cli/cmd/tui/thread")).TuiThreadCommand
}

async function registerCommands(
  cli: Argv,
  args: string[],
): Promise<Argv> {
  if (args.includes("-h") || args.includes("--help") || args.includes("completion")) {
    const commands = await Promise.all([defaultCommand(), ...Object.values(commandImporters).map((load) => load())])
    for (const command of commands) {
      cli.command(command as never)
    }
    return cli
  }

  const command = args.find((arg) => arg !== "--" && !arg.startsWith("-"))
  const loader = command && isCommandName(command) ? commandImporters[command] : undefined
  cli.command((loader ? await loader() : await defaultCommand()) as never)
  return cli
}

async function setup(opts: { pure?: boolean; logLevel?: string }) {
  if (opts.pure) {
    process.env.OPENCODE_PURE = "1"
  }

  await Log.init({
    print: process.argv.includes("--print-logs"),
    dev: Installation.isLocal(),
    level: (() => {
      if (opts.logLevel) return opts.logLevel as Log.Level
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
  if (await Filesystem.exists(marker)) return

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
          return
        }
        process.stderr.write(`sqlite-migration:${percent}${EOL}`)
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

async function runFastPath() {
  await setup({})
  const { TuiThreadCommand } = await import("./cli/cmd/tui/thread")
  const handler = TuiThreadCommand.handler
  if (!handler) return
  await handler({
    _: [],
    $0: "opencode",
    project: undefined,
    model: undefined,
    continue: undefined,
    session: undefined,
    fork: undefined,
    prompt: undefined,
    agent: undefined,
    port: 0,
    hostname: "127.0.0.1",
    mdns: false,
    "mdns-domain": "opencode.local",
    mdnsDomain: "opencode.local",
    cors: [],
  } as never)
}

async function runSlowPath() {
  const [{ default: yargs }, { hideBin }] = await Promise.all([import("yargs"), import("yargs/helpers")])
  const cli = yargs(hideBin(process.argv))
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
      await setup({
        pure: opts.pure,
        logLevel: opts.logLevel,
      })
    })
    .usage("")
    .completion("completion", "generate shell completion script")
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

  await registerCommands(cli, args)
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
    return
  }
  await cli.parse()
}

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text)
    return
  }
  process.stderr.write(out)
}

try {
  if (args.length === 0) {
    await runFastPath()
  } else {
    await runSlowPath()
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
  Log.Default.error("fatal", data)
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
