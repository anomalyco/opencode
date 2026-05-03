import { createInterface } from "readline/promises"
import { EOL } from "os"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { inline, renderRunningTask, renderTool } from "./render"

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

    if (process.stdout.isTTY) {
      process.stdout.write(
        UI.Style.TEXT_DIM +
          `opencode · session ${sessionID.slice(-6)} · ctrl+d to exit · :q or /exit to quit` +
          UI.Style.TEXT_NORMAL +
          EOL,
      )
      process.stdout.write(EOL)
    }

    if (opts.initialPrompt && opts.initialPrompt.trim().length > 0) {
      await turn(sdk, sessionID, opts, opts.initialPrompt.trim())
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdout.isTTY === true,
    })

    while (true) {
      const line = await rl.question(UI.Style.TEXT_HIGHLIGHT_BOLD + "» " + UI.Style.TEXT_NORMAL).catch(() => undefined)
      if (line === undefined) break
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed === ":q" || trimmed === "/exit" || trimmed === "/quit") break

      await turn(sdk, sessionID, opts, trimmed).catch((e) => {
        UI.error(e instanceof Error ? e.message : String(e))
      })
    }
    rl.close()
    if (process.stdout.isTTY) process.stdout.write(EOL)
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

async function turn(sdk: OpencodeClient, sessionID: string, opts: ReplOptions, message: string): Promise<void> {
  const events = await sdk.event.subscribe()

  const consume = (async () => {
    const toggles = new Map<string, boolean>()
    for await (const event of events.stream) {
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.sessionID !== sessionID) continue

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
          UI.println(text)
          UI.empty()
        }

        if (part.type === "reasoning" && part.time?.end && opts.thinking) {
          const text = part.text.trim()
          if (!text) continue
          UI.empty()
          UI.println(`${UI.Style.TEXT_DIM}[3mThinking: ${text}[0m${UI.Style.TEXT_NORMAL}`)
          UI.empty()
        }
      }

      if (event.type === "session.error") {
        const props = event.properties
        if (props.sessionID !== sessionID || !props.error) continue
        let err = String(props.error.name)
        if ("data" in props.error && props.error.data && "message" in props.error.data) {
          err = String(props.error.data.message)
        }
        UI.error(err)
      }

      if (
        event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "idle"
      ) {
        return
      }

      if (event.type === "permission.asked") {
        const permission = event.properties
        if (permission.sessionID !== sessionID) continue
        await sdk.permission.reply({
          requestID: permission.id,
          reply: "once",
        })
      }
    }
  })()

  const model = opts.model ? Provider.parseModel(opts.model) : undefined
  await sdk.session
    .prompt({
      sessionID,
      agent: opts.agent,
      model,
      variant: opts.variant,
      parts: [{ type: "text", text: message }],
    })
    .catch((e) => {
      UI.error(e instanceof Error ? e.message : String(e))
    })

  await consume
}
