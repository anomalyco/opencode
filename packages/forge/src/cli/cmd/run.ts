import type { Argv } from "yargs"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { bootstrap } from "../bootstrap"
import { Command } from "../../command"
import { EOL } from "os"
import { select } from "@clack/prompts"
import { createForgeClient } from "@forge/sdk"
import { Server } from "../../server/server"
import { type AgentFlag, applyAgentEntry, parseAgentFlags, validateAgentFlags } from "./session-init"
import { Log } from "@/util/log"
import { getAgent } from "@/acp/agents"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
}

function fail(message: string): never {
  UI.error(message)
  process.exit(1)
}

export type RunHandlerArgs = {
  message?: string | string[]
  command?: string
  continue?: boolean
  session?: string
  share?: boolean
  agent?: string
  planAgent?: string
  format?: "default" | "json"
  file?: string[] | string
  title?: string
  attach?: string
  port?: number
  quietAgentLogs?: boolean
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run forge with a message",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("agent", {
        type: "string",
        alias: ["a"],
        describe: 'agent spec: --agent claude or --agent "name=claude model=opus mode=bypassPermissions"',
      })
      .option("plan-agent", {
        type: "string",
        describe: 'plan agent spec: --plan-agent claude or --plan-agent "name=claude model=opus"',
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running forge server (e.g., http://localhost:4096)",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
  },
  handler: async (args) => runNonInteractive(args as RunHandlerArgs),
})

