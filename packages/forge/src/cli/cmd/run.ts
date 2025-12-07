import type { Argv } from "yargs"
import path from "path"
import type { SessionModelState, SessionModeState } from "@agentclientprotocol/sdk"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { bootstrap } from "../bootstrap"
import { Command } from "../../command"
import { EOL } from "os"
import { select } from "@clack/prompts"
import { createForgeClient, type ForgeClient } from "@forge/sdk"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"

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

type ModeFlagArgs = {
  planAgent: string
  implementAgent: string
  planModel?: string
  implementModel?: string
}

type ModeSwitchConfig = ModeFlagArgs & {
  planModeId: string
  switched: boolean
}

function fail(message: string): never {
  UI.error(message)
  process.exit(1)
}

function collectModeFlags(args: Record<string, any>): ModeFlagArgs | null {
  const planAgent = args["plan-agent"]
  const implementAgent = args["impl-agent"]
  const planModel = args["plan-model"]
  const implementModel = args["impl-model"]

  if (planAgent || implementAgent || planModel || implementModel) {
    return {
      planAgent: planAgent ?? "",
      implementAgent: implementAgent ?? "",
      planModel: planModel ?? undefined,
      implementModel: implementModel ?? undefined,
    }
  }

  return null
}

function validateModeFlags(flags: ModeFlagArgs | null, args: Record<string, any>) {
  if (!flags) return

  if (!flags.planAgent || !flags.implementAgent) {
    fail("Both --plan-agent and --impl-agent are required when using plan/implement mode flags")
  }

  if (args.agent) {
    fail("Cannot combine --agent with --plan-agent/--impl-agent")
  }

  if (args.model) {
    fail("Cannot combine --model with --plan-model/--impl-model")
  }

  if (args.command) {
    fail("Plan/implement mode flags are only supported with prompts (omit --command)")
  }
}

function hasPlanKeyword(value?: string | null) {
  return typeof value === "string" && value.toLowerCase().includes("plan")
}

function findPlanModeId(modes: SessionModeState | null | undefined): string | null {
  if (!modes?.availableModes?.length) return null
  const match = modes.availableModes.find((mode) => hasPlanKeyword(mode.id) || hasPlanKeyword(mode.name))
  return match?.id ?? null
}

