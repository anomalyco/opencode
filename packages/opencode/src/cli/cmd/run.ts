import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
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
import { EOL } from "os"
import { Filesystem } from "@/util/filesystem"
import { createOpencodeClient, type OpencodeClient, type Part as SessionPart, type ToolPart } from "@opencode-ai/sdk/v2"
import { FormatError, FormatUnknownError } from "../error"
import { INTERACTIVE_INPUT_ERROR, resolveInteractiveStdin } from "./run/runtime.stdin"

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

function formatRunError(error: unknown) {
  return FormatError(error) ?? FormatUnknownError(error)
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
      .option("replay", {
        type: "boolean",
        default: true,
        describe: "replay interactive session history on resume and after resize (use --no-replay to disable)",
      })
      .option("replay-limit", {
        type: "number",
        describe: "cap visible interactive replay to the newest N messages",
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
    const { Agent } = yield* Effect.promise(() => import("@/agent/agent"))
    const { RuntimeFlags } = yield* Effect.promise(() => import("@/effect/runtime-flags"))
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { ServerAuth } = yield* Effect.promise(() => import("@/server/auth"))
    const agentSvc = yield* Agent.Service
    const flags = yield* RuntimeFlags.Service
    const localInstance = yield* InstanceRef
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

      if (args["replay-limit"] !== undefined && !args.interactive) {
        die("--replay-limit requires --interactive")
      }

      if (
        args["replay-limit"] !== undefined &&
        (!Number.isInteger(args["replay-limit"]) || args["replay-limit"] <= 0)
      ) {
        die("--replay-limit must be a positive integer")
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

      const replay = args.replay || args["replay-limit"] !== undefined

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

      const rules: PermissionV1.Ruleset = args.interactive
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
          permission: [...rules],
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
        if (cfg.data.share !== "auto" && !flags.autoShare && !args.share) return
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
          permission: [...rules],
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

        const entry = await Effect.runPromise(
          agentSvc.get(name).pipe(Effect.provideService(InstanceRef, localInstance)),
        )
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

        // Track which part IDs we've already written to stdout so we don't
        // double-print when both deltas and the final part.updated arrive.
        // Hoisted to the execute() scope so the post-prompt belt-and-suspenders
        // flush (flushFinalParts) can see what the event loop already covered.
        const emitted = new Set<string>()
        // Set when ANY assistant text or reasoning has reached stdout. Used to
        // distinguish a genuinely-empty assistant response (LLM returned no
        // content — common with thinking-mode models when max_tokens is small,
        // or when an upstream provider returns 2xx + empty body) from a normal
        // successful turn. We surface a stderr warning when this stays false,
        // because silent exit-0 is the worst possible UX for CLI callers.
        let anyTextEmitted = false

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

        // Emit one streaming delta — called from the message.part.delta branch.
        // In json mode we forward each delta as its own NDJSON line so JSON
        // consumers can render text token-by-token. In default text mode we
        // print the raw delta directly to stdout with no decoration (this is
        // what a terminal user expects: progressive output as it generates).
        // Reasoning deltas are printed dimmed in TTY mode and only when
        // --thinking is set, otherwise they're suppressed (json consumers
        // still get them because they explicitly subscribed to the JSON stream).
        function emitDelta(partID: string, messageID: string, field: string, delta: string) {
          if (args.format === "json") {
            process.stdout.write(
              JSON.stringify({
                type: "delta",
                timestamp: Date.now(),
                sessionID,
                messageID,
                partID,
                field,
                delta,
              }) + EOL,
            )
            emitted.add(partID)
            if (field === "text") anyTextEmitted = true
            return
          }
          if (field === "text") {
            process.stdout.write(delta)
            emitted.add(partID)
            anyTextEmitted = true
            return
          }
          if (field === "reasoning" && thinking) {
            if (process.stdout.isTTY) {
              process.stdout.write(`${UI.Style.TEXT_DIM}${delta}${UI.Style.TEXT_NORMAL}`)
            } else {
              process.stdout.write(delta)
            }
            emitted.add(partID)
            return
          }
        }

        // Belt-and-suspenders: after session.prompt/command returns, walk the
        // assistant message's final parts list and print anything we didn't
        // already cover via deltas/updates. This catches the race where the
        // server emits the final text part right at (or after) session.idle —
        // sometimes the part-updated event arrives just after our loop breaks
        // on the idle status, and we'd otherwise drop the answer on the floor.
        function flushFinalParts(parts: SessionPart[] | undefined) {
          if (!parts) return
          for (const part of parts) {
            if (emitted.has(part.id)) continue
            if (part.type === "text") {
              const text = (part.text ?? "").trim()
              if (!text) continue
              if (emit("text", { part })) {
                emitted.add(part.id)
                anyTextEmitted = true
                continue
              }
              if (!process.stdout.isTTY) {
                process.stdout.write(text + EOL)
              } else {
                UI.empty()
                UI.println(text)
                UI.empty()
              }
              emitted.add(part.id)
              anyTextEmitted = true
              continue
            }
            if (part.type === "reasoning" && thinking) {
              const text = (part.text ?? "").trim()
              if (!text) continue
              if (emit("reasoning", { part })) {
                emitted.add(part.id)
                continue
              }
              const line = `Thinking: ${text}`
              if (process.stdout.isTTY) {
                UI.empty()
                UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
                UI.empty()
              } else {
                process.stdout.write(line + EOL)
              }
              emitted.add(part.id)
            }
          }
        }

        // Surface the silent-empty case to stderr. We intentionally do NOT
        // change process.exitCode here by default — that's a behavior change
        // existing callers might not expect. Operators can opt into a non-zero
        // exit via OPENCODE_RUN_EXIT_ON_EMPTY=1, which is useful for CI/CD
        // pipelines that want to fail loudly when the model returned nothing.
        function warnIfEmpty() {
          if (anyTextEmitted) return
          // Json consumers can detect the no-text case themselves; skip the
          // warning to keep their stdout/stderr clean and machine-parseable.
          if (args.format === "json") return
          process.stderr.write(
            "[opencode run] WARNING: model returned no assistant text. " +
              "This usually means the provider responded with an empty completion " +
              "(thinking-mode models can consume the full max_tokens on internal reasoning " +
              "leaving no budget for output, and some upstream proxies return 2xx-empty " +
              "on transient backend errors). Retry, raise max_tokens, or check the provider.\n",
          )
          if (process.env.OPENCODE_RUN_EXIT_ON_EMPTY === "1") {
            process.exitCode = 2
          }
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

            // Streaming deltas: write each chunk to stdout as it arrives so
            // CLI users see progressive output during long generations instead
            // of staring at a blank terminal until the part finalizes. emitDelta
            // marks the partID in `emitted` so the matching part.updated branch
            // below knows the content was already shown and skips re-printing.
            if (event.type === "message.part.delta") {
              const props = event.properties
              if (props.sessionID !== sessionID) continue
              if (typeof props.partID !== "string") continue
              if (typeof props.field !== "string") continue
              if (typeof props.delta !== "string" || props.delta === "") continue
              emitDelta(props.partID, props.messageID, props.field, props.delta)
              continue
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
                // If we already streamed the body via deltas, the part-updated
                // event is a no-op for stdout. We still emit the json line so
                // json consumers get the canonical part-completion record.
                if (args.format === "json") {
                  emit("text", { part })
                  emitted.add(part.id)
                  if (part.text && part.text.trim()) anyTextEmitted = true
                  continue
                }
                if (emitted.has(part.id)) {
                  process.stdout.write(EOL)
                  continue
                }
                const text = part.text.trim()
                if (!text) continue
                if (!process.stdout.isTTY) {
                  process.stdout.write(text + EOL)
                } else {
                  UI.empty()
                  UI.println(text)
                  UI.empty()
                }
                emitted.add(part.id)
                anyTextEmitted = true
                continue
              }

              if (part.type === "reasoning" && part.time?.end && thinking) {
                if (args.format === "json") {
                  emit("reasoning", { part })
                  emitted.add(part.id)
                  continue
                }
                if (emitted.has(part.id)) {
                  process.stdout.write(EOL)
                  continue
                }
                const text = part.text.trim()
                if (!text) continue
                const line = `Thinking: ${text}`
                if (process.stdout.isTTY) {
                  UI.empty()
                  UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
                  UI.empty()
                } else {
                  process.stdout.write(line + EOL)
                }
                emitted.add(part.id)
                continue
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
          return error
        }
        const cwd = args.attach ? (directory ?? sess.directory ?? (await current(sdk))) : (directory ?? root)
        const client = args.attach ? attachSDK(cwd) : sdk

        // Validate agent if specified
        const agent = await pickAgent(client)

        await share(client, sessionID)

        if (!args.interactive) {
          const events = await client.event.subscribe()
          const completed = loop(client, events).catch((e) => {
            console.error(e)
            process.exitCode = 1
          })
          async function finish() {
            if (args.attach) return
            const error = await completed
            if (error) process.exitCode = 1
          }

          if (args.command) {
            const result = await client.session.command({
              sessionID,
              agent,
              model: args.model,
              command: args.command,
              arguments: message,
              variant: args.variant,
            })
            if (result.error) {
              if (!emit("error", { error: result.error })) UI.error(formatRunError(result.error))
              process.exitCode = 1
              return
            }
            await finish()
            // Belt-and-suspenders flush: emit any final parts the loop may have
            // missed because session.idle fired before the matching part.updated
            // event reached our subscription. Without this the model's final
            // answer can race past the loop break and end up only in the DB.
            flushFinalParts(result.data?.parts)
            warnIfEmpty()
            return
          }

          const model = pick(args.model)
          const result = await client.session.prompt({
            sessionID,
            agent,
            model,
            variant: args.variant,
            parts: [...files, { type: "text", text: message }],
          })
          if (result.error) {
            if (!emit("error", { error: result.error })) UI.error(formatRunError(result.error))
            process.exitCode = 1
            return
          }
          await finish()
          flushFinalParts(result.data?.parts)
          warnIfEmpty()
          return
        }

        const model = pick(args.model)
        const { runInteractiveMode } = await import("./run/runtime")
        try {
          await runInteractiveMode({
            sdk: client,
            directory: cwd,
            sessionID,
            sessionTitle: sess.title,
            resume: Boolean(args.session || args.continue) && !args.fork,
            replay,
            replayLimit: args["replay-limit"],
            agent,
            model,
            variant: args.variant,
            files,
            initialInput,
            createSession: createFreshSession,
            thinking,
            backgroundSubagents: flags.experimentalBackgroundSubagents,
            demo: args.demo,
          })
        } catch (error) {
          dieInteractive(error)
        }
        return
      }

      if (args.interactive && !args.attach && !args.session && !args.continue) {
        const model = pick(args.model)
        const { runInteractiveLocalMode } = await import("./run/runtime")
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
            replay,
            replayLimit: args["replay-limit"],
            files,
            initialInput,
            thinking,
            backgroundSubagents: flags.experimentalBackgroundSubagents,
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
