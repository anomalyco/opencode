import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import {
  matchAgent,
  getAllAgents,
  getInstallCommandsForPlatform,
  getUninstallCommandsForPlatform,
  type ACPAgentDefinition,
} from "@/acp/agents"
import { ACPClient } from "@/acp/client"
import { AuthenticationRequiredError } from "@/acp/types"
import * as prompts from "@clack/prompts"
import { upgrade } from "../upgrade"
import { runAgentInstall } from "@/acp/install"
import { runNonInteractive } from "./run"
import { tui } from "./tui/app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./tui/worker"
import path from "path"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { parseAgentFlags, validateAgentFlags } from "./session-init"

declare global {
  const FORGE_WORKER_PATH: string
}

export const AgentManageCommand = cmd({
  command: "<agent> <subcommand>",
  describe: "manage agent <install|uninstall|check|modes|models>",
  builder: (yargs: Argv) => {
    return yargs
      .positional("agent", {
        describe: "agent name",
        type: "string",
      })
      .positional("subcommand", {
        describe: "install | uninstall | check | modes | models",
        type: "string",
        choices: ["install", "uninstall", "check", "modes", "models"],
      })
  },
  handler: async (args) => {
    await runAgentManage(
      args.agent as string | undefined,
      args.subcommand as string | undefined,
      args.verbose as boolean,
    )
  },
})