function modelSupported(models: SessionModelState | null | undefined, modelId: string) {
  return models?.availableModels?.some((model) => model.modelId === modelId)
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
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model name or ID (e.g., 'haiku', 'sonnet'). Must be supported by the selected agent.",
      })
      .option("plan-agent", {
        type: "string",
        describe: "agent to use for planning mode",
      })
      .option("impl-agent", {
        type: "string",
        describe: "agent to use for implementation mode (shorthand for implement)",
      })
      .option("plan-model", {
        type: "string",
        describe: "model to use with the planning agent",
      })
      .option("impl-model", {
        type: "string",
        describe: "model to use with the implementation agent",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use (e.g., 'claude', 'gemini')",
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
  handler: async (args) => {
    let message = args.message.join(" ")

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

    if (!process.stdin.isTTY) message += "\n" + (await Bun.stdin.text())

    if (message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(1)
    }

    const modeFlags = collectModeFlags(args)
    validateModeFlags(modeFlags, args)

    const configurePlanMode = async (sdk: ForgeClient, sessionID: string, flags: ModeFlagArgs): Promise<ModeSwitchConfig> => {
      let agentResult:
        | Awaited<ReturnType<ForgeClient["session"]["agent"]>>
        | undefined
      try {
        agentResult = await sdk.session.agent({
          path: { id: sessionID },
          body: { agent: flags.planAgent },
        })
      } catch (error) {
        fail(`Failed to set planning agent: ${error instanceof Error ? error.message : String(error)}`)
      }

      const sessionState = agentResult?.data
      const agentName = sessionState?.agent ?? flags.planAgent
      const modes = (sessionState?.modes ?? null) as SessionModeState | null

      if (!modes?.availableModes?.length) {
        fail(`Agent '${agentName}' does not expose any modes; cannot enter planning mode`)
      }

      const planModeId = findPlanModeId(modes)
      if (!planModeId) {
        fail(`Agent '${agentName}' does not support planning mode`)
      }

      if (flags.planModel) {
        const models = (sessionState?.models ?? null) as SessionModelState | null
        if (!modelSupported(models, flags.planModel)) {
          fail(`Agent '${agentName}' does not support model '${flags.planModel}'`)
        }

        try {
          await sdk.session.model({
            path: { id: sessionID },
            body: { model: flags.planModel },
          })
        } catch (error) {
          fail(
            `Failed to set planning model '${flags.planModel}': ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      try {
        await sdk.session.mode({
          path: { id: sessionID },
          body: { mode: planModeId },
        })
      } catch (error) {
        fail(
          `Failed to set planning mode '${planModeId}' for agent '${agentName}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }

      return {
        ...flags,
        planAgent: agentName,
        planModeId,
        switched: false,
      }
    }

    const execute = async (sdk: ForgeClient, sessionID: string, flags: ModeFlagArgs | null) => {
      const printEvent = (color: string, type: string, title: string) => {
        UI.println(
          color + `|`,
          UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
          "",
          UI.Style.TEXT_NORMAL + title,
        )
      }

      const outputJsonEvent = (type: string, data: any) => {
        if (args.format === "json") {
          process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
          return true
        }
        return false
      }

      const events = await sdk.event.subscribe()
      let errorMsg: string | undefined
      let modeSwitch: ModeSwitchConfig | null = null
      let switchingToImplement = false

      const modeEquals = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

      const switchToImplementAgent = async (): Promise<"ok" | "error"> => {
        if (!modeSwitch || modeSwitch.switched || switchingToImplement) return "ok"
        switchingToImplement = true

        try {
          const agentResult = await sdk.session.agent({
            path: { id: sessionID },
            body: { agent: modeSwitch.implementAgent },
          })

          modeSwitch.implementAgent = agentResult.data?.agent ?? modeSwitch.implementAgent

          if (modeSwitch.implementModel) {
            const models = (agentResult.data?.models ?? null) as SessionModelState | null
            if (!modelSupported(models, modeSwitch.implementModel)) {
              const message = `Agent '${modeSwitch.implementAgent}' does not support model '${modeSwitch.implementModel}'`
              UI.error(message)
              errorMsg = errorMsg ? `${errorMsg}${EOL}${message}` : message
              return "error"
            }

            await sdk.session.model({
              path: { id: sessionID },
              body: { model: modeSwitch.implementModel },
            })
          }

          modeSwitch.switched = true
          return "ok"
        } catch (error) {
          const message = `Failed to switch to implement agent '${modeSwitch.implementAgent}': ${
            error instanceof Error ? error.message : String(error)
          }`
          UI.error(message)
          errorMsg = errorMsg ? `${errorMsg}${EOL}${message}` : message
          return "error"
        } finally {
          switchingToImplement = false
        }
      }

      const eventProcessor = (async () => {
        for await (const rawEvent of events.stream as AsyncIterable<any>) {
          const event = rawEvent as any

          if (modeSwitch && event.type === "session.mode.changed") {
            const props = (event.properties ?? {}) as {
              sessionID?: string
              agent?: string
              modeId?: string
            }

            if (props.sessionID === sessionID && props.agent === modeSwitch.planAgent && props.modeId) {
              if (!modeEquals(props.modeId, modeSwitch.planModeId)) {
                const result = await switchToImplementAgent()
                if (result === "error") break
              }
            }
          }

          if (event.type === "message.part.updated") {
            const part = event.properties.part
            if (part.sessionID !== sessionID) continue

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
              if (outputJsonEvent("text", { part })) continue
              const isPiped = !process.stdout.isTTY
              if (!isPiped) UI.println()
              process.stdout.write((isPiped ? part.text : UI.markdown(part.text)) + EOL)
              if (!isPiped) UI.println()
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

      if (flags) {
        modeSwitch = await configurePlanMode(sdk, sessionID, flags)
      }

      if (args.command) {
        await sdk.session.command({
          path: { id: sessionID },
          body: {
            agent: args.agent || "build",
            model: args.model,
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

      return await execute(sdk, sessionID, modeFlags)
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

      await execute(sdk, sessionID, modeFlags)
      server.stop()
    })
  },
})
