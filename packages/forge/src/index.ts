import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "./util/log"
import { AuthCommand } from "./cli/cmd/auth"
import { AgentCommand } from "./cli/cmd/agent"
import { ListCommand } from "./cli/cmd/list"
import { UpgradeCommand } from "./cli/cmd/upgrade"
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
import { TuiSpawnCommand } from "./cli/cmd/tui/spawn"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { AgentRunCommand, commandHandled, runAgentManage, runDefaultTui, runWithAgent } from "./cli/cmd/agent-context"

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
  .help(false)
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("help", {
    describe: "show help",
    alias: "h",
    type: "boolean",
    global: true,
  })
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("project", {
    describe: "path to start forge in",
    type: "string",
    global: true,
  })
  .option("continue", {
    alias: ["c"],
    describe: "continue the last session",
    type: "boolean",
    global: true,
  })
  .option("session", {
    alias: ["s"],
    type: "string",
    describe: "session id to continue",
    global: true,
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
  .command(ListCommand)
  .command(AgentRunCommand)

cli
  .example("forge", "Start TUI")
  .example("forge claude install", "Install claude")
  .example('forge claude "Update my CLAUDE.md"', "Run claude with prompt")
  .example(
    'forge claude --model opus --mode bypassPermissions "Refactor the authentication module"',
    "Run with specific model/mode",
  )
  .example(
    'forge codex "Find all the TODO comments" --plan-agent claude --plan-model opus ',
    "Plan with claude, implement with codex",
  )
  .middleware(async (opts) => {
    if (!opts.help) return

    const agent = typeof opts.agent === "string" ? opts.agent : typeof opts._?.[0] === "string" ? opts._[0] : undefined
    const subcommand =
      typeof opts.subcommand === "string" ? opts.subcommand : typeof opts._?.[1] === "string" ? opts._[1] : undefined

    if (agent && !subcommand) {
      const help = await renderAgentRunHelp()
      console.log(help)
      process.exit(0)
    }

    if (agent && subcommand) {
      console.log(renderAgentManageHelp())
      process.exit(0)
    }

    console.log(renderTopLevelHelp())
    process.exit(0)
  })
  .command({ ...UpgradeCommand, describe: false })
  .command(AttachCommand)
  .command(DebugCommand)
  .command(GenerateCommand)
  .command(McpCommand)
  .command(ServeCommand)
  .command(TuiSpawnCommand)
  .command(StatsCommand)
  .command(WebCommand)
  // .command(ExportCommand)
  // .command(ImportCommand)
  // .command(GithubCommand)
  // .command(PrCommand)
  .strictCommands(false)
  .demandCommand(0)
  .fail(async (msg, err, yargs) => {
    const parsedArgs = (yargs as any).parsed?.argv ?? {}
    const agent =
      typeof parsedArgs.agent === "string"
        ? parsedArgs.agent
        : typeof parsedArgs._?.[0] === "string"
          ? parsedArgs._[0]
          : undefined
    const subcommand =
      typeof parsedArgs.subcommand === "string"
        ? parsedArgs.subcommand
        : typeof parsedArgs._?.[1] === "string"
          ? parsedArgs._[1]
          : undefined

    const manageSubcommands = new Set(["install", "uninstall", "check", "modes", "models"])
    if (agent && subcommand && manageSubcommands.has(subcommand)) {
      await runAgentManage(agent, subcommand, parsedArgs.verbose as boolean)
      return
    }

    if (parsedArgs.help) {
      if (agent && !subcommand) {
        console.log(await renderAgentRunHelp())
        process.exit(0)
      }
      if (agent && subcommand) {
        console.log(renderAgentManageHelp())
        process.exit(0)
      }
      console.log(renderTopLevelHelp())
      process.exit(0)
    }

    // If no command was specified (bare `forge`), run default TUI
    if (msg && (msg.includes("Not enough non-option arguments") || msg.includes("Missing required argument"))) {
      await runDefaultTui(parsedArgs)
      return
    }

    if (
      msg &&
      (msg.startsWith("Unknown argument") ||
        msg.startsWith("Not enough non-option arguments") ||
        msg.startsWith("Invalid values:"))
    ) {
      yargs.showHelp("log")
    }
    process.exit(1)
  })

async function renderAgentRunHelp() {
  const help = await yargs([])
    .scriptName("forge")
    .wrap(null)
    .usage("forge <agent> [prompt..]\n\nrun agent with prompt")
    .option("mode", {
      describe: "mode to use for the agent",
      type: "string",
    })
    .option("model", {
      describe: "model to use for the agent",
      type: "string",
    })
    .option("plan-agent", {
      describe: "agent to use for planning",
      type: "string",
    })
    .option("plan-model", {
      describe: "model to use for planning agent",
      type: "string",
    })
    .option("print", {
      alias: ["p"],
      type: "boolean",
      describe: "Run headless, print response and exit",
    })
    .option("project", {
      type: "string",
      describe: "path to start forge in",
    })
    .option("continue", {
      alias: ["c"],
      describe: "continue the last session",
      type: "boolean",
    })
    .option("session", {
      alias: ["s"],
      type: "string",
      describe: "session id to continue",
    })
    .help("help", "show help")
    .alias("help", "h")
    .version(false)
    .getHelp()

  return UI.logo() + "\n\n" + help.trimEnd()
}

function renderAgentManageHelp() {
  const lines = [
    UI.logo(),
    "",
    "forge <agent> <subcommand>",
    "",
    "manage agent <install|uninstall|check|modes|models>",
    "",
    "Positionals:",
    "  agent       agent name",
    "  subcommand  install | uninstall | check | modes | models",
    "",
    "Options:",
    "  -h, --help  show help  [boolean]",
  ]
  return lines.join("\n")
}

function renderTopLevelHelp() {
  const commands: Array<[string, string]> = [
    ["forge", "start TUI  [default]"],
    ["forge agents", "list all available agents"],
    ["forge <agent> <subcommand>", "manage agent <install|uninstall|check|modes|models>"],
    ["forge <agent> [prompt..]", "run agent with prompt"],
  ]

  const options: Array<[string, string]> = [
    ["-h, --help", "show help  [boolean]"],
    ["-v, --version", "show version number  [boolean]"],
    ["    --print-logs", "print logs to stderr  [boolean]"],
    ["    --log-level", 'log level  [string] [choices: "DEBUG", "INFO", "WARN", "ERROR"]'],
    ["    --project", "path to start forge in  [string]"],
    ["-c, --continue", "continue the last session  [boolean]"],
    ["-s, --session", "session id to continue  [string]"],
  ]

  const examples: Array<[string, string]> = [
    ["forge", "Start TUI"],
    ["forge claude install", "Install claude"],
    ['forge claude "Update my CLAUDE.md"', "Run claude with prompt"],
    [
      'forge claude --model opus --mode bypassPermissions "Refactor the authentication module"',
      "Run with specific model/mode",
    ],
    [
      'forge codex "Find all the TODO comments" --plan-agent claude --plan-model opus',
      "Plan with claude, implement with codex",
    ],
  ]

  const commandWidth = Math.max(...commands.map(([cmd]) => cmd.length))
  const optionWidth = Math.max(...options.map(([opt]) => opt.length))
  const exampleWidth = Math.max(...examples.map(([ex]) => ex.length))

  const lines = [
    UI.logo(),
    "",
    "Commands:",
    ...commands.map(([cmd, desc]) => `  ${cmd.padEnd(commandWidth)}  ${desc}`),
    "",
    "Options:",
    ...options.map(([opt, desc]) => `  ${opt.padEnd(optionWidth)}  ${desc}`),
    "",
    "Examples:",
    ...examples.map(([ex, desc]) => `  ${ex.padEnd(exampleWidth)}  ${desc}`),
  ]

  return lines.join("\n")
}

let parsedArgs: any

try {
  parsedArgs = await cli.parse()
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
  const knownCommands = new Set([
    "agents",
    "upgrade",
    "attach",
    "debug",
    "generate",
    "mcp",
    "serve",
    "spawn",
    "stats",
    "web",
  ])
  const manageSubcommands = new Set(["install", "uninstall", "check", "modes", "models"])

  if (!commandHandled && parsedArgs) {
    const pos = (parsedArgs._ as any[]) ?? []
    const agent = (parsedArgs.agent as string) ?? (typeof pos[0] === "string" ? pos[0] : undefined)
    const sub = (parsedArgs.subcommand as string) ?? (typeof pos[1] === "string" ? pos[1] : undefined)

    if (agent && !knownCommands.has(agent)) {
      if (sub && manageSubcommands.has(sub)) {
        await runAgentManage(agent, sub, parsedArgs.verbose as boolean)
      } else {
        const promptInput = parsedArgs.prompt ?? (pos.length > 1 ? pos.slice(1) : undefined)
        const prompt = Array.isArray(promptInput) ? promptInput.join(" ") : promptInput

        let agentSpec = agent
        const parts: string[] = []
        if (parsedArgs.mode) parts.push(`mode=${parsedArgs.mode}`)
        if (parsedArgs.model) parts.push(`model=${parsedArgs.model}`)
        if (parts.length > 0) {
          agentSpec = `name=${agent} ${parts.join(" ")}`
        }

        let planAgentSpec: string | undefined
        if (parsedArgs.planAgent) {
          const planParts: string[] = [`name=${parsedArgs.planAgent}`]
          if (parsedArgs.planModel) planParts.push(`model=${parsedArgs.planModel}`)
          planAgentSpec = planParts.join(" ")
        }

        await runWithAgent({
          ...parsedArgs,
          agent: agentSpec,
          planAgent: planAgentSpec,
          prompt,
        })
      }
    } else if (!agent || pos.length === 0) {
      await runDefaultTui(parsedArgs)
    }
  }

  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
