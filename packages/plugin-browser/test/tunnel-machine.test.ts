import { describe, expect, test } from "bun:test"
import { BrowserTunnelMachine } from "../src/tunnel-machine.js"
import { BrowserProxyMachine } from "../src/proxy-machine.js"

const replay = (events: readonly BrowserTunnelMachine.Event[], state = BrowserTunnelMachine.initial()) =>
  events.reduce<BrowserTunnelMachine.Transition>(
    (last, event) => BrowserTunnelMachine.transition(last.state, event),
    { state, effects: [] },
  )

const opened = (id: string): BrowserTunnelMachine.Event[] => [
  { type: "open.started", id },
  { type: "open.connected", id },
]

const entries = (state: BrowserTunnelMachine.State) => (state.status === "active" ? state.entries.size : -1)

describe("tunnel pool", () => {
  test("claims a slot before the first await, so concurrent opens cannot pass the cap", () => {
    const ids = Array.from({ length: BrowserTunnelMachine.MAX_TUNNELS }, (_, index) => `t${index}`)
    const full = replay(ids.map((id) => ({ type: "open.started", id })))

    expect(BrowserTunnelMachine.openError(full.state)?.message).toBe(
      "Browser attachment has reached its 64-connection limit.",
    )
    expect(BrowserTunnelMachine.transition(full.state, { type: "open.started", id: "late" }).state).toBe(full.state)
  })

  test("frees a finished tunnel without waiting for tunnel.close", () => {
    // The desktop's tunnel.close timed out for 64 finished tunnels; the 65th open used to be refused.
    const finished = (id: string): BrowserTunnelMachine.Event[] => [
      ...opened(id),
      { type: "write.started", id },
      { type: "write.settled", id, end: true, outcome: "ok", socketClosed: false },
      { type: "read.started", id },
      { type: "read.settled", id, outcome: "eof", socketClosed: false },
    ]
    const ids = Array.from({ length: BrowserTunnelMachine.MAX_TUNNELS }, (_, index) => `t${index}`)
    const result = replay(ids.flatMap(finished))

    expect(entries(result.state)).toBe(0)
    expect(BrowserTunnelMachine.openError(result.state)).toBeUndefined()
    expect(BrowserTunnelMachine.transition(result.state, { type: "read.settled", id: "t0", outcome: "eof", socketClosed: true }).effects).toEqual([])
  })

  test("frees a tunnel on a read error, and on a peer close once EOF was read", () => {
    const errored = replay([
      ...opened("a"),
      { type: "socket.errored", id: "a", error: new Error("reset") },
      { type: "read.started", id: "a" },
      { type: "read.settled", id: "a", outcome: "error", socketClosed: false },
    ])
    expect(entries(errored.state)).toBe(0)
    expect(errored.effects).toEqual([{ type: "destroy-socket", id: "a" }])

    const drained = replay([
      ...opened("b"),
      { type: "read.started", id: "b" },
      { type: "read.settled", id: "b", outcome: "eof", socketClosed: false },
      { type: "socket.closed", id: "b" },
    ])
    expect(entries(drained.state)).toBe(0)
  })

  test("keeps a closed socket with unread data until its EOF is read", () => {
    const closed = replay([...opened("a"), { type: "socket.closed", id: "a" }])
    expect(BrowserTunnelMachine.readError(closed.state, "a")).toBeUndefined()

    const read = replay(
      [
        { type: "read.started", id: "a" },
        { type: "read.settled", id: "a", outcome: "chunk", socketClosed: true },
      ],
      closed.state,
    )
    expect(BrowserTunnelMachine.isOpen(read.state, "a")).toBe(true)

    const ended = replay(
      [
        { type: "read.started", id: "a" },
        { type: "read.settled", id: "a", outcome: "eof", socketClosed: true },
      ],
      read.state,
    )
    expect(entries(ended.state)).toBe(0)
  })

  test("rejects a connect that lands after disposal", () => {
    // dispose() raced the socket's "connect"; open used to return a dead id.
    const result = replay([{ type: "open.started", id: "a" }, { type: "disposed" }, { type: "open.connected", id: "a" }])

    expect(result.state.status).toBe("disposed")
    expect(result.effects).toEqual([{ type: "destroy-socket", id: "a" }])
    expect(BrowserTunnelMachine.isOpen(result.state, "a")).toBe(false)
    expect(BrowserTunnelMachine.openError(result.state)?.message).toBe("Browser attachment is closed.")
  })

  test("rejects a connect that lands after close", () => {
    const result = replay([
      { type: "open.started", id: "a" },
      { type: "tunnel.closed", id: "a" },
      { type: "open.connected", id: "a" },
    ])

    expect(result.effects).toEqual([{ type: "destroy-socket", id: "a" }])
    expect(BrowserTunnelMachine.isOpen(result.state, "a")).toBe(false)
  })

  test("frees the slot of a failed connect", () => {
    const result = replay([{ type: "open.started", id: "a" }, { type: "open.failed", id: "a" }])

    expect(entries(result.state)).toBe(0)
    expect(result.effects).toEqual([{ type: "destroy-socket", id: "a" }])
  })

  test("allows one read and one write at a time, and no write after the end or an error", () => {
    const reading = replay([...opened("a"), { type: "read.started", id: "a" }])
    expect(BrowserTunnelMachine.readError(reading.state, "a")?.message).toBe(
      "Only one read may be pending per browser tunnel.",
    )

    const writing = replay([{ type: "write.started", id: "a" }], reading.state)
    expect(BrowserTunnelMachine.writeError(writing.state, "a")?.message).toBe(
      "Only one write may be pending per browser tunnel.",
    )

    const ended = replay([{ type: "write.settled", id: "a", end: true, outcome: "ok", socketClosed: false }], writing.state)
    expect(BrowserTunnelMachine.writeError(ended.state, "a")?.message).toBe("Browser tunnel is not writable.")

    const error = new Error("reset")
    const errored = replay([...opened("b"), { type: "socket.errored", id: "b", error }])
    expect(BrowserTunnelMachine.writeError(errored.state, "b")).toBe(error)
    expect(BrowserTunnelMachine.socketError(errored.state, "b")).toBe(error)
  })

  test("an interrupted write closes the tunnel, and its late settle is ignored", () => {
    const interrupted = replay([
      ...opened("a"),
      { type: "write.started", id: "a" },
      { type: "write.settled", id: "a", end: false, outcome: "interrupted", socketClosed: false },
    ])
    expect(entries(interrupted.state)).toBe(0)
    expect(interrupted.effects).toEqual([{ type: "destroy-socket", id: "a" }])

    const stale = BrowserTunnelMachine.transition(interrupted.state, {
      type: "read.settled",
      id: "a",
      outcome: "eof",
      socketClosed: true,
    })
    expect(stale.state).toBe(interrupted.state)
    expect(stale.effects).toEqual([])
  })

  test("an interrupted read only releases the read", () => {
    const result = replay([
      ...opened("a"),
      { type: "read.started", id: "a" },
      { type: "read.settled", id: "a", outcome: "interrupted", socketClosed: false },
    ])

    expect(BrowserTunnelMachine.readError(result.state, "a")).toBeUndefined()
  })

  test("disposal destroys every socket once", () => {
    const disposed = replay([...opened("a"), { type: "open.started", id: "b" }, { type: "disposed" }])

    expect(disposed.effects).toEqual([
      { type: "destroy-socket", id: "a" },
      { type: "destroy-socket", id: "b" },
    ])
    expect(BrowserTunnelMachine.transition(disposed.state, { type: "disposed" }).effects).toEqual([])
    expect(BrowserTunnelMachine.writeError(disposed.state, "a")?.message).toBe("Browser tunnel is not writable.")
  })
})

