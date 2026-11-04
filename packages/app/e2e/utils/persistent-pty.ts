import type { WebSocketRoute } from "@playwright/test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import type { PersistentPty } from "@opencode/schema/persistent-pty"
import { Predicate } from "effect"

// Serves the session-scoped persistent PTY routes (`/api/experimental/.../terminal`, `/api/experimental/persistent-pty`)
// and their connect WebSockets, like a server backed by the opencode-pty daemon.
export type MockPersistentPtyConfig = {
  // `server.info().capabilities.persistentPty`; omitted by default, like a server that predates the field. `false`
  // also makes the routes answer 503 like a server without the daemon.
  capability?: boolean
  // Whether PUT renames (the daemon lists the `rename` feature). When false, a title update answers 501
  // PtyFeatureUnsupportedError. Default true.
  renameSupported?: boolean
  // Terminals that exist before the page loads; they publish no events.
  initial?: MockPersistentPtySeed[]
}

export type MockPersistentPtySeed = {
  // Default: the next `pty_persistent_<n>`.
  id?: string
  sessionID: string
  // The create title (default "Terminal").
  title?: string
  userTitle?: string | null
  command?: string
  args?: string[]
  // Default: the server directory.
  cwd?: string
  size?: { cols: number; rows: number }
  // Output the terminal already wrote; snapshots replay it as their checkpoint.
  output?: string
  foregroundProcess?: string | null
}

// `PersistentPty.Info`, with the `userTitle` that terminal renaming adds.
export type MockPersistentPtyInfo = {
  id: string
  title: string
  userTitle: string | null
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
  sessionID: string
  foregroundProcess: string | null
  size: { cols: number; rows: number }
  output: { head: number; tail: number }
}

// `PersistentPty.UpdateInput` once renaming lands: `size` optional, `title: null` clears the user title.
export type MockPersistentPtyUpdate = {
  attachmentID?: string
  size?: { cols: number; rows: number }
  title?: string | null
}

// Published on rename; not yet part of `OpenCodeEvent`.
export type MockPersistentPtyUpdated = {
  id: string
  created: number
  type: "persistent-pty.updated"
  data: { sessionID: string; terminal: MockPersistentPtyInfo }
}

export type MockServerEvent = OpenCodeEvent | MockPersistentPtyUpdated

// The JSON text frames the server sends; output travels as binary frames.
export type MockPersistentPtyMessage =
  | {
      type: "attached"
      attachmentID: string
      inputProtocol: 0 | 1
      info: MockPersistentPtyInfo
      role: "controller" | "observer"
      generation: number
      replay: { requestedOffset: number; availableOffset: number; endOffset: number; truncated: boolean }
    }
  | { type: "replay_complete"; endOffset: number }
  | { type: "resized"; cols: number; rows: number; generation: number; checkpoint: string }
  | { type: "controller_changed"; attachmentID?: string; generation: number }
  | { type: "exited"; exitCode?: number; finalOffset: number }
  | { type: "title_changed"; title: string }

// One decoded `input_protocol=1` frame: type 0 takes control at a size, type 1 also writes `data`.
export type MockPersistentPtyFrame = { type: 0 | 1; cols: number; rows: number; data: string }

export type MockPersistentPtySocket = {
  id: string
  attachmentID: string
  url: URL
  cursor: number
  takeover: boolean
  role: "controller" | "observer"
  inputProtocol: 0 | 1
  frames: MockPersistentPtyFrame[]
  // Text written to the terminal (type 1 frame data, or raw messages without the input protocol).
  input: string[]
  // JSON control messages sent to the client, in order.
  messages: MockPersistentPtyMessage[]
  closed: boolean
  close(code?: number, reason?: string): Promise<void>
}

