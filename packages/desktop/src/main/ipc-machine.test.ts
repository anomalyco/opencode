import { describe, expect, test } from "bun:test"
import {
  createIpcTransportState,
  MAX_BUFFERED_EVENTS,
  selectBoundClientId,
  selectBoundEventQueue,
  selectClientEventQueue,
  selectClientIds,
  selectClientPort,
  selectClientSender,
  transitionIpcTransport,
  type IpcTransportCommand,
  type IpcTransportEvent,
  type IpcTransportState,
} from "./ipc-machine"

// Senders, ports, queues and events are opaque to the machine, so labels stand in for them.
type State = IpcTransportState<string, string, string, string>

type Event = IpcTransportEvent<string, string, string, string>

type Command = IpcTransportCommand<string, string, string, string>

const WINDOW = 7

const prepared: Event = { type: "sender.prepared", senderId: WINDOW, sender: "window" }

function bound(port: string, events: string): Event {
  return { type: "port.bound", senderId: WINDOW, sender: "window", port, events }
}

function emitted(event: string): Event {
  return { type: "event.emitted", senderId: WINDOW, event }
}

function replay(events: readonly Event[], from: State = createIpcTransportState()) {
  return events.reduce<{ state: State; commands: Command[] }>(
    (result, event) => {
      const next = transitionIpcTransport(result.state, event)

      return { state: next.state, commands: [...result.commands, ...next.commands] }
    },
    { state: from, commands: [] },
  )
}