describe("desktop proxy", () => {
  test("shuts down once and admits nothing after close", () => {
    const closed = BrowserProxyMachine.transition(BrowserProxyMachine.initial, { type: "close" })

    expect(closed.effects).toEqual(["shutdown"])
    expect(BrowserProxyMachine.admits(closed.state)).toBe(false)
    expect(BrowserProxyMachine.admits(BrowserProxyMachine.initial)).toBe(true)

    const again = BrowserProxyMachine.transition(closed.state, { type: "close" })
    expect(again.state).toBe(closed.state)
    expect(again.effects).toEqual([])
  })

  test("a tunnel socket reads once at a time and never after EOF or destruction", () => {
    const reading = BrowserProxyMachine.transitionRead("idle", "pull")
    expect(reading).toBe("reading")
    expect(BrowserProxyMachine.transitionRead(reading, "pull")).toBe("reading")
    expect(BrowserProxyMachine.transitionRead(reading, "chunk")).toBe("idle")

    const ended = BrowserProxyMachine.transitionRead(reading, "eof")
    expect(ended).toBe("ended")
    expect(BrowserProxyMachine.transitionRead(ended, "pull")).toBe("ended")
    expect(BrowserProxyMachine.transitionRead(ended, "chunk")).toBe("ended")

    // A read that answers after destroy() must not push.
    const destroyed = BrowserProxyMachine.transitionRead(reading, "destroyed")
    expect(destroyed).toBe("destroyed")
    expect(BrowserProxyMachine.transitionRead(destroyed, "chunk")).toBe("destroyed")
    expect(BrowserProxyMachine.transitionRead(destroyed, "pull")).toBe("destroyed")
  })
})