export type MockPersistentPty = {
  // Read by `/api/info`; tests may change both mid-test.
  capability: boolean | undefined
  renameSupported: boolean
  // Live terminals in creation order.
  terminals: MockPersistentPtyInfo[]
  created: MockPersistentPtyInfo[]
  removed: string[]
  updates: { id: string; body: MockPersistentPtyUpdate }[]
  tokens: { id: string; headers: Record<string, string>; ticket: string }[]
  sockets: MockPersistentPtySocket[]
  // Connects refused because the terminal, or an unused ticket issued for it, was missing.
  rejected: { id: string; url: URL; reason: string }[]
  // A terminal created by another client: it appears through `persistent-pty.added`.
  add(seed: MockPersistentPtySeed): MockPersistentPtyInfo
  // Shell output: advances `output.tail` and streams to every open socket of the terminal.
  output(id: string, data: string | Uint8Array): void
  // The shell exits: `exited` on every socket, which then closes, then the server removes the terminal.
  exit(id: string, exitCode?: number | null): void
  // Another client closed the terminal: its sockets close and `persistent-pty.removed` is published.
  remove(id: string): void
  // Another attachment (default "mock-other-client"), or none, takes control: `controller_changed` on every socket.
  takeControl(id: string, attachmentID?: string | null): void
  // The canonical size changes: `resized` with a checkpoint on every socket.
  resize(id: string, size: { cols: number; rows: number }): void
  // The shell sets its OSC title: `title_changed` when the effective title changes.
  setOscTitle(id: string, title: string): void
  // Another client renames the terminal (`null` clears): `title_changed` and `persistent-pty.updated`.
  rename(id: string, title: string | null): void
  // The current controller's attachment ID.
  controller(id: string): string | undefined
  // Closes the terminal's open sockets, as a dropped connection does.
  close(id: string, code?: number, reason?: string): Promise<void>
  // The server restarts and adopts the daemon: terminals and output stay, open sockets close (1012) and unused tickets
  // expire. The event stream is not touched; use `installSseTransport(...).disconnect()` to drop it as well.
  restart(): Promise<void>
}

type Terminal = {
  info: MockPersistentPtyInfo
  createTitle: string
  oscTitle: string
  bytes: Uint8Array
  controller?: string
  generation: number
}

type Connection = MockPersistentPtySocket & { ws: WebSocketRoute }

const DEFAULT_SIZE = { cols: 80, rows: 24 }

const OTHER_CLIENT = "mock-other-client"