describe("IPC transport machine", () => {
  test("holds a new window's events from its storage snapshot until its port binds", () => {
    // On dev the window had no event queue until bind, so a StorageChanged sent in between was dropped.
    const waiting = replay([prepared, emitted("storage R1")])
    expect(waiting.commands).toEqual([{ type: "watch-sender", senderId: WINDOW, sender: "window" }])
    expect(selectBoundEventQueue(waiting.state, WINDOW)).toBeUndefined()

    const next = transitionIpcTransport(waiting.state, bound("p0", "q0"))
    expect(next.commands).toEqual([
      { type: "attach-port", clientId: 0, port: "p0" },
      { type: "offer-events", events: "q0", items: ["storage R1"] },
    ])
    expect(selectBoundEventQueue(next.state, WINDOW)).toBe("q0")
    expect(selectClientEventQueue(next.state, 0)).toBe("q0")
  })

  test("moves events sent during a reload to the new document and drains the old port", () => {
    // On dev the reload's events went into the old queue, which the new port's bind then shut down.
    const first = replay([bound("p0", "q0")])
    const unloading = transitionIpcTransport(first.state, prepared)
    expect(unloading.commands).toEqual([
      { type: "shutdown-events", events: "q0" },
      { type: "notify-disconnect", clientId: 0 },
    ])
    // The unloading document still answers its pagehide flush, but streams no events.
    expect(selectClientPort(unloading.state, 0)).toBe("p0")
    expect(selectClientSender(unloading.state, 0)).toBe("window")
    expect(selectClientEventQueue(unloading.state, 0)).toBeUndefined()
    expect(selectBoundClientId(unloading.state, WINDOW)).toBeUndefined()

    const reloaded = replay(
      [emitted("menu"), emitted("zoom"), emitted("focus"), emitted("storage"), prepared, bound("p1", "q1")],
      unloading.state,
    )

    // Disconnect listeners heard about client 0 once, when its document started unloading.
    expect(reloaded.commands).toEqual([
      { type: "close-port", port: "p0" },
      { type: "end-client", clientId: 0 },
      { type: "attach-port", clientId: 1, port: "p1" },
      { type: "offer-events", events: "q1", items: ["menu", "zoom", "focus", "storage"] },
    ])
    expect(selectClientIds(reloaded.state)).toEqual(new Set([1]))
    expect(selectBoundClientId(reloaded.state, WINDOW)).toBe(1)
  })

  test("keeps a reload's events when the old port closes before the new one binds", () => {
    // On dev the closing port deleted the window's queue, so later events had nowhere to go.
    const closed = replay([bound("p0", "q0"), prepared, emitted("storage"), { type: "client.closed", clientId: 0 }])
    expect(closed.commands.slice(-2)).toEqual([
      { type: "close-port", port: "p0" },
      { type: "end-client", clientId: 0 },
    ])
    expect(selectClientIds(closed.state)).toEqual(new Set())

    expect(transitionIpcTransport(closed.state, bound("p1", "q1")).commands).toEqual([
      { type: "attach-port", clientId: 1, port: "p1" },
      { type: "offer-events", events: "q1", items: ["storage"] },
    ])
  })

  test("replaces a bound port that is rebound without a snapshot", () => {
    const rebound = replay([bound("p0", "q0"), bound("p1", "q1")])
    expect(rebound.commands.slice(2)).toEqual([
      { type: "shutdown-events", events: "q0" },
      { type: "close-port", port: "p0" },
      { type: "notify-disconnect", clientId: 0 },
      { type: "end-client", clientId: 0 },
      { type: "attach-port", clientId: 1, port: "p1" },
    ])
    expect(selectClientSender(rebound.state, 0)).toBeUndefined()
    expect(selectBoundEventQueue(rebound.state, WINDOW)).toBe("q1")
  })

  test("forgets a window whose bound port closes", () => {
    const closed = replay([bound("p0", "q0"), { type: "client.closed", clientId: 0 }])
    expect(closed.commands.slice(2)).toEqual([
      { type: "shutdown-events", events: "q0" },
      { type: "close-port", port: "p0" },
      { type: "notify-disconnect", clientId: 0 },
      { type: "end-client", clientId: 0 },
      { type: "unwatch-sender", senderId: WINDOW, sender: "window" },
    ])
    // Events for a window with no document on the way are not held.
    const after = transitionIpcTransport(closed.state, emitted("late"))
    expect(after.state).toBe(closed.state)
  })

  test.each([
    {
      name: "bound",
      events: [bound("p0", "q0")],
      released: ["shutdown-events", "close-port", "notify-disconnect", "end-client"],
    },
    { name: "awaiting its first port", events: [prepared], released: [] },
    { name: "draining a reload", events: [bound("p0", "q0"), prepared], released: ["close-port", "end-client"] },
  ])("releases a destroyed window that is $name", (input) => {
    const before = replay(input.events)
    const next = transitionIpcTransport(before.state, { type: "sender.destroyed", senderId: WINDOW })
    expect(next.commands.map((command) => command.type)).toEqual([...input.released, "unwatch-sender"])
    expect(selectClientIds(next.state)).toEqual(new Set())
    expect(transitionIpcTransport(next.state, emitted("late")).state).toBe(next.state)
  })

  test("caps the events held for a window", () => {
    const full = replay(
      Array.from({ length: MAX_BUFFERED_EVENTS }, (_, index) => emitted(`e${index}`)),
      replay([prepared]).state,
    )

    expect(transitionIpcTransport(full.state, emitted("overflow")).state).toBe(full.state)
  })

  test("ignores stale and repeated events", () => {
    const waiting = replay([prepared]).state
    expect(transitionIpcTransport(waiting, prepared).state).toBe(waiting)
    expect(transitionIpcTransport(waiting, { type: "client.closed", clientId: 3 }).state).toBe(waiting)
    expect(transitionIpcTransport(waiting, { type: "sender.destroyed", senderId: 99 }).state).toBe(waiting)
  })

  test("closes everything on dispose and refuses later ports", () => {
    const disposed = replay([bound("p0", "q0"), { type: "disposed" }])
    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.commands.slice(2).map((command) => command.type)).toEqual([
      "shutdown-events",
      "close-port",
      "notify-disconnect",
      "end-client",
      "unwatch-sender",
    ])
    expect(transitionIpcTransport(disposed.state, bound("p1", "q1")).commands).toEqual([
      { type: "close-port", port: "p1" },
      { type: "shutdown-events", events: "q1" },
    ])
    expect(transitionIpcTransport(disposed.state, prepared).commands).toEqual([])
  })
})
