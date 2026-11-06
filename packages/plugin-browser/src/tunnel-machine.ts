export * as BrowserTunnelMachine from "./tunnel-machine.js"

// The server end of one desktop attachment's TCP tunnels. A tunnel leaves the pool when the desktop
// closes it or once both directions are finished, so a lost `tunnel.close` cannot hold a slot forever.

export const MAX_TUNNELS = 64

export type Entry =
  /** The slot is claimed before the first `await`, so concurrent opens cannot pass the cap. */
  | { readonly status: "connecting" }
  | {
      readonly status: "open"
      readonly reading: boolean
      readonly writing: boolean
      /** The desktop has read EOF. */
      readonly readEnded: boolean
      /** The desktop's final write flushed. */
      readonly writeEnded: boolean
      /** The socket's first error; the next read reports it. */
      readonly error: Error | undefined
    }

export type State =
  | { readonly status: "active"; readonly entries: ReadonlyMap<string, Entry> }
  | { readonly status: "disposed" }

export type ReadOutcome = "chunk" | "eof" | "error" | "interrupted"

export type WriteOutcome = "ok" | "error" | "interrupted"

export type Event =
  | { readonly type: "open.started"; readonly id: string }
  | { readonly type: "open.connected"; readonly id: string }
  | { readonly type: "open.failed"; readonly id: string }
  | { readonly type: "socket.errored"; readonly id: string; readonly error: Error }
  | { readonly type: "socket.closed"; readonly id: string }
  | { readonly type: "read.started"; readonly id: string }
  | { readonly type: "read.settled"; readonly id: string; readonly outcome: ReadOutcome; readonly socketClosed: boolean }
  | { readonly type: "write.started"; readonly id: string }
  | {
      readonly type: "write.settled"
      readonly id: string
      readonly end: boolean
      readonly outcome: WriteOutcome
      readonly socketClosed: boolean
    }
  | { readonly type: "tunnel.closed"; readonly id: string }
  | { readonly type: "disposed" }

export type SocketEffect = { readonly type: "destroy-socket"; readonly id: string }

export type Transition = { readonly state: State; readonly effects: readonly SocketEffect[] }

export const initial = (): State => ({ status: "active", entries: new Map() })

const DISPOSED: State = { status: "disposed" }

export function transition(state: State, event: Event): Transition {
  if (state.status === "disposed") {
    // A connect that lands after disposal still owns a socket.
    if (event.type === "open.connected" || event.type === "open.failed") return destroy(state, event.id)

    return unchanged(state)
  }

  if (event.type === "disposed")
    return { state: DISPOSED, effects: Array.from(state.entries.keys(), (id) => ({ type: "destroy-socket", id })) }
  const entry = state.entries.get(event.id)

  switch (event.type) {
    case "open.started":
      if (entry || state.entries.size >= MAX_TUNNELS) return unchanged(state)

      return { state: put(state, event.id, { status: "connecting" }), effects: [] }
    case "open.connected":
      // Closed while connecting: the socket has no slot to return to.
      if (!entry) return destroy(state, event.id)

      if (entry.status !== "connecting") return unchanged(state)

      return {
        state: put(state, event.id, {
          status: "open",
          reading: false,
          writing: false,
          readEnded: false,
          writeEnded: false,
          error: undefined,
        }),
        effects: [],
      }
    case "open.failed":
    case "tunnel.closed":
      return entry ? evict(state, event.id) : unchanged(state)
  }

  if (entry?.status !== "open") return unchanged(state)

  switch (event.type) {
    case "socket.errored":
      if (entry.error) return unchanged(state)

      return { state: put(state, event.id, { ...entry, error: event.error }), effects: [] }
    case "socket.closed":
      if (entry.reading || entry.writing || !entry.readEnded) return unchanged(state)

      return evict(state, event.id)
    case "read.started":
      if (entry.reading) return unchanged(state)

      return { state: put(state, event.id, { ...entry, reading: true }), effects: [] }
    case "read.settled": {
      if (!entry.reading) return unchanged(state)
      const readEnded = entry.readEnded || event.outcome === "eof"

      if (event.outcome === "error" || (readEnded && (entry.writeEnded || event.socketClosed)))
        return evict(state, event.id)

      return { state: put(state, event.id, { ...entry, reading: false, readEnded }), effects: [] }
    }
    case "write.started":
      if (entry.writing || entry.writeEnded || entry.error) return unchanged(state)

      return { state: put(state, event.id, { ...entry, writing: true }), effects: [] }
    case "write.settled": {
      if (!entry.writing) return unchanged(state)
      const writeEnded = entry.writeEnded || (event.outcome === "ok" && event.end)

      if (event.outcome === "interrupted" || (entry.readEnded && (writeEnded || event.socketClosed)))
        return evict(state, event.id)

      return { state: put(state, event.id, { ...entry, writing: false, writeEnded }), effects: [] }
    }
  }
}

/** Why `open` cannot claim a slot, if it cannot. */
export function openError(state: State) {
  if (state.status === "disposed") return new Error("Browser attachment is closed.")

  if (state.entries.size >= MAX_TUNNELS)
    return new Error(`Browser attachment has reached its ${MAX_TUNNELS}-connection limit.`)
}

/** Whether `id` is connected and still in the pool. */
export function isOpen(state: State, id: string) {
  return state.status === "active" && state.entries.get(id)?.status === "open"
}

/** Why `read` cannot start on `id`, if it cannot. */
export function readError(state: State, id: string) {
  const entry = state.status === "active" ? state.entries.get(id) : undefined

  if (entry?.status !== "open") return new Error("Browser tunnel is closed or unknown.")

  if (entry.reading) return new Error("Only one read may be pending per browser tunnel.")
}

/** Why `write` cannot start on `id`, if it cannot. */
export function writeError(state: State, id: string) {
  const entry = state.status === "active" ? state.entries.get(id) : undefined

  if (entry?.status !== "open" || entry.writeEnded) return new Error("Browser tunnel is not writable.")

  if (entry.error) return entry.error

  if (entry.writing) return new Error("Only one write may be pending per browser tunnel.")
}

/** The socket error recorded for `id`. */
export function socketError(state: State, id: string) {
  const entry = state.status === "active" ? state.entries.get(id) : undefined

  return entry?.status === "open" ? entry.error : undefined
}

function put(state: Extract<State, { status: "active" }>, id: string, entry: Entry): State {
  return { status: "active", entries: new Map(state.entries).set(id, entry) }
}

function evict(state: Extract<State, { status: "active" }>, id: string): Transition {
  const entries = new Map(state.entries)
  entries.delete(id)

  return { state: { status: "active", entries }, effects: [{ type: "destroy-socket", id }] }
}

function destroy(state: State, id: string): Transition {
  return { state, effects: [{ type: "destroy-socket", id }] }
}

function unchanged(state: State): Transition {
  return { state, effects: [] }
}