export function createPersistentPty(
  input: { config?: MockPersistentPtyConfig; directory: string },
  emit: (events: MockServerEvent[]) => void,
) {
  const terminals = new Map<string, Terminal>()
  const tickets: { id: string; ticket: string }[] = []
  const counters = { id: 0, ticket: 0, event: 0 }
  const connections: Connection[] = []
  const encoder = new TextEncoder()

  const event = <T extends MockServerEvent["type"]>(type: T) => {
    counters.event += 1

    return { id: `evt_mock_persistent_pty_${counters.event}`, created: Date.now(), type }
  }

  const open = (id: string) => connections.filter((item) => item.id === id && !item.closed)

  const send = (connection: Connection, message: MockPersistentPtyMessage | Uint8Array) => {
    if (connection.closed) return

    if (message instanceof Uint8Array) return connection.ws.send(Buffer.from(message))
    connection.messages.push(message)
    connection.ws.send(JSON.stringify(message))
  }

  const broadcast = (id: string, message: MockPersistentPtyMessage | Uint8Array) =>
    open(id).forEach((item) => send(item, message))

  // Server-side closes release control here instead of relying on Playwright's `onClose`.
  const close = (items: Connection[], code: number, reason: string) => {
    const closing = items.filter((item) => !item.closed)
    closing.forEach((item) => (item.closed = true))
    closing.forEach(release)

    return Promise.all(closing.map((item) => item.ws.close({ code, reason }))).then(() => undefined)
  }

  // Like the daemon, control passes to the most recent remaining attachment. A late close of a replaced socket that
  // shares the controller's attachment ID is an observer by then, so it leaves the new controller alone.
  const release = (connection: Connection) => {
    const terminal = terminals.get(connection.id)

    if (!terminal || connection.role !== "controller" || terminal.controller !== connection.attachmentID) return
    setController(terminal, open(connection.id).at(-1)?.attachmentID)
  }

  const get = (id: string) => {
    const found = terminals.get(id)

    if (!found) throw new Error(`No persistent PTY ${id}`)

    return found
  }

  const effectiveTitle = (terminal: Terminal) => terminal.info.userTitle || terminal.oscTitle || terminal.createTitle

  const retitle = (terminal: Terminal) => {
    const title = effectiveTitle(terminal)

    if (title === terminal.info.title) return
    terminal.info.title = title
    broadcast(terminal.info.id, { type: "title_changed", title })
  }

  const checkpoint = (terminal: Terminal) => Buffer.from(terminal.bytes).toString("base64")

  const setController = (terminal: Terminal, attachmentID: string | undefined) => {
    terminal.generation += 1
    terminal.controller = attachmentID
    connections
      .filter((item) => item.id === terminal.info.id)
      .forEach((item) => (item.role = item.attachmentID === attachmentID ? "controller" : "observer"))
    broadcast(terminal.info.id, {
      type: "controller_changed",
      attachmentID,
      generation: terminal.generation,
    })
  }

  const resize = (terminal: Terminal, size: { cols: number; rows: number }) => {
    if (terminal.info.size.cols === size.cols && terminal.info.size.rows === size.rows) return
    terminal.info.size = { cols: size.cols, rows: size.rows }
    broadcast(terminal.info.id, {
      type: "resized",
      cols: size.cols,
      rows: size.rows,
      generation: terminal.generation,
      checkpoint: checkpoint(terminal),
    })
  }

  // Skips IDs that a seed claims or that a terminal used, live or removed.
  const allocate = (): string => {
    counters.id += 1
    const id = `pty_persistent_${counters.id}`

    if (terminals.has(id) || pty.removed.includes(id) || input.config?.initial?.some((seed) => seed.id === id)) {
      return allocate()
    }

    return id
  }

  const build = (seed: MockPersistentPtySeed) => {
    const id = seed.id ?? allocate()

    if (!id.startsWith("pty")) throw new Error(`Persistent PTY IDs must start with "pty": ${id}`)
    const bytes = encoder.encode(seed.output ?? "")
    const createTitle = seed.title ?? "Terminal"

    const terminal: Terminal = {
      createTitle,
      oscTitle: "",
      bytes,
      generation: 0,
      info: {
        id,
        title: seed.userTitle || createTitle,
        userTitle: seed.userTitle ?? null,
        command: seed.command ?? "cmd.exe",
        args: seed.args ?? [],
        cwd: seed.cwd ?? input.directory,
        status: "running",
        pid: 1,
        sessionID: seed.sessionID,
        foregroundProcess: seed.foregroundProcess ?? null,
        size: seed.size ?? DEFAULT_SIZE,
        output: { head: 0, tail: bytes.length },
      },
    }

    terminals.set(id, terminal)

    return terminal.info
  }

  const drop = (terminal: Terminal) => {
    terminals.delete(terminal.info.id)
    pty.terminals.splice(pty.terminals.indexOf(terminal.info), 1)
    pty.removed.push(terminal.info.id)
    tickets.splice(0, tickets.length, ...tickets.filter((item) => item.id !== terminal.info.id))
    void close(open(terminal.info.id), 1000, "")
    emit([
      { ...event("persistent-pty.removed"), data: { sessionID: terminal.info.sessionID, ptyID: terminal.info.id } },
    ])
  }

  const added = (info: MockPersistentPtyInfo) => {
    pty.terminals.push(info)
    pty.created.push(info)
    emit([{ ...event("persistent-pty.added"), data: { sessionID: info.sessionID, terminal: info } }])

    return info
  }

  const rename = (terminal: Terminal, title: string | null) => {
    terminal.info.userTitle = title || null
    retitle(terminal)
    emit([
      { ...event("persistent-pty.updated"), data: { sessionID: terminal.info.sessionID, terminal: terminal.info } },
    ])
  }

  // Type 0 and type 1 frames both make the sender controller at the frame's size, as the daemon does.
  const interact = (connection: Connection, size: { cols: number; rows: number }, data?: Uint8Array) => {
    const terminal = terminals.get(connection.id)

    if (!terminal || connection.closed) return

    if (terminal.controller !== connection.attachmentID) setController(terminal, connection.attachmentID)
    resize(terminal, size)

    if (data) connection.input.push(new TextDecoder().decode(data))
  }

  const pty: MockPersistentPty = {
    capability: input.config?.capability,
    renameSupported: input.config?.renameSupported ?? true,
    terminals: [],
    created: [],
    removed: [],
    updates: [],
    tokens: [],
    sockets: connections,
    rejected: [],
    add: (seed) => added(build(seed)),
    output(id, data) {
      const terminal = get(id)
      const bytes = Predicate.isString(data) ? encoder.encode(data) : data
      const next = new Uint8Array(terminal.bytes.length + bytes.length)
      next.set(terminal.bytes)
      next.set(bytes, terminal.bytes.length)
      terminal.bytes = next
      terminal.info.output = { head: terminal.info.output.head, tail: next.length }

      if (bytes.length > 0) broadcast(id, bytes)
    },
    exit(id, exitCode) {
      const terminal = get(id)
      terminal.info.status = "exited"
      terminal.info.exitCode = exitCode ?? undefined
      broadcast(id, {
        type: "exited",
        exitCode: exitCode ?? undefined,
        finalOffset: terminal.info.output.tail,
      })
      drop(terminal)
    },
    remove: (id) => drop(get(id)),
    takeControl: (id, attachmentID = OTHER_CLIENT) => setController(get(id), attachmentID ?? undefined),
    resize: (id, size) => resize(get(id), size),
    setOscTitle(id, title) {
      const terminal = get(id)
      terminal.oscTitle = title
      retitle(terminal)
    },
    rename: (id, title) => rename(get(id), title),
    controller: (id) => get(id).controller,
    close: (id, code = 1011, reason = "mock socket closed") => close(open(id), code, reason),
    restart() {
      tickets.splice(0)
      terminals.forEach((terminal) => (terminal.controller = undefined))

      return close(connections, 1012, "server restarted")
    },
  }

  pty.terminals.push(...(input.config?.initial ?? []).map(build))

  return Object.assign(pty, {
    find: (id: string) => terminals.get(id)?.info,
    list: (sessionID: string) => pty.terminals.filter((item) => item.sessionID === sessionID),
    create(sessionID: string, body: PersistentPty.CreateInput) {
      return added(
        build({
          sessionID,
          title: body.title,
          cwd: body.cwd,
          command: body.command,
          args: [...body.args],
          size: body.size,
        }),
      )
    },
    // Resizes when `size` is present and renames when `title` is present, like the server's update handler.
    update(id: string, body: MockPersistentPtyUpdate) {
      const terminal = get(id)
      pty.updates.push({ id, body })

      if (body.size) resize(terminal, body.size)

      if (body.title !== undefined) rename(terminal, body.title)

      return terminal.info
    },
    snapshot(id: string) {
      const terminal = get(id)

      return {
        info: terminal.info,
        text: new TextDecoder().decode(terminal.bytes),
        checkpoint: checkpoint(terminal),
        cursor: { x: 0, y: 0 },
      }
    },
    issue(id: string, headers: Record<string, string>) {
      counters.ticket += 1
      const ticket = `e2e-persistent-ticket-${counters.ticket}`
      tickets.push({ id, ticket })
      pty.tokens.push({ id, headers, ticket })

      return ticket
    },
    // Follows the server's connect handler: `attached`, the replay from `cursor` as one binary frame, then
    // `replay_complete`; a controller attachment then broadcasts `controller_changed`.
    connect(ws: WebSocketRoute) {
      const url = new URL(ws.url())
      const id = decodeURIComponent(url.pathname.split("/")[4] ?? "")
      const terminal = terminals.get(id)
      const ticket = url.searchParams.get("ticket")
      const index = tickets.findIndex((item) => item.id === id && item.ticket === ticket)
      const cursor = Number(url.searchParams.get("cursor") ?? "0")

      const reason =
        !terminal || pty.capability === false
          ? "terminal unavailable"
          : index < 0
            ? "No unused ticket was issued for this terminal"
            : !Number.isSafeInteger(cursor) || cursor < 0
              ? "Invalid cursor"
              : undefined

      if (!terminal || reason) {
        pty.rejected.push({ id, url, reason: reason ?? "terminal unavailable" })

        return ws.close({
          code: reason === "terminal unavailable" ? 4404 : 1008,
          reason: reason ?? "terminal unavailable",
        })
      }

      tickets.splice(index, 1)
      const role = url.searchParams.get("role") === "observer" ? "observer" : "controller"
      const takeover = url.searchParams.get("takeover") === "true"
      const attachmentID = url.searchParams.get("attachment_id") ?? crypto.randomUUID()

      if (role === "controller" && terminal.controller && terminal.controller !== attachmentID && !takeover) {
        pty.rejected.push({ id, url, reason: "terminal already has a controller" })

        return ws.close({ code: 4404, reason: "terminal unavailable" })
      }

      const connection: Connection = {
        ws,
        id,
        attachmentID,
        url,
        cursor,
        takeover,
        role,
        inputProtocol: url.searchParams.get("input_protocol") === "1" ? 1 : 0,
        frames: [],
        input: [],
        messages: [],
        closed: false,
        close: (code = 1011, reason = "mock socket closed") => close([connection], code, reason),
      }

      ws.onMessage((message) => {
        const data = Predicate.isString(message) ? Buffer.from(message) : message

        if (connection.inputProtocol === 0) return interact(connection, terminal.info.size, data)

        if (data.byteLength < 5) return
        const type = data[0]
        const cols = data.readUInt16BE(1)
        const rows = data.readUInt16BE(3)

        if ((type !== 0 && type !== 1) || cols === 0 || rows === 0) return
        const payload = data.subarray(5)
        connection.frames.push({ type, cols, rows, data: type === 1 ? new TextDecoder().decode(payload) : "" })
        interact(connection, { cols, rows }, type === 1 ? payload : undefined)
      })
      ws.onClose(() => {
        if (connection.closed) return
        connection.closed = true
        release(connection)
      })
      connections.push(connection)

      if (role === "controller" && terminal.controller !== attachmentID) {
        terminal.generation += 1
        terminal.controller = attachmentID
      }

      connection.role = terminal.controller === attachmentID ? "controller" : "observer"
      const start = Math.max(terminal.info.output.head, Math.min(cursor, terminal.bytes.length))

      send(connection, {
        type: "attached",
        attachmentID,
        inputProtocol: connection.inputProtocol,
        info: terminal.info,
        role: connection.role,
        generation: terminal.generation,
        replay: {
          requestedOffset: cursor,
          availableOffset: start,
          endOffset: terminal.bytes.length,
          truncated: false,
        },
      })

      if (start < terminal.bytes.length) send(connection, terminal.bytes.subarray(start))
      send(connection, { type: "replay_complete", endOffset: terminal.bytes.length })

      if (role !== "controller") return
      connections.filter((item) => item.id === id && item !== connection).forEach((item) => (item.role = "observer"))
      broadcast(id, { type: "controller_changed", attachmentID, generation: terminal.generation })
    },
  })
}
