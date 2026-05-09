// CLI entry point for `opencode run`.
//
// Handles three modes:
//   1. Non-interactive (default): sends a single prompt, streams events to
//      stdout, and exits when the session goes idle.
//   2. Interactive local (`--interactive`): boots the split-footer direct mode
//      with an in-process server (no external HTTP).
//   3. Interactive attach (`--interactive --attach`): connects to a running
//      opencode server and runs interactive mode against it.
//
// Also supports `--command` for slash-command execution, `--format json` for
// raw event streaming, `--continue` / `--session` for session resumption,
// and `--fork` for forking before continuing.
import type { Argv } from "yargs"
import path from "path"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerAuth } from "@/server/auth"
import { EOL } from "os"
import { Filesystem } from "@/util/filesystem"
import { createOpencodeClient, type OpencodeClient, type ToolPart } from "@opencode-ai/sdk/v2"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { INTERACTIVE_INPUT_ERROR, resolveInteractiveStdin } from "./run/runtime.stdin"

const runtimeTask = import("./run/runtime")
type ModelInput = Parameters<OpencodeClient["session"]["prompt"]>[0]["model"]

function pick(value: string | undefined): ModelInput | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  return {
    providerID,
    modelID: rest.join("/"),
  } as ModelInput
}

function resolveRunInput(value?: string, piped?: string): string | undefined {
  if (!value) {
    return piped
  }

  if (!piped) {
    return value
  }

  return value + "\n" + piped
}

type FilePart = {
  type: "file"
  url: string
  filename: string
  mime: string
}

type Inline = {
  icon: string
  title: string
  description?: string
}

type SessionInfo = {
  id: string
  title?: string
  directory?: string
}