export async function runNonInteractive(args: RunHandlerArgs) {
  const messageParts = Array.isArray(args.message) ? args.message : args.message ? [args.message] : []
  let message = messageParts.join(" ")
  const format = args.format ?? "default"

  const fileParts: any[] = []
  if (args.file) {
    const files = Array.isArray(args.file) ? args.file : [args.file]

    for (const filePath of files) {
      const resolvedPath = path.resolve(process.cwd(), filePath)
      const file = Bun.file(resolvedPath)
      const stats = await file.stat().catch(() => {})
      if (!stats) {
        UI.error(`File not found: ${filePath}`)
        process.exit(1)
      }
      if (!(await file.exists())) {
        UI.error(`File not found: ${filePath}`)
        process.exit(1)
      }

      const stat = await file.stat()
      const mime = stat.isDirectory() ? "application/x-directory" : "text/plain"

      fileParts.push({
        type: "file",
        url: `file://${resolvedPath}`,
        filename: path.basename(resolvedPath),
        mime,
      })
    }
  }

  if (!process.stdin.isTTY) {
    const piped = await Bun.stdin.text()
    if (piped) {
      message = message ? `${message}\n${piped}` : piped
    }
  }

  if (message.trim().length === 0 && !args.command) {
    UI.error("You must provide a message or a command")
    process.exit(1)
  }

  const { agents: agentQueue, rawCount: agentRaw } = (() => {
    try {
      return parseAgentFlags(args.agent, args.planAgent)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      fail(message)
    }
  })()
  validateAgentFlags(agentQueue, agentRaw, fail)
  const log = Log.create({ service: "run-cli" })

  const execute = async (sdk: ReturnType<typeof createForgeClient>, sessionID: string, queue: AgentFlag[]) => {
    const queueState: {
      index: number
      entries: AgentFlag[]
      active: { agent: string; model: string | null; modeId: string | null } | null
    } = {
      index: 0,
      entries: queue,
      active: null,
    }

    const applyQueueEntry = async (index: number, reason: "initial" | "switch") => {
      const entry = queueState.entries[index]
      if (!entry) return
      const applied = await applyAgentEntry({ sdk, sessionID, entry, log })
      queueState.active = applied
      queueState.index = index
      if (format === "json") {
        process.stdout.write(
          JSON.stringify({
            type: "agent.apply",
            timestamp: Date.now(),
            sessionID,
            agent: applied.agent,
            model: applied.model,
            mode: applied.modeId,
            reason,
            index,
          }) + EOL,
        )
      } else if (!args.quietAgentLogs) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "~",
          UI.Style.TEXT_DIM + " agent",
          "",
          `${applied.agent}` +
            (applied.model ? `/${applied.model}` : "") +
            (applied.modeId ? ` (${applied.modeId})` : ""),
          UI.Style.TEXT_DIM + ` [${reason}]`,
        )
      }
    }

    const printEvent = (color: string, type: string, title: string) => {
      UI.println(
        color + `|`,
        UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
        "",
        UI.Style.TEXT_NORMAL + title,
      )
    }

    const outputJsonEvent = (type: string, data: any) => {
      if (format === "json") {
        process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
        return true
      }
      return false
    }

    const events = await sdk.event.subscribe()
    let errorMsg: string | undefined

    if (queueState.entries.length > 0) {
      try {
        await applyQueueEntry(0, "initial")
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const agentGuide = getAgent(queueState.entries[0]?.name)?.installGuide
        const hint =
          agentGuide && /not installed|command not found/i.test(message)
            ? `${message}\nInstall: ${agentGuide}`
            : message
        UI.error(hint)
        process.exit(1)
      }
    }

    const eventProcessor = (async () => {
      for await (const rawEvent of events.stream as AsyncIterable<any>) {
        const event = rawEvent as any

        log.debug("event received", { type: event.type })

        if (event.type === "session.mode.changed") {
          if (queueState.entries.length <= queueState.index + 1) continue
          if (!queueState.active?.modeId) continue
          const props = (event.properties ?? {}) as {
            sessionID?: string
            agent?: string
            modeId?: string
          }

          if (props.sessionID === sessionID && props.modeId && props.modeId !== queueState.active.modeId) {
            try {
              await applyQueueEntry(queueState.index + 1, "switch")
            } catch (error) {
              const base = error instanceof Error ? error.message : String(error)
              const agentGuide = getAgent(queueState.entries[queueState.index + 1]?.name)?.installGuide
              const message =
                agentGuide && /not installed|command not found/i.test(base) ? `${base}\nInstall: ${agentGuide}` : base
              const wrapped = `Failed to switch agent queue: ${message}`
              UI.error(wrapped)
              errorMsg = errorMsg ? `${errorMsg}${EOL}${wrapped}` : wrapped
              break
            }
          }
        }

        if (event.type === "message.part.updated") {
          const part = event.properties.part
          if (part.sessionID !== sessionID) continue

          log.debug("message.part.updated", {
            partType: part.type,
            partTime: part.time,
            hasEnd: !!part.time?.end,
          })

          if (part.type === "tool" && part.state.status === "completed") {
            if (outputJsonEvent("tool_use", { part })) continue
            const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
            const title =
              part.state.title ||
              (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
            printEvent(color, tool, title)
            if (part.tool === "bash" && part.state.output?.trim()) {
              UI.println()
              UI.println(part.state.output)
            }
          }

          if (part.type === "step-start") {
            if (outputJsonEvent("step_start", { part })) continue
          }

          if (part.type === "step-finish") {
            if (outputJsonEvent("step_finish", { part })) continue
          }

          if (part.type === "text" && part.time?.end) {
            log.info("text part complete, exiting", { text: part.text })
            if (outputJsonEvent("text", { part })) continue
            const isPiped = !process.stdout.isTTY
            if (!isPiped) UI.println()
            const rendered = isPiped ? part.text : UI.markdown(part.text)
            process.stdout.write(rendered + EOL)
            if (!isPiped) UI.println()
            // In print mode, exit after printing the completed text
            break
          }
        }

        if (event.type === "session.error") {
          const props = event.properties
          if (props.sessionID !== sessionID || !props.error) continue
          let err = String(props.error.name)
          if ("data" in props.error && props.error.data && "message" in props.error.data) {
            err = String(props.error.data.message)
          }
          errorMsg = errorMsg ? errorMsg + EOL + err : err
          if (outputJsonEvent("error", { error: props.error })) continue
          UI.error(err)
        }

        if (event.type === "session.idle" && event.properties.sessionID === sessionID) {
          break
        }

        if (event.type === "permission.updated") {
          const permission = event.properties
          if (permission.sessionID !== sessionID) continue
          const result = await select({
            message: `Permission required to run: ${permission.title}`,
            options: [
              { value: "once", label: "Allow once" },
              { value: "always", label: "Always allow" },
              { value: "reject", label: "Reject" },
            ],
            initialValue: "once",
          }).catch(() => "reject")
          const response = (result.toString().includes("cancel") ? "reject" : result) as "once" | "always" | "reject"
          await sdk.postSessionIdPermissionsPermissionId({
            path: { id: sessionID, permissionID: permission.id },
            body: { response },
          })
        }
      }
    })()

    if (args.command) {
      await sdk.session.command({
        path: { id: sessionID },
        body: {
          agent: queueState.active?.agent ?? undefined,
          command: args.command,
          arguments: message,
        },
      })
    } else {
      // Note: agent and model selection is handled through separate HTTP endpoints,
      // not through the prompt body
      await sdk.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [...fileParts, { type: "text", text: message }],
        },
      })
    }

    await eventProcessor
    if (errorMsg) process.exit(1)
  }

  if (args.attach) {
    const sdk = createForgeClient({ baseUrl: args.attach })

    const sessionID = await (async () => {
      if (args.continue) {
        const result = await sdk.session.list()
        return result.data?.find((s) => !s.parentID)?.id
      }
      if (args.session) return args.session

      const title =
        args.title !== undefined
          ? args.title === ""
            ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
            : args.title
          : undefined

      const result = await sdk.session.create({ body: title ? { title } : {} })
      return result.data?.id
    })()

    if (!sessionID) {
      UI.error("Session not found")
      process.exit(1)
    }

    const cfgResult = await sdk.config.get()
    if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.FORGE_AUTO_SHARE || args.share)) {
      const shareResult = await sdk.session.share({ path: { id: sessionID } }).catch((error) => {
        if (error instanceof Error && error.message.includes("disabled")) {
          UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
        }
        return { error }
      })
      if (!shareResult.error) {
        UI.println(UI.Style.TEXT_INFO_BOLD + "~  https://forge.dev/s/" + sessionID.slice(-8))
      }
    }

    return await execute(sdk, sessionID, agentQueue)
  }

  await bootstrap(process.cwd(), async () => {
    const server = Server.listen({ port: args.port ?? 0, hostname: "127.0.0.1" })
    const sdk = createForgeClient({ baseUrl: `http://${server.hostname}:${server.port}` })

    if (args.command) {
      const exists = await Command.get(args.command)
      if (!exists) {
        server.stop()
        UI.error(`Command "${args.command}" not found`)
        process.exit(1)
      }
    }

    const sessionID = await (async () => {
      if (args.continue) {
        const result = await sdk.session.list()
        return result.data?.find((s) => !s.parentID)?.id
      }
      if (args.session) return args.session

      const title =
        args.title !== undefined
          ? args.title === ""
            ? message.slice(0, 50) + (message.length > 50 ? "..." : "")
            : args.title
          : undefined

      const result = await sdk.session.create({ body: title ? { title } : {} })
      return result.data?.id
    })()

    if (!sessionID) {
      server.stop()
      UI.error("Session not found")
      process.exit(1)
    }

    const cfgResult = await sdk.config.get()
    if (cfgResult.data && (cfgResult.data.share === "auto" || Flag.FORGE_AUTO_SHARE || args.share)) {
      const shareResult = await sdk.session.share({ path: { id: sessionID } }).catch((error) => {
        if (error instanceof Error && error.message.includes("disabled")) {
          UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
        }
        return { error }
      })
      if (!shareResult.error) {
        UI.println(UI.Style.TEXT_INFO_BOLD + "~  https://forge.dev/s/" + sessionID.slice(-8))
      }
    }

    await execute(sdk, sessionID, agentQueue)
    server.stop()
  })
}
