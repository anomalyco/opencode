import { describe, expect, test } from "bun:test"
import type { RpcMessage } from "effect/rpc"
import {
  createIpcClientState,
  ipcClosedError,
  selectPendingChunk,
  transitionIpcClient,
  type IpcClientCommand,
  type IpcClientEvent,
  type IpcClientState,
  type IpcPending,
} from "./ipc-client-machine"

type State = IpcClientState<string>

type Event = IpcClientEvent<string>

type Command = IpcClientCommand<string>

// SAFETY: requests are the RPC wire format's plain encoded messages, as ipc-client.ts builds them.
/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- see SAFETY above */
function message(id: number, tag: string): RpcMessage.RequestEncoded {
  return { _tag: "Request", id, tag, payload: null, headers: [] }
}
/* oxlint-enable anti-slop-effect/no-manual-tagged-construction */

function entry(): IpcPending {
  return { resolve: () => undefined, reject: () => undefined }
}

function started(id: number, tag: string, pending = entry()): Event {
  return { type: "request.started", id, message: message(id, tag), entry: pending }
}

function replay(events: readonly Event[], from: State = createIpcClientState()) {
  return events.reduce<{ state: State; commands: Command[] }>(
    (result, event) => {
      const next = transitionIpcClient(result.state, event)

      return { state: next.state, commands: [...result.commands, ...next.commands] }
    },
    { state: from, commands: [] },
  )
}