function inline(info: Inline) {
  const suffix = info.description ? UI.Style.TEXT_DIM + ` ${info.description}` + UI.Style.TEXT_NORMAL : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function block(info: Inline, output?: string) {
  UI.empty()
  inline(info)
  if (!output?.trim()) return
  UI.println(output)
  UI.empty()
}

async function tool(part: ToolPart) {
  try {
    const { toolInlineInfo } = await import("./run/tool")
    const next = toolInlineInfo(part)
    if (next.mode === "block") {
      block(next, next.body)
      return
    }

    inline(next)
  } catch {
    inline({
      icon: "\u2699",
      title: part.tool,
    })
  }
}

async function toolError(part: ToolPart) {
  try {
    const { toolInlineInfo } = await import("./run/tool")
    const next = toolInlineInfo(part)
    inline({
      icon: "✗",
      title: `${next.title} failed`,
      ...(next.description && { description: next.description }),
    })
    return
  } catch {
    inline({
      icon: "✗",
      title: `${part.tool} failed`,
    })
  }
}

export const RunCommand = effectCmd({
  command: "run [message..]",
  describe: "run opencode with a message",
  // --attach connects to a remote server (no local instance needed); the
  // default path runs an in-process server and needs the project instance.
  instance: (args) => !args.attach,
  // For --dir without --attach, load instance for the resolved target dir.
  // The handler also chdirs (preserving the legacy order: chdir → file resolution).
  directory: (args) => (args.dir && !args.attach ? path.resolve(process.cwd(), args.dir) : process.cwd()),
  builder: (yargs: Argv) =>
    yargs
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
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
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
        describe: "attach to a running opencode server (e.g., http://localhost:4096)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to OPENCODE_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "basic auth username (defaults to OPENCODE_SERVER_USERNAME or 'opencode')",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, path on remote server if attaching",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
      })
      .option("interactive", {
        alias: ["i"],
        type: "boolean",
        describe: "run in direct interactive split-footer mode",
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("demo", {
        type: "boolean",
        default: false,
        describe: "enable direct interactive demo slash commands; pass one as the message to run it immediately",
      }),
  handler: Effect.fn("Cli.run")(function* (args) {
    const agentSvc = yield* Agent.Service
    yield* Effect.promise(async () => {
      const rawMessage = [...args.message, ...(args["--"] || [])].join(" ")
      const thinking = args.interactive ? (args.thinking ?? true) : (args.thinking ?? false)
      const die = (message: string): never => {
        UI.error(message)
        process.exit(1)
      }
      const dieInteractive = (error: unknown): never => {
        if (error instanceof Error && error.message === INTERACTIVE_INPUT_ERROR) {
          die(error.message)
        }

        throw error
      }

      let message = [...args.message, ...(args["--"] || [])]
        .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
        .join(" ")

      if (args.interactive && args.command) {
        die("--interactive cannot be used with --command")
      }

      if (args.demo && !args.interactive) {
        die("--demo requires --interactive")
      }

      if (args.interactive && args.format === "json") {
        die("--interactive cannot be used with --format json")
      }

      if (args.interactive && !process.stdout.isTTY) {
        die("--interactive requires a TTY stdout")
      }

      if (args.interactive) {
        try {
          resolveInteractiveStdin().cleanup?.()
        } catch (error) {
          dieInteractive(error)
        }
      }

      const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
      const directory = (() => {
        if (!args.dir) return args.attach ? undefined : root
        if (args.attach) return args.dir

        try {
          process.chdir(path.isAbsolute(args.dir) ? args.dir : path.join(root, args.dir))
          return process.cwd()
        } catch {
          UI.error("Failed to change directory to " + args.dir)
          process.exit(1)
        }
      })()
      const attachHeaders = args.attach
        ? ServerAuth.headers({ password: args.password, username: args.username })
        : undefined
      const attachSDK = (dir?: string) => {
        return createOpencodeClient({
          baseUrl: args.attach!,
          directory: dir,
          headers: attachHeaders,
        })
      }

      const files: FilePart[] = []
      if (args.file) {
        const list = Array.isArray(args.file) ? args.file : [args.file]

        for (const filePath of list) {
          const resolvedPath = path.resolve(args.attach ? root : (directory ?? root), filePath)
          if (!(await Filesystem.exists(resolvedPath))) {
            UI.error(`File not found: ${filePath}`)
            process.exit(1)
          }

          const mime = (await Filesystem.isDir(resolvedPath)) ? "application/x-directory" : "text/plain"

          files.push({
            type: "file",
            url: pathToFileURL(resolvedPath).href,
            filename: path.basename(resolvedPath),
            mime,
          })
        }
      }

      const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
      message = resolveRunInput(message, piped) ?? ""
      const initialInput = resolveRunInput(rawMessage, piped)

      if (message.trim().length === 0 && !args.command && !args.interactive) {
        UI.error("You must provide a message or a command")
        process.exit(1)
      }

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exit(1)
      }

      const rules: Permission.Ruleset = args.interactive
        ? []
        : [
            {
              permission: "question",
              action: "deny",
              pattern: "*",
            },
            {
              permission: "plan_enter",
              action: "deny",
              pattern: "*",
            },
            {
              permission: "plan_exit",
              action: "deny",
              pattern: "*",
            },
          ]

      function title() {
        if (args.title === undefined) return
        if (args.title !== "") return args.title
        return message.slice(0, 50) + (message.length > 50 ? "..." : "")
      }

      async function session(sdk: OpencodeClient): Promise<SessionInfo | undefined> {
        if (args.session) {
          const current = await sdk.session
            .get({
              sessionID: args.session,
            })
            .catch(() => undefined)

          if (!current?.data) {
            UI.error("Session not found")
            process.exit(1)
          }

          if (args.fork) {
            const forked = await sdk.session.fork({
              sessionID: args.session,
            })
            const id = forked.data?.id
            if (!id) {
              return
            }

            return {
              id,
              title: forked.data?.title ?? current.data.title,
              directory: forked.data?.directory ?? current.data.directory,
            }
          }

          return {
            id: current.data.id,
            title: current.data.title,
            directory: current.data.directory,
          }
        }

        const base = args.continue ? (await sdk.session.list()).data?.find((item) => !item.parentID) : undefined

        if (base && args.fork) {
          const forked = await sdk.session.fork({
            sessionID: base.id,
          })
          const id = forked.data?.id
          if (!id) {
            return
          }

          return {
            id,
            title: forked.data?.title ?? base.title,
            directory: forked.data?.directory ?? base.directory,
          }
        }

        if (base) {
          return {
            id: base.id,
            title: base.title,
            directory: base.directory,
          }
        }

        const name = title()
        const result = await sdk.session.create({
          title: name,
          permission: rules,
        })
        const id = result.data?.id
        if (!id) {
          return
        }

        return {
          id,
          title: result.data?.title ?? name,
          directory: result.data?.directory,
        }
      }

      async function share(sdk: OpencodeClient, sessionID: string) {
        const cfg = await sdk.config.get()
        if (!cfg.data) return
        if (cfg.data.share !== "auto" && !Flag.OPENCODE_AUTO_SHARE && !args.share) return
        const res = await sdk.session.share({ sessionID }).catch((error) => {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          }
          return { error }
        })
        if (!res.error && "data" in res && res.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + res.data.share.url)
        }
      }

      async function createFreshSession(
        sdk: OpencodeClient,
        input: { agent: string | undefined; model: ModelInput | undefined; variant: string | undefined },
      ): Promise<SessionInfo> {
        const result = await sdk.session.create({
          title: args.title !== undefined && args.title !== "" ? args.title : undefined,
          agent: input.agent,
          model: input.model
            ? {
                providerID: input.model.providerID,
                id: input.model.modelID,
                variant: input.variant,
              }
            : undefined,
          permission: rules,
        })
        const id = result.data?.id
        if (!id) {
          throw new Error("Failed to create session")
        }

        void share(sdk, id).catch(() => {})
        return {
          id,
          title: result.data?.title,
        }
      }

      async function current(sdk: OpencodeClient): Promise<string> {
        if (!args.attach) {
          return directory ?? root
        }

        const next = await sdk.path
          .get()
          .then((x) => x.data?.directory)
          .catch(() => undefined)
        if (next) {
          return next
        }

        UI.error("Failed to resolve remote directory")
        process.exit(1)
      }

      async function localAgent() {
        if (!args.agent) return undefined
        const name = args.agent

        const entry = await Effect.runPromise(agentSvc.get(name))
        if (!entry) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (entry.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return name
      }

      async function attachAgent(sdk: OpencodeClient) {
        if (!args.agent) return undefined
        const name = args.agent

        const modes = await sdk.app
          .agents(undefined, { throwOnError: true })
          .then((x) => x.data ?? [])
          .catch(() => undefined)

        if (!modes) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `failed to list agents from ${args.attach}. Falling back to default agent`,
          )
          return undefined
        }

        const agent = modes.find((a) => a.name === name)
        if (!agent) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" not found. Falling back to default agent`,
          )
          return undefined
        }

        if (agent.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }

        return name
      }

      async function pickAgent(sdk: OpencodeClient) {
        if (!args.agent) return undefined
        if (args.attach) {
          return attachAgent(sdk)
        }

        return localAgent()
      }

      async function execute(sdk: OpencodeClient) {
        const sess = await session(sdk)
        if (!sess?.id) {
          UI.error("Session not found")
          process.exit(1)
        }
        const sessionID = sess.id

        function emit(type: string, data: Record<string, unknown>) {
          if (args.format === "json") {
            process.stdout.write(
              JSON.stringify({
                type,
                timestamp: Date.now(),
                sessionID,
                ...data,
              }) + EOL,
            )
            return true
          }
          return false
        }

        // Consume one subscribed event stream for the active session and mirror it
        // to stdout/UI. `client` is passed explicitly because attach mode may
        // rebind the SDK to the session's directory after the subscription is
        // created, and replies issued from inside the loop must use that client.
        async function loop(client: OpencodeClient, events: Awaited<ReturnType<typeof sdk.event.subscribe>>) {
          const toggles = new Map<string, boolean>()
          let error: string | undefined

          for await (const event of events.stream) {
            if (
              event.type === "message.updated" &&
              event.properties.sessionID === sessionID &&
              event.properties.info.role === "assistant" &&
              args.format !== "json" &&
              toggles.get("start") !== true
            ) {
              UI.empty()
              UI.println(`> ${event.properties.info.agent} · ${event.properties.info.modelID}`)
              UI.empty()
              toggles.set("start", true)
            }

            if (event.type === "message.part.updated") {
              const part = event.properties.part
              if (part.sessionID !== sessionID) continue

              if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
                if (emit("tool_use", { part })) continue
                if (part.state.status === "completed") {
                  await tool(part)
                  continue
                }
                await toolError(part)
                UI.error(part.state.error)
              }

              if (
                part.type === "tool" &&
                part.tool === "task" &&
                part.state.status === "running" &&
                args.format !== "json"
              ) {
                if (toggles.get(part.id) === true) continue
                await tool(part)
                toggles.set(part.id, true)
              }

              if (part.type === "step-start") {
                if (emit("step_start", { part })) continue
              }

              if (part.type === "step-finish") {
                if (emit("step_finish", { part })) continue
              }

              if (part.type === "text" && part.time?.end) {
                if (emit("text", { part })) continue
                const text = part.text.trim()
                if (!text) continue
                if (!process.stdout.isTTY) {
                  process.stdout.write(text + EOL)
                  continue
                }
                UI.empty()
                UI.println(text)
                UI.empty()
              }

              if (part.type === "reasoning" && part.time?.end && thinking) {
                if (emit("reasoning", { part })) continue
                const text = part.text.trim()
                if (!text) continue
                const line = `Thinking: ${text}`
                if (process.stdout.isTTY) {
                  UI.empty()
                  UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
                  UI.empty()
                  continue
                }
                process.stdout.write(line + EOL)
              }
            }

            if (event.type === "session.error") {
              const props = event.properties
              if (props.sessionID !== sessionID || !props.error) continue
              let err = String(props.error.name)
              if ("data" in props.error && props.error.data && "message" in props.error.data) {
                err = String(props.error.data.message)
              }
              error = error ? error + EOL + err : err
              if (emit("error", { error: props.error })) continue
              UI.error(err)
            }

            if (
              event.type === "session.status" &&
              event.properties.sessionID === sessionID &&
              event.properties.status.type === "idle"
            ) {
              break
            }

            if (event.type === "permission.asked") {
              const permission = event.properties
              if (permission.sessionID !== sessionID) continue

              if (args["dangerously-skip-permissions"]) {
                await client.permission.reply({
                  requestID: permission.id,
                  reply: "once",
                })
              } else {
                UI.println(
                  UI.Style.TEXT_WARNING_BOLD + "!",
                  UI.Style.TEXT_NORMAL +
                    `permission requested: ${permission.permission} (${permission.patterns.join(", ")}); auto-rejecting`,
                )
                await client.permission.reply({
                  requestID: permission.id,
                  reply: "reject",
                })
              }
            }
          }
        }
        const cwd = args.attach ? (directory ?? sess.directory ?? (await current(sdk))) : (directory ?? root)
        const client = args.attach ? attachSDK(cwd) : sdk

        // Validate agent if specified
        const agent = await pickAgent(client)

        await share(client, sessionID)

        if (!args.interactive) {
          const events = await client.event.subscribe()
          loop(client, events).catch((e) => {
            console.error(e)
            process.exit(1)
          })

          if (args.command) {
            await client.session.command({
              sessionID,
              agent,
              model: args.model,
              command: args.command,
              arguments: message,
              variant: args.variant,
            })
            return
          }

          const model = pick(args.model)
          await client.session.prompt({
            sessionID,
            agent,
            model,
            variant: args.variant,
            parts: [...files, { type: "text", text: message }],
          })
          return
        }

        const model = pick(args.model)
        const { runInteractiveMode } = await runtimeTask
        try {
          await runInteractiveMode({
            sdk: client,
            directory: cwd,
            sessionID,
            sessionTitle: sess.title,
            resume: Boolean(args.session || args.continue) && !args.fork,
            agent,
            model,
            variant: args.variant,
            files,
            initialInput,
            createSession: createFreshSession,
            thinking,
            demo: args.demo,
          })
        } catch (error) {
          dieInteractive(error)
        }
        return
      }

      if (args.interactive && !args.attach && !args.session && !args.continue) {
        const model = pick(args.model)
        const { runInteractiveLocalMode } = await runtimeTask
        const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const { Server } = await import("@/server/server")
          const request = new Request(input, init)
          return Server.Default().app.fetch(request)
        }) as typeof globalThis.fetch

        try {
          return await runInteractiveLocalMode({
            directory: directory ?? root,
            fetch: fetchFn,
            resolveAgent: localAgent,
            session,
            share,
            createSession: createFreshSession,
            agent: args.agent,
            model,
            variant: args.variant,
            files,
            initialInput,
            thinking,
            demo: args.demo,
          })
        } catch (error) {
          dieInteractive(error)
        }
      }

      if (args.attach) {
        const sdk = attachSDK(directory)
        return await execute(sdk)
      }

      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const { Server } = await import("@/server/server")
        const request = new Request(input, init)
        return Server.Default().app.fetch(request)
      }) as typeof globalThis.fetch
      const sdk = createOpencodeClient({
        baseUrl: "http://opencode.internal",
        fetch: fetchFn,
        directory,
      })
      await execute(sdk)
    })
  }),
})
