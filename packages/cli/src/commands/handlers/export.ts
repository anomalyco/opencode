import { OpenCode, type SessionInfo } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { emitKeypressEvents, type Key } from "node:readline"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(
  Commands.commands.export,
  Effect.fn("cli.export")(function* (input) {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({
      baseUrl: server.endpoint.url,
      headers: Service.headers(server.endpoint),
    })
    const requested = Option.getOrUndefined(input.session)
    const sessionID = requested
      ? requested
      : yield* Effect.promise(async () => {
          const location = await client.location.get({ location: { directory: process.cwd() } })
          const page = await client.session.list({
            directory: location.directory,
            workspace: location.workspaceID,
            parentID: null,
            order: "desc",
            limit: 50,
          })
          if (page.data.length === 0) throw new Error("No sessions found")
          return (await selectSession(page.data))?.id
        })
    if (!sessionID) return
    const data = yield* Effect.promise(() => client.session.export({ sessionID }))
    process.stdout.write(JSON.stringify(data, null, 2) + EOL)
  }),
)

function selectSession(sessions: SessionInfo[]) {
  if (!process.stdin.isTTY) return Promise.reject(new Error("Session ID is required when stdin is not interactive"))
  const input = process.stdin
  const output = process.stderr
  const wasRaw = input.isRaw
  const wasPaused = input.isPaused()
  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  const columns = output.columns ?? 100
  const titleWidth = Math.max(8, Math.min(48, columns - 34))
  let selected = 0
  let offset = 0
  let height = 0

  const render = () => {
    const visible = sessions.slice(offset, offset + 10)
    const lines = ["  \x1b[36mExport session\x1b[0m", ""]
    lines.push(
      ...visible.map((session) => {
        const index = sessions.indexOf(session)
        const title = (session.title ?? "Untitled session").slice(0, titleWidth).padEnd(titleWidth)
        const updated = date.format(session.time.updated).slice(0, 18).padEnd(18)
        const row = `${index === selected ? ">" : " "} ${title}  ${updated}  ${session.id.slice(-8)}`
        return index === selected ? `\x1b[1m${row}\x1b[0m` : row
      }),
      "",
      "  navigate \x1b[2mup/down\x1b[0m   export \x1b[2menter\x1b[0m   cancel \x1b[2mesc\x1b[0m",
    )
    if (height > 0) output.write(`\x1b[${height}F\x1b[J`)
    output.write(lines.join(EOL) + EOL)
    height = lines.length
  }
  const clear = () => {
    if (height > 0) output.write(`\x1b[${height}F\x1b[J`)
    output.write("\x1b[?25h")
    input.removeListener("keypress", onKeypress)
    input.setRawMode(wasRaw ?? false)
    if (wasPaused) input.pause()
  }
  const onKeypress = (_value: string | undefined, key: Key) => {
    if (key.name === "up") {
      selected = (selected - 1 + sessions.length) % sessions.length
      if (selected === sessions.length - 1) offset = Math.max(0, sessions.length - 10)
      if (selected < offset) offset = selected
    }
    if (key.name === "down") {
      selected = (selected + 1) % sessions.length
      if (selected === 0) offset = 0
      if (selected >= offset + 10) offset = selected - 9
    }
    if (key.name === "return") return finish(sessions[selected])
    if (key.name === "escape" || (key.ctrl && key.name === "c")) return cancel()
    render()
  }
  const finish = (session: SessionInfo) => {
    clear()
    resolveSelection?.(session)
  }
  const cancel = () => {
    clear()
    resolveSelection?.()
  }
  let resolveSelection: ((session?: SessionInfo) => void) | undefined

  emitKeypressEvents(input)
  input.setRawMode(true)
  input.resume()
  input.on("keypress", onKeypress)
  output.write("\x1b[?25l")
  render()
  return new Promise<SessionInfo | undefined>((resolve) => {
    resolveSelection = resolve
  })
}
