import { createInterface } from "readline/promises"
import { EOL } from "os"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { colorizeCode, colorizeDiff, initHighlighter, inline, isDiff, renderRunningTask, renderTool } from "./minimal-render"

const SLASH_COMMANDS = [
  "help",
  "exit",
  "quit",
  "clear",
  "model",
  "agent",
  "thinking",
  "sessions",
  "share",
  "unshare",
  "fork",
  "new",
  "undo",
  "redo",
  "compact",
  "summarize",
  "rename",
  "timeline",
  "timestamps",
  "copy",
  "export",
  "debug-shiki",
]

function completer(line: string): [string[], string] {
  if (!line.startsWith("/") && !line.startsWith(":")) {
    return [[], line]
  }
  const partial = line.slice(1).toLowerCase()
  const hits = SLASH_COMMANDS.filter((cmd) => cmd.startsWith(partial)).map((cmd) => "/" + cmd)
  return [hits.length ? hits : SLASH_COMMANDS.map((cmd) => "/" + cmd), line]
}

export type ReplOptions = {
  directory: string
  agent?: string
  model?: string
  variant?: string
  continueLast?: boolean
  sessionID?: string
  initialPrompt?: string
  thinking?: boolean
}

type State = {
  sessionID: string
  agent?: string
  model?: string
  variant?: string
  thinking: boolean
  timestamps: boolean
}

export async function repl(opts: ReplOptions): Promise<void> {
  await bootstrap(opts.directory, async () => {
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      return Server.Default().app.fetch(request)
    }) as typeof globalThis.fetch
    const sdk = createOpencodeClient({ baseUrl: "http://opencode.internal", fetch: fetchFn })

    const sessionID = await initSession(sdk, opts)
    if (!sessionID) {
      UI.error("Failed to initialize session")
      process.exitCode = 1
      return
    }

    const { data: cfg } = await sdk.config.get()
    if (!cfg) {
      UI.error("Failed to load configuration")
      return
    }

    // Setup Agent
    const agentName = opts.agent || cfg.default_agent || "build"

    // Setup Model
    const modelId = opts.model || cfg.model || "opencode/minimax-m2.5-free"

    void initHighlighter()

    const state: State = {
      sessionID,
      agent: agentName,
      model: modelId,
      variant: opts.variant,
      thinking: opts.thinking ?? false,
      timestamps: false,
    }

    if (process.stdout.isTTY) {
      process.stdout.write(UI.Style.TEXT_DIM + "opencode" + EOL)
      process.stdout.write(
        `session ${state.sessionID.slice(-6)} · model ${state.model || "default"} · Tab to autocomplete` + EOL,
      )
      process.stdout.write(`ctrl+d to exit · /help for commands` + UI.Style.TEXT_NORMAL + EOL)
      process.stdout.write(EOL)
    }

    if (opts.initialPrompt && opts.initialPrompt.trim().length > 0) {
      await turn(sdk, state, opts.initialPrompt.trim())
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdout.isTTY === true,
      completer,
    })

    while (true) {
      const line = await rl.question(UI.Style.TEXT_HIGHLIGHT_BOLD + "» " + UI.Style.TEXT_NORMAL).catch(() => undefined)
      if (line === undefined) break
      const trimmed = line.trim()
      if (!trimmed) continue

      const isCommand = trimmed.startsWith("/") || trimmed.startsWith(":")
      if (isCommand) {
        const result = await dispatch(sdk, state, trimmed).catch((e) => {
          UI.error(e instanceof Error ? e.message : String(e))
          return "handled" as const
        })
        if (result === "exit") break
        if (result === "handled") continue
      }

      await turn(sdk, state, trimmed).catch((e) => {
        UI.error(e instanceof Error ? e.message : String(e))
      })
    }
    rl.close()
    if (process.stdout.isTTY) process.stdout.write(EOL)
    process.exit(0)
  })
}