export const AgentRunCommand = cmd({
  command: "<agent> [prompt..]",
  describe: "run agent with prompt",
  builder: (yargs: Argv) => {
    return yargs
      .positional("agent", {
        describe: "agent name",
        type: "string",
      })
      .positional("prompt", {
        describe: "prompt to submit to the agent",
        type: "string",
        array: true,
      })
      .option("mode", {
        describe: "mode to use for the agent",
        type: "string",
      })
      .option("model", {
        describe: "model to use for the agent",
        type: "string",
      })
      // .option("plan-agent", {
      //   describe: "agent to use for planning",
      //   type: "string",
      // })
      // .option("plan-model", {
      //   describe: "model to use for planning agent",
      //   type: "string",
      // })
      .option("print", {
        alias: ["p"],
        type: "boolean",
        describe: "Run headless, print response and exit",
      })
      .option("port", {
        type: "number",
        describe: "port to listen on",
        default: 0,
        hidden: true,
      })
      .option("hostname", {
        type: "string",
        describe: "hostname to listen on",
        default: "127.0.0.1",
        hidden: true,
      })
      .option("command", {
        type: "string",
        describe: "the command to run, use prompt for args (print mode only)",
        hidden: true,
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to prompt (print mode only)",
        hidden: true,
      })
      .option("share", {
        type: "boolean",
        describe: "share the session (print mode only)",
        hidden: true,
      })
      .option("title", {
        type: "string",
        describe: "title for the session (print mode only, uses truncated prompt if empty string)",
        hidden: true,
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running forge server (e.g., http://localhost:4096) (print mode only)",
        hidden: true,
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"] as const,
        default: "default",
        describe: "output format for print mode",
        hidden: true,
      })
  },
  handler: async (args) => {
    markCommandHandled()
    const agentName = args.agent as string | undefined

    const promptArgs = (args.prompt as string[]) || []

    if (!agentName) {
      UI.error("Agent name is required")
      process.exit(1)
    }

    const agentMatch = matchAgent(agentName)

    if (!agentMatch.success) {
      UI.error(`Agent '${agentName}' not found. Run "forge agents" to list available agents.`)
      process.exit(1)
    }

    const agent = agentMatch.match

    // If the user typed a manage subcommand in the prompt position (e.g., "forge claude modes"),
    // route to the manage handlers instead of starting the TUI.
    const manageSubcommands = new Set(["install", "uninstall", "check", "modes", "models"])
    if (promptArgs.length === 1 && manageSubcommands.has(promptArgs[0])) {
      return await runAgentManage(agent.name, promptArgs[0], args.verbose as boolean)
    }

    let agentSpec = agent.name
    const parts: string[] = []
    if (args.mode) parts.push(`mode=${args.mode}`)
    if (args.model) parts.push(`model=${args.model}`)
    if (parts.length > 0) {
      agentSpec = `name=${agent.name} ${parts.join(" ")}`
    }

    let planAgentSpec: string | undefined
    if (args.planAgent) {
      const planParts: string[] = [`name=${args.planAgent}`]
      if (args.planModel) planParts.push(`model=${args.planModel}`)
      planAgentSpec = planParts.join(" ")
    }

    return await runWithAgent({
      ...args,
      agent: agentSpec,
      planAgent: planAgentSpec,
      prompt: promptArgs.length > 0 ? promptArgs.join(" ") : undefined,
    })
  },
})

export async function runDefaultTui(args: any) {
  markCommandHandled()
  return await runWithAgent({
    ...args,
    agent: undefined,
    planAgent: undefined,
  })
}

export let commandHandled = false
export function markCommandHandled() {
  commandHandled = true
}

export function resolvePrompt(args: { prompt?: unknown; _?: unknown; agent?: unknown; print?: unknown }) {
  if (typeof args.prompt === "string" && args.prompt.trim().length > 0) {
    return args.prompt
  }

  if (Array.isArray(args.prompt)) {
    const joined = args.prompt.filter((part): part is string => typeof part === "string").join(" ")
    if (joined.trim().length > 0) return joined
  }

  const positionals = Array.isArray(args._) ? args._ : []
  const usablePositionals =
    typeof args.agent === "string" && positionals.length > 0 ? positionals.slice(1) : positionals
  const positionalPrompt = usablePositionals.filter((part): part is string => typeof part === "string").join(" ")
  if (positionalPrompt.trim().length > 0) return positionalPrompt

  if (typeof args.print === "string" && args.print.trim().length > 0) {
    return args.print
  }

  return undefined
}

export async function runAgentManage(agentName: string | undefined, subcommand: string | undefined, verbose: boolean) {
  markCommandHandled()

  if (!agentName) {
    UI.error("Agent name is required")
    process.exit(1)
  }

  const agentMatch = matchAgent(agentName)

  if (!agentMatch.success) {
    UI.error(`Agent '${agentName}' not found. Run "forge agents" to list available agents.`)
    process.exit(1)
  }

  const agent = agentMatch.match

  if (subcommand === "install") {
    return await handleInstall(agent)
  }

  if (subcommand === "uninstall") {
    return await handleUninstall(agent)
  }

  if (subcommand === "check") {
    return await handleCheck(agent)
  }

  if (subcommand === "modes") {
    return await handleModes(agent, verbose)
  }

  if (subcommand === "models") {
    return await handleModels(agent, verbose)
  }

  UI.error(`Unknown subcommand '${subcommand}'`)
  process.exit(1)
}

export async function runWithAgent(args: any) {
  markCommandHandled()
  const baseCwd = process.env.PWD ?? process.cwd()
  const cwd = args.project ? path.resolve(baseCwd, args.project) : process.cwd()

  try {
    process.chdir(cwd)
  } catch (e) {
    UI.error("Failed to change directory to " + cwd)
    return
  }

  if (args.command && !args.print) {
    UI.error("--command is only supported with --print")
    process.exit(1)
  }

  const cliPrompt = resolvePrompt(args)

  let parsedAgents: ReturnType<typeof parseAgentFlags> | null = null
  if (!args.print) {
    try {
      parsedAgents = parseAgentFlags(args.agent, args.planAgent)
      validateAgentFlags(parsedAgents.agents, parsedAgents.rawCount, (msg) => {
        UI.error(msg)
        process.exit(1)
      })
      for (const entry of parsedAgents.agents) {
        const resolved = matchAgent(entry.name)
        if (!resolved.success) {
          UI.error(`Agent '${entry.name}' not found. Run "forge list" to list available agents.`)
          process.exit(1)
        }
        if (!Bun.which(resolved.match.command)) {
          UI.error(
            `Agent '${resolved.match.name}' is not installed. Run 'forge "${resolved.match.name}" install' to install.`,
          )
          process.exit(1)
        }
      }
    } catch (error) {
      UI.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  }

  if (args.print) {
    await runNonInteractive({
      message: cliPrompt,
      command: args.command,
      continue: args.continue,
      session: args.session,
      share: args.share,
      agent: args.agent,
      planAgent: args.planAgent,
      file: args.file,
      title: args.title,
      attach: args.attach,
      port: args.port,
      format: args.format,
      quietAgentLogs: true,
    })
    return
  }

  Log.Default.info("agent-context.args", {
    rawPrompt: args.prompt,
    cliPrompt,
    agent: args.agent ?? null,
    planAgent: args.planAgent ?? null,
  })

  const defaultWorker = new URL("./tui/worker.ts", import.meta.url)
  const execDir = path.dirname(process.execPath)
  const bundledWorker = path.join(execDir, "opencode-worker.js")
  const hasBundledWorker = await Bun.file(bundledWorker).exists()
  const workerPath = (() => {
    if (typeof FORGE_WORKER_PATH !== "undefined") return FORGE_WORKER_PATH
    if (hasBundledWorker) return bundledWorker
    return defaultWorker
  })()

  const workerArgv: string[] = []
  // if (args.planAgent) {
  //   workerArgv.push("--plan-agent", args.planAgent)
  // }
  if (args.agent) {
    workerArgv.push("--agent", args.agent)
  }

  const worker = new Worker(workerPath, {
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    argv: workerArgv,
  })

  Log.Default.info("agent-context.worker", {
    prompt: cliPrompt,
    agent: args.agent ?? null,
    planAgent: args.planAgent ?? null,
  })

  worker.onerror = (e) => {
    Log.Default.error(e)
  }

  const client = Rpc.client<typeof rpc>(worker)
  process.on("uncaughtException", (e) => {
    Log.Default.error(e)
  })
  process.on("unhandledRejection", (e) => {
    Log.Default.error(e)
  })

  const server = await client.call("server", {
    port: args.port,
    hostname: args.hostname,
  })

  const prompt = await iife(async () => {
    const piped = !process.stdin.isTTY ? await Bun.stdin.text() : undefined
    if (!cliPrompt) return piped
    return piped ? piped + "\n" + cliPrompt : cliPrompt
  })

  await tui({
    url: server.url,
    args: {
      continue: args.continue,
      sessionID: args.session,
      agents: parsedAgents?.agents ?? [],
      prompt,
    },
    onExit: async () => {
      await client.call("shutdown", undefined)
    },
  })
}

async function handleInstall(agent: ACPAgentDefinition) {
  await upgrade()

  const commands = getInstallCommandsForPlatform(agent)
  if (!commands.length) {
    UI.error("No install commands available for this platform.")
    process.exit(1)
  }

  prompts.intro(`Install ${agent.name}`)

  const method = await prompts.select({
    message: "Select an install method",
    options: commands.map((cmd, idx) => ({
      value: idx,
      label: cmd.description ? `${cmd.method} — ${cmd.description}` : cmd.method,
      hint: cmd.command,
    })),
  })

  if (prompts.isCancel(method) || method === undefined || method === null) {
    throw new UI.CancelledError()
  }

  const selectedCommand = commands[method as number]

  prompts.log.info(selectedCommand.command)

  const result = await runAgentInstall({
    agent,
    installCommand: selectedCommand,
    onOutput: (chunk) => {
      process.stdout.write(chunk)
    },
  })

  if (result.code === 0 && result.detected) {
    prompts.outro(`${agent.name} installed and detected on PATH.`)
    return
  }

  const reason = result.error?.message ?? `Exit code ${result.code ?? "unknown"}`
  const detectedText = result.detected ? "Detected on PATH" : "Not detected on PATH"

  prompts.log.error(`${agent.name} install failed. ${detectedText}. ${reason}`)
  process.exit(1)
}

async function handleUninstall(agent: ACPAgentDefinition) {
  await upgrade()

  const commands = getUninstallCommandsForPlatform(agent)
  if (!commands.length) {
    UI.error("No uninstall commands available for this platform.")
    process.exit(1)
  }

  prompts.intro(`Uninstall ${agent.name}`)

  const method = await prompts.select({
    message: "Select an uninstall method",
    options: commands.map((cmd, idx) => ({
      value: idx,
      label: cmd.description ? `${cmd.method} — ${cmd.description}` : cmd.method,
      hint: cmd.command,
    })),
  })

  if (prompts.isCancel(method) || method === undefined || method === null) {
    throw new UI.CancelledError()
  }

  const selectedCommand = commands[method as number]

  prompts.log.info(selectedCommand.command)

  const result = await runAgentInstall({
    agent,
    installCommand: selectedCommand,
    onOutput: (chunk) => {
      process.stdout.write(chunk)
    },
  })

  if (result.code === 0) {
    const stillThere = Bun.which(agent.command) !== null
    if (!stillThere) {
      prompts.outro(`${agent.name} uninstalled and not detected on PATH.`)
      return
    }
  }

  const reason = result.error?.message ?? `Exit code ${result.code ?? "unknown"}`
  const detectedText = Bun.which(agent.command) ? "Still detected on PATH" : "Not detected on PATH"

  prompts.log.error(`${agent.name} uninstall may have failed. ${detectedText}. ${reason}`)
  process.exit(1)
}

async function handleCheck(agent: ACPAgentDefinition) {
  const isInstalled = Bun.which(agent.command) !== null

  if (isInstalled) {
    process.stdout.write(`✓ ${agent.name} is installed${EOL}`)
    process.exit(0)
  } else {
    process.stdout.write(`✗ ${agent.name} is not installed${EOL}`)
    process.stdout.write(`  Run 'forge ${agent.name} install' to install${EOL}`)
    process.exit(1)
  }
}

async function handleModels(agent: ACPAgentDefinition, verbose: boolean) {
  let client: ACPClient.Instance | undefined
  try {
    client = await ACPClient.create({
      command: agent.command,
      args: agent.acpStartupArgs,
      cwd: process.cwd(),
      capabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
      },
    })

    await client.initialize()

    try {
      await client.createSession()
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        if (error.authMethods.length === 0) {
          UI.error(`Agent ${agent.name} requires authentication but provided no auth methods${EOL}`)
          process.exit(1)
        }

        const authMethod = error.authMethods[0]

        if (authMethod._meta?.["terminal-auth"]) {
          const terminalAuth = authMethod._meta["terminal-auth"] as {
            command?: string
            args?: string[]
            label?: string
          }
          UI.error(
            `Authentication required: Please run '${terminalAuth.command} ${(terminalAuth.args ?? []).join(" ")}' in your terminal${EOL}`,
          )
          process.exit(1)
        }

        await client.authenticate(authMethod.id)
        await client.createSession()
      } else {
        throw error
      }
    }

    const models = client.getModels()
    if (!models || !models.availableModels || models.availableModels.length === 0) {
      UI.error(`No models available for agent ${agent.name}${EOL}`)
      process.exit(1)
    }

    for (const model of models.availableModels) {
      process.stdout.write(model.modelId)
      process.stdout.write(EOL)
      if (verbose) {
        process.stdout.write(JSON.stringify(model, null, 2))
        process.stdout.write(EOL)
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    UI.error(`Failed to get models for agent ${agent.name}: ${err.message}${EOL}`)
    if (agent.installGuide) {
      UI.error(`See installation guide: ${agent.installGuide}${EOL}`)
    }
    process.exit(1)
  } finally {
    if (client) {
      await client.dispose()
    }
  }
}

async function handleModes(agent: ACPAgentDefinition, verbose: boolean) {
  let client: ACPClient.Instance | undefined
  try {
    client = await ACPClient.create({
      command: agent.command,
      args: agent.acpStartupArgs,
      cwd: process.cwd(),
      capabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
      },
    })

    await client.initialize()

    try {
      await client.createSession()
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        if (error.authMethods.length === 0) {
          UI.error(`Agent ${agent.name} requires authentication but provided no auth methods${EOL}`)
          process.exit(1)
        }

        const authMethod = error.authMethods[0]

        if (authMethod._meta?.["terminal-auth"]) {
          const terminalAuth = authMethod._meta["terminal-auth"] as {
            command?: string
            args?: string[]
            label?: string
          }
          UI.error(
            `Authentication required: Please run '${terminalAuth.command} ${(terminalAuth.args ?? []).join(" ")}' in your terminal${EOL}`,
          )
          process.exit(1)
        }

        await client.authenticate(authMethod.id)
        await client.createSession()
      } else {
        throw error
      }
    }

    const modes = client.getModes()
    if (!modes || !modes.availableModes || modes.availableModes.length === 0) {
      UI.error(`No modes available for agent ${agent.name}${EOL}`)
      process.exit(1)
    }

    for (const mode of modes.availableModes) {
      if (verbose) {
        process.stdout.write(`${mode.id}`)
        if (mode.name && mode.name !== mode.id) {
          process.stdout.write(` (${mode.name})`)
        }
        process.stdout.write(EOL)
      } else {
        process.stdout.write(mode.id)
        process.stdout.write(EOL)
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    UI.error(`Failed to get modes for agent ${agent.name}: ${err.message}${EOL}`)
    if (agent.installGuide) {
      UI.error(`See installation guide: ${agent.installGuide}${EOL}`)
    }
    process.exit(1)
  } finally {
    if (client) {
      await client.dispose()
    }
  }
}
