import type { PersistentPtyInfo } from "@opencode/client"
import type { MountedSession, ServerRef } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"
import { info, terminalStorage } from "./model.fixture"
import { createTerminalModel } from "./model"
import type { Pty, PtySocket } from "./pty"

export type TerminalScenario = "Running" | "Empty" | "Loading" | "List failed" | "Disconnected" | "Unsupported"

/** A local byte stream. Each terminal keeps its own transcript while its surface is hidden or disconnected. */
class FixtureSocket extends EventTarget implements PtySocket {
  readyState: WebSocket["readyState"] = WebSocket.CONNECTING
  private timer: ReturnType<typeof setTimeout>

  constructor(
    readonly write: (text: string) => void,
    disconnect: boolean,
  ) {
    super()
    // Like a socket's open event, attach after the caller has installed its listeners.
    this.timer = setTimeout(() => {
      this.readyState = WebSocket.OPEN
      this.dispatchEvent(new Event("open"))

      for (const message of [
        { type: "attached", inputProtocol: 1, role: "controller", info: { size: { cols: 80, rows: 24 } } },
        { type: "replay_complete" },
      ])
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }))

      if (disconnect) this.close()
    })
  }

  send(frame: Parameters<WebSocket["send"]>[0]) {
    if (!(frame instanceof Uint8Array) || frame[0] !== 1) return
    const text = new TextDecoder().decode(frame.subarray(5))
    // Echo printable input only. Enter starts a new line, with no command interpreter.
    this.write(
      Array.from(text)
        .map((char) => (char === "\r" ? "\r\n> " : char >= " " && char !== "\x7f" ? char : ""))
        .join(""),
    )
  }

  output(text: string) {
    if (this.readyState === WebSocket.OPEN)
      this.dispatchEvent(new MessageEvent("message", { data: new TextEncoder().encode(text).buffer }))
  }

  close() {
    clearTimeout(this.timer)

    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    this.dispatchEvent(new Event("close"))
  }
}

export function terminalPanelFixture(scenario: TerminalScenario, t: (key: string) => string) {
  const list = new Map<string, PersistentPtyInfo>()
  const transcripts = new Map<string, string>()
  const sockets = new Map<string, FixtureSocket>()
  const connected = new Set<() => void>()
  const [attached, setAttached] = createSignal<readonly string[]>([])
  const loading = Promise.withResolvers<void>()
  let next = 0
  let fail = scenario === "List failed"
  let disconnect = scenario === "Disconnected"

  const create = (title: string, output: string) => {
    const record = info(`pty_story_${++next}`, title)
    list.set(record.id, record)
    transcripts.set(record.id, output)

    return record
  }

  if (scenario !== "Empty") {
    create("Workspace", "Project checks\r\n\r\n  Sources   12 checked\r\n  Tests      8 passed\r\n\r\n> ")
    create("Build log", "Build complete\r\n\r\n  3 modules compiled\r\n  Ready for preview\r\n\r\n> ")
  }

  const server = {
    id: "terminal-story",
    data: {
      on: (type: string, listener: () => void) => {
        if (type === "server.connected") connected.add(listener)

        return () => connected.delete(listener)
      },
      session: { get: () => undefined },
    },
    client: {
      server: { info: async () => ({ capabilities: { persistentPty: scenario !== "Unsupported" } }) },
      experimental: {
        persistentPty: {
          list: async () => {
            if (scenario === "Loading") await loading.promise

            if (fail) {
              fail = false
              throw new Error("The fixture inventory could not be read.")
            }

            return Array.from(list.values())
          },
          create: async (input: { title: string }) => create(input.title, "> "),
          update: async (input: { ptyID: string; title: string | null }) => {
            const current = list.get(input.ptyID)

            if (!current) throw new Error("Unknown fixture terminal")
            const record = { ...current, title: input.title ?? "Terminal", userTitle: input.title }
            list.set(record.id, record)

            return record
          },
          remove: async (input: { ptyID: string }) => {
            list.delete(input.ptyID)
            transcripts.delete(input.ptyID)
            sockets.get(input.ptyID)?.close()
          },
        },
      },
    },
  }

  const session: MountedSession = {
    key: "terminal-story\nses_1",
    id: "ses_1",
    tab: "terminal-story",
    pending: false,
    location: { directory: "/repo" },
    // SAFETY: the model reads only the inventory calls, subscriptions and session lookup above. Surface I/O is local.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    server: server as unknown as ServerRef,
    directory: "/repo",
    local: true,
    visit: {},
    project: undefined,
    listedProject: undefined,
    background: [],
  }

  const layout = { stored: () => Array.from(list.keys()), open() {} }

  const model = createTerminalModel({
    storage: terminalStorage(() => {}),
    layout,
    toast: { show: () => ({ dismiss() {} }) },
    t,
    tab: (id) => id,
  })

  const terminal = model.load(session)

  const write = (id: string, text: string) => {
    transcripts.set(id, (transcripts.get(id) ?? "") + text)
    sockets.get(id)?.output(text)
  }

  const pty = (_server: ServerRef, id: string): Pty => ({
    snapshot: async () => {
      const bytes = new TextEncoder().encode(transcripts.get(id) ?? "")

      return {
        info: { size: { cols: 80, rows: 24 }, output: { tail: bytes.length } },
        checkpoint: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")),
      }
    },
    connect: async () => {
      const socket = new FixtureSocket((text) => write(id, text), disconnect)
      disconnect = false
      sockets.set(id, socket)
      socket.addEventListener("open", () => setAttached((ids) => [...ids, id]))
      socket.addEventListener("close", () => {
        sockets.delete(id)
        setAttached((ids) => ids.filter((other) => other !== id))
      })

      return socket
    },
  })

  onCleanup(() => {
    loading.resolve()
    sockets.forEach((socket) => socket.close())
    model.dispose()
  })

  return {
    model: { ...model, pty },
    session,
    layout,
    terminal,
    attached: (id: string) => attached().includes(id),
    append: (id: string) => write(id, "\r\nChecks complete: 8 passed.\r\n> "),
    disconnect: (id: string) => sockets.get(id)?.close(),
    reconnect: () => connected.forEach((listener) => listener()),
    finish: () => loading.resolve(),
  }
}