async function initSession(sdk: OpencodeClient, opts: ReplOptions): Promise<string | undefined> {
  if (opts.sessionID) return opts.sessionID
  if (opts.continueLast) {
    const list = await sdk.session.list()
    const last = list.data?.find((s) => !s.parentID)
    if (last) return last.id
  }
  const result = await sdk.session.create({})
  return result.data?.id
}

async function dispatch(sdk: OpencodeClient, state: State, line: string): Promise<"exit" | "handled"> {
  const body = line.slice(1)
  const [name, ...rest] = body.split(/\s+/)
  const args = rest.join(" ").trim()

  if (!name) return "handled"

  if (name === "q" || name === "exit" || name === "quit") return "exit"

  if (name === "help" || name === "?") {
    UI.println(UI.Style.TEXT_DIM + "Commands:" + UI.Style.TEXT_NORMAL)
    UI.println("  /help              show this help")
    UI.println("  /exit, /quit, :q   leave the REPL")
    UI.println("  /clear             clear the screen")
    UI.println("")
    UI.println(UI.Style.TEXT_DIM + "Session:" + UI.Style.TEXT_NORMAL)
    UI.println("  /new               create a new session")
    UI.println("  /sessions          list recent sessions")
    UI.println("  /undo              undo previous message")
    UI.println("  /redo              redo reverted message")
    UI.println("  /compact           compact/summarize session")
    UI.println("  /rename            rename current session")
    UI.println("  /fork              fork current session")
    UI.println("  /timeline          jump to a message")
    UI.println("  /share             share current session")
    UI.println("  /unshare           stop sharing session")
    UI.println("  /copy              copy session transcript")
    UI.println("  /export            export session to file")
    UI.println("")
    UI.println(UI.Style.TEXT_DIM + "Settings:" + UI.Style.TEXT_NORMAL)
    UI.println("  /model [name]      show or switch model")
    UI.println("  /agent [name]      show or switch agent")
    UI.println("  /thinking          toggle reasoning display")
    UI.println("  /timestamps        toggle timestamps")
    UI.println("")
    UI.println(UI.Style.TEXT_DIM + "Other:" + UI.Style.TEXT_NORMAL)
    UI.println("  /<command>         run a user-defined opencode command")
    UI.println("  Tab                autocomplete slash commands")
    return "handled"
  }

  if (name === "clear") {
    if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H")
    return "handled"
  }

  if (name === "thinking") {
    state.thinking = !state.thinking
    UI.println(UI.Style.TEXT_DIM + `thinking ${state.thinking ? "on" : "off"}` + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "model") {
    if (!args) {
      const cfg = await sdk.config.providers().catch(() => undefined)
      const providers = cfg?.data?.providers ?? []
      UI.println(UI.Style.TEXT_DIM + `current: ${state.model ?? "(default)"}` + UI.Style.TEXT_NORMAL)
      for (const p of providers) {
        const ids = Object.keys(p.models)
        if (!ids.length) continue
        UI.println(UI.Style.TEXT_HIGHLIGHT + p.id + UI.Style.TEXT_NORMAL)
        for (const id of ids) UI.println("  " + p.id + "/" + id)
      }
      return "handled"
    }
    state.model = args
    UI.println(UI.Style.TEXT_DIM + `model → ${args}` + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "agent") {
    if (!args) {
      const list = await sdk.app.agents().catch(() => undefined)
      const agents = list?.data ?? []
      UI.println(UI.Style.TEXT_DIM + `current: ${state.agent ?? "(default)"}` + UI.Style.TEXT_NORMAL)
      for (const a of agents) {
        if (a.mode === "subagent") continue
        UI.println("  " + a.name)
      }
      return "handled"
    }
    state.agent = args
    UI.println(UI.Style.TEXT_DIM + `agent → ${args}` + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "sessions") {
    const list = await sdk.session.list().catch(() => undefined)
    const sessions = (list?.data ?? []).filter((s) => !s.parentID).slice(0, 20)
    if (!sessions.length) {
      UI.println(UI.Style.TEXT_DIM + "no sessions" + UI.Style.TEXT_NORMAL)
      return "handled"
    }
    for (const s of sessions) {
      const marker = s.id === state.sessionID ? "*" : " "
      const title = s.title ?? "(untitled)"
      UI.println(`${marker} ${s.id.slice(-6)}  ${title}`)
    }
    return "handled"
  }

  if (name === "share") {
    const res = await sdk.session.share({ sessionID: state.sessionID }).catch((error) => ({ error }))
    if (res.error) {
      UI.error(res.error instanceof Error ? res.error.message : String(res.error))
      return "handled"
    }
    if ("data" in res && res.data?.share?.url) {
      UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + res.data.share.url + UI.Style.TEXT_NORMAL)
    }
    return "handled"
  }

  if (name === "unshare") {
    await sdk.session
      .unshare({ sessionID: state.sessionID })
      .catch((e) => UI.error(e instanceof Error ? e.message : String(e)))
    UI.println(UI.Style.TEXT_DIM + "unshared" + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "fork") {
    const res = await sdk.session.fork({ sessionID: state.sessionID }).catch((error) => ({ error }))
    if (res.error) {
      UI.error(res.error instanceof Error ? res.error.message : String(res.error))
      return "handled"
    }
    const next = "data" in res ? res.data?.id : undefined
    if (!next) {
      UI.error("fork failed: no session id returned")
      return "handled"
    }
    state.sessionID = next
    UI.println(UI.Style.TEXT_DIM + `forked → ${next.slice(-6)}` + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "new") {
    const res = await sdk.session.create({}).catch((error) => ({ error }))
    if (res.error) {
      UI.error(res.error instanceof Error ? res.error.message : String(res.error))
      return "handled"
    }
    const next = "data" in res ? res.data?.id : undefined
    if (!next) {
      UI.error("failed to create session")
      return "handled"
    }
    state.sessionID = next
    UI.println(UI.Style.TEXT_DIM + `new session → ${next.slice(-6)}` + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "undo") {
    const list = await sdk.session.messages({ sessionID: state.sessionID }).catch(() => undefined)
    const messages = (list?.data ?? []).filter((m) => m.info.role === "user")
    if (!messages.length) {
      UI.println(UI.Style.TEXT_DIM + "no messages to undo" + UI.Style.TEXT_NORMAL)
      return "handled"
    }
    const last = messages[messages.length - 1]
    await sdk.session
      .revert({ sessionID: state.sessionID, messageID: last.info.id })
      .catch((e) => UI.error(e instanceof Error ? e.message : String(e)))
    UI.println(UI.Style.TEXT_DIM + "undone" + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "redo") {
    const info = await sdk.session.get({ sessionID: state.sessionID }).catch(() => undefined)
    const revertID = info?.data?.revert?.messageID
    if (!revertID) {
      UI.println(UI.Style.TEXT_DIM + "nothing to redo" + UI.Style.TEXT_NORMAL)
      return "handled"
    }
    await sdk.session
      .unrevert({ sessionID: state.sessionID })
      .catch((e) => UI.error(e instanceof Error ? e.message : String(e)))
    UI.println(UI.Style.TEXT_DIM + "redone" + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "compact" || name === "summarize") {
    const cfg = await sdk.config.providers().catch(() => undefined)
    const providers = cfg?.data?.providers ?? []
    const modelStr = state.model
    let modelID: string | undefined
    let providerID: string | undefined
    if (modelStr) {
      const parsed = Provider.parseModel(modelStr)
      providerID = parsed?.providerID
      modelID = parsed?.modelID
    }
    if (!modelID || !providerID) {
      // Try to find first available model
      for (const p of providers) {
        const ids = Object.keys(p.models)
        if (ids.length) {
          providerID = p.id
          modelID = ids[0]
          break
        }
      }
    }
    if (!modelID || !providerID) {
      UI.error("no model available for compaction")
      return "handled"
    }
    await sdk.session
      .summarize({ sessionID: state.sessionID, modelID, providerID })
      .catch((e) => UI.error(e instanceof Error ? e.message : String(e)))
    UI.println(UI.Style.TEXT_DIM + "compacting..." + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "rename") {
    if (!args) {
      UI.error("usage: /rename <new title>")
      return "handled"
    }
    await sdk.session
      .update({ sessionID: state.sessionID, title: args })
      .catch((e) => UI.error(e instanceof Error ? e.message : String(e)))
    UI.println(UI.Style.TEXT_DIM + `renamed → ${args}` + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "timeline") {
    const list = await sdk.session.messages({ sessionID: state.sessionID }).catch(() => undefined)
    const messages = (list?.data ?? []).filter((m) => m.info.role === "user")
    if (!messages.length) {
      UI.println(UI.Style.TEXT_DIM + "no messages" + UI.Style.TEXT_NORMAL)
      return "handled"
    }
    UI.println(UI.Style.TEXT_DIM + "Messages:" + UI.Style.TEXT_NORMAL)
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      const msg = await sdk.session
        .message({ sessionID: state.sessionID, messageID: m.info.id })
        .catch(() => undefined)
      const text = (msg?.data?.parts ?? [])
        .filter((p) => p.type === "text" && !(p as any).synthetic)
        .map((p) => (p as any).text)
        .join(" ")
        .slice(0, 80)
      UI.println(`  ${i + 1}. ${text || "(no text)"}`)
    }
    return "handled"
  }

  if (name === "timestamps") {
    state.timestamps = !state.timestamps
    UI.println(UI.Style.TEXT_DIM + `timestamps ${state.timestamps ? "on" : "off"}` + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "copy") {
    const messages = await sdk.session.messages({ sessionID: state.sessionID }).catch(() => undefined)
    const parts: string[] = []
    for (const m of messages?.data ?? []) {
      const msg = await sdk.session
        .message({ sessionID: state.sessionID, messageID: m.info.id })
        .catch(() => undefined)
      for (const p of msg?.data?.parts ?? []) {
        if (p.type === "text" && !(p as any).synthetic) {
          parts.push((p as any).text)
        }
      }
    }
    const transcript = parts.join("\n\n")
    if (transcript) {
      process.stdout.write(transcript)
      UI.println("")
      UI.println(UI.Style.TEXT_DIM + "transcript written to stdout" + UI.Style.TEXT_NORMAL)
    } else {
      UI.println(UI.Style.TEXT_DIM + "no content to copy" + UI.Style.TEXT_NORMAL)
    }
    return "handled"
  }

  if (name === "export") {
    const filename = args || `session-${state.sessionID.slice(0, 8)}.md`
    const messages = await sdk.session.messages({ sessionID: state.sessionID }).catch(() => undefined)
    const sections: string[] = []
    for (const m of messages?.data ?? []) {
      const msg = await sdk.session
        .message({ sessionID: state.sessionID, messageID: m.info.id })
        .catch(() => undefined)
      const role = m.info.role === "user" ? "## User" : "## Assistant"
      const texts = (msg?.data?.parts ?? [])
        .filter((p) => p.type === "text" && !(p as any).synthetic)
        .map((p) => (p as any).text)
      if (texts.length) {
        sections.push(`${role}\n\n${texts.join("\n\n")}`)
      }
    }
    const { writeFileSync } = await import("fs")
    const { join } = await import("path")
    const filepath = join(process.cwd(), filename)
    writeFileSync(filepath, sections.join("\n\n---\n\n"), "utf-8")
    UI.println(UI.Style.TEXT_DIM + `exported → ${filename}` + UI.Style.TEXT_NORMAL)
    return "handled"
  }

  if (name === "debug-shiki") {
    UI.println(colorizeCode("const x = 1;\nconsole.log(x);", "typescript"))
    return "handled"
  }

  // Unknown — try as a user-defined opencode command.
  await consumeUntilIdle(sdk, state, () =>
    sdk.session.command({
      sessionID: state.sessionID,
      agent: state.agent,
      model: state.model,
      variant: state.variant,
      command: name,
      arguments: args,
    }),
  )
  return "handled"
}

async function turn(sdk: OpencodeClient, state: State, message: string): Promise<void> {
  await consumeUntilIdle(sdk, state, () => {
    const model = state.model ? Provider.parseModel(state.model) : undefined
    return sdk.session.prompt({
      sessionID: state.sessionID,
      agent: state.agent,
      model,
      variant: state.variant,
      parts: [{ type: "text", text: message }],
    })
  })
}

async function consumeUntilIdle(sdk: OpencodeClient, state: State, send: () => Promise<unknown>): Promise<void> {
  const abort = new AbortController()
  const events = await sdk.event.subscribe(undefined, { signal: abort.signal })

  const consume = (async () => {
    const toggles = new Map<string, boolean>()
    for await (const event of events.stream) {
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.sessionID !== state.sessionID) continue

        if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
          if (part.state.status === "completed") {
            renderTool(part)
            continue
          }
          inline({ icon: "✗", title: `${part.tool} failed` })
          UI.error(part.state.error)
        }

        if (part.type === "tool" && part.tool === "task" && part.state.status === "running") {
          if (toggles.get(part.id) === true) continue
          renderRunningTask(part)
          toggles.set(part.id, true)
        }

        if (part.type === "text" && part.time?.end) {
          const text = part.text.trim()
          if (!text) continue
          UI.empty()
          if (state.timestamps && part.time?.start) {
            const ts = new Date(part.time.start).toLocaleTimeString()
            UI.println(UI.Style.TEXT_DIM + `[${ts}]` + UI.Style.TEXT_NORMAL)
          }

          // Handle code blocks in text with syntax highlighting
          if (text.includes("```")) {
            const segments = text.split(/(```[\s\S]*?```)/g)
            for (const segment of segments) {
              if (segment.startsWith("```")) {
                const match = segment.match(/```(\w*)\n?([\s\S]*?)\n?```/)
                const lang = match?.[1] || ""
                const content = (match?.[2] || "").trim()

                if (lang === "diff" || isDiff(content)) {
                  UI.println(colorizeDiff(content))
                } else if (content) {
                  UI.println(colorizeCode(content, lang))
                }
              } else if (segment.trim()) {
                UI.println(segment.trim())
              }
            }
          } else if (isDiff(text)) {
            UI.println(colorizeDiff(text))
          } else {
            UI.println(text)
          }
          UI.empty()
        }

        if (part.type === "reasoning" && part.time?.end && state.thinking) {
          const text = part.text.trim()
          if (!text) continue
          UI.empty()
          UI.println(`${UI.Style.TEXT_DIM}[3mThinking: ${text}[0m${UI.Style.TEXT_NORMAL}`)
          UI.empty()
        }
      }

      if (event.type === "session.error") {
        const props = event.properties
        if (props.sessionID !== state.sessionID || !props.error) continue
        let err = String(props.error.name)
        if ("data" in props.error && props.error.data && "message" in props.error.data) {
          err = String(props.error.data.message)
        }
        UI.error(err)
      }

      if (
        event.type === "session.status" &&
        event.properties.sessionID === state.sessionID &&
        event.properties.status.type === "idle"
      ) {
        return
      }

      if (event.type === "permission.asked") {
        const permission = event.properties
        if (permission.sessionID !== state.sessionID) continue
        await sdk.permission.reply({
          requestID: permission.id,
          reply: "once",
        })
      }
    }
  })().catch(() => undefined)

  const sendError = await send().then(() => undefined).catch((e) => e)
  if (sendError) {
    UI.error(sendError instanceof Error ? sendError.message : String(sendError))
    abort.abort()
    return
  }

  await consume
}