describe("IPC client machine", () => {
  test("fails waiting requests when main never posts the port", () => {
    // On dev the port promise had no timeout, so every invoke and the startup splash waited forever.
    const init = entry()
    const theme = entry()

    const waiting = replay([
      started(0, "DesktopEvents", { ...entry(), chunk: () => undefined }),
      started(1, "AppAwaitInitialization", init),
      started(2, "AppThemeReady", theme),
    ])

    const timedOut = transitionIpcClient(waiting.state, { type: "handshake.timed-out" })
    expect(timedOut.state.status).toBe("timed-out")
    expect(timedOut.commands).toEqual([{ type: "reject", entries: [init, theme], error: ipcClosedError("timeout") }])

    const late = entry()
    expect(transitionIpcClient(timedOut.state, started(3, "AppThemeReady", late)).commands).toEqual([
      { type: "reject", entries: [late], error: new Error("Desktop IPC port handshake timed out") },
    ])
  })

  test("connects a port that arrives after the handshake timed out", () => {
    // A slow subresource holds back the load event main posts the port on; the document still gets its IPC.
    const chunk = () => undefined

    const timedOut = replay([
      started(0, "DesktopEvents", { ...entry(), chunk }),
      started(1, "AppThemeReady"),
      { type: "handshake.timed-out" },
    ])

    const connected = transitionIpcClient(timedOut.state, { type: "port.received", port: "late" })
    expect(connected.state.status).toBe("connected")
    expect(connected.commands).toEqual([
      { type: "cancel-handshake-timer" },
      { type: "unlisten-window" },
      { type: "attach-port", port: "late" },
      { type: "post-request", port: "late", message: message(0, "DesktopEvents") },
    ])
    // Events reach the subscription, and new calls go straight to the port.
    expect(selectPendingChunk(connected.state, 0)).toBe(chunk)
    expect(transitionIpcClient(connected.state, started(2, "AppThemeReady")).commands).toEqual([
      { type: "post-request", port: "late", message: message(2, "AppThemeReady") },
    ])
  })

  test("never sends a request aborted before the port arrives", () => {
    // On dev the request was posted when the port arrived, ahead of its interrupt, so main ran it.
    const aborted = entry()

    const waiting = replay([
      started(0, "DesktopEvents"),
      started(1, "FilesOpenFilePicker", aborted),
      started(2, "StorageItems"),
      { type: "request.aborted", id: 1, reason: "cancelled" },
    ])

    expect(waiting.commands).toEqual([{ type: "reject", entries: [aborted], error: "cancelled" }])

    expect(transitionIpcClient(waiting.state, { type: "port.received", port: "p" }).commands).toEqual([
      { type: "cancel-handshake-timer" },
      { type: "unlisten-window" },
      { type: "attach-port", port: "p" },
      { type: "post-request", port: "p", message: message(0, "DesktopEvents") },
      { type: "post-request", port: "p", message: message(2, "StorageItems") },
    ])
  })

  test("posts a connected request in the same turn and interrupts it on abort", () => {
    const connected = replay([{ type: "port.received", port: "p" }]).state
    const posted = transitionIpcClient(connected, started(0, "StorageUpdate"))
    expect(posted.commands).toEqual([{ type: "post-request", port: "p", message: message(0, "StorageUpdate") }])

    const aborted = transitionIpcClient(posted.state, { type: "request.aborted", id: 0, reason: "stop" })
    expect(aborted.commands).toEqual([
      { type: "reject", entries: [expect.anything()], error: "stop" },
      { type: "post-interrupt", port: "p", requestId: 0 },
    ])
    expect(transitionIpcClient(aborted.state, { type: "request.aborted", id: 0, reason: "stop" }).state).toBe(
      aborted.state,
    )
  })

  test("settles each request once from its exit", () => {
    const succeeded = entry()
    const failed = entry()

    const connected = replay([
      started(0, "A", succeeded),
      started(1, "B", failed),
      { type: "port.received", port: "p" },
    ])

    const settled = replay(
      [
        { type: "response.exited", id: 0, exit: { ok: true, value: 42 } },
        { type: "response.exited", id: 1, exit: { ok: false, error: "nope" } },
      ],
      connected.state,
    )

    expect(settled.commands).toEqual([
      { type: "resolve", entry: succeeded, value: 42 },
      { type: "reject", entries: [failed], error: "nope" },
    ])
    const again = transitionIpcClient(settled.state, { type: "response.exited", id: 0, exit: { ok: true, value: 1 } })
    expect(again.state).toBe(settled.state)
  })

  test("streams chunks only to a pending request", () => {
    const chunk = () => undefined
    const connected = replay([started(0, "DesktopEvents", { ...entry(), chunk }), { type: "port.received", port: "p" }])
    expect(selectPendingChunk(connected.state, 0)).toBe(chunk)
    expect(selectPendingChunk(connected.state, 1)).toBeUndefined()
  })

  test("fails every pending request on a server defect", () => {
    const first = entry()
    const second = entry()
    const connected = replay([started(0, "A", first), started(1, "B", second), { type: "port.received", port: "p" }])
    const error = new Error("Desktop IPC defect")
    const defected = transitionIpcClient(connected.state, { type: "server.defected", error })
    expect(defected.commands).toEqual([{ type: "reject", entries: [first, second], error }])
    expect(transitionIpcClient(defected.state, { type: "server.defected", error }).state).toBe(defected.state)
  })

  test.each([
    {
      name: "connected",
      events: [{ type: "port.received", port: "p" }] satisfies Event[],
      release: [{ type: "close-port", port: "p" }] satisfies Command[],
    },
    {
      name: "still waiting for its port",
      events: [] satisfies Event[],
      release: [{ type: "cancel-handshake-timer" }, { type: "unlisten-window" }] satisfies Command[],
    },
  ])("closes on pagehide while $name and fails what is unsettled", (input) => {
    const unsettled = entry()
    const before = replay([started(0, "StorageItems", unsettled), ...input.events])
    const disposed = transitionIpcClient(before.state, { type: "disposed" })
    expect(disposed.state).toEqual({ status: "closed" })
    expect(disposed.commands).toEqual([
      ...input.release,
      { type: "reject", entries: [unsettled], error: new Error("Desktop IPC connection closed") },
    ])
  })

  test("ignores a timer that fires after the port arrived", () => {
    const connected = replay([{ type: "port.received", port: "p" }]).state
    expect(transitionIpcClient(connected, { type: "handshake.timed-out" }).state).toBe(connected)
    expect(transitionIpcClient(connected, { type: "port.received", port: "extra" }).commands).toEqual([
      { type: "close-port", port: "extra" },
    ])
  })
})
