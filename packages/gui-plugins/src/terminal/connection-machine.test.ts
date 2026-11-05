import { describe, expect, test } from "bun:test"
import { persistentPtyFrame } from "@opencode/client/solid"
import {
  createConnectionState,
  transitionConnection,
  type ConnectionEffect,
  type ConnectionEvent,
  type ConnectionState,
} from "./connection-machine"

const ID = "attachment-1"

const info = {
  id: "pty_1",
  title: "zsh",
  command: "/bin/zsh",
  args: [],
  cwd: "/repo",
  status: "running",
  pid: 42,
  sessionID: "ses_1",
  foregroundProcess: null,
  size: { cols: 40, rows: 10 },
  output: { head: 0, tail: 128 },
}

const message = <Body extends { readonly type: string }>(body: Body): ConnectionEvent => ({
  type: "socket.message",
  text: JSON.stringify(body),
})

const attached = (fields: { readonly inputProtocol?: number; readonly role?: "observer" } = {}) =>
  message({
    type: "attached",
    inputProtocol: 1,
    info,
    role: "controller",
    generation: 1,
    replay: { requestedOffset: 128, availableOffset: 0, endOffset: 128, truncated: false },
    ...fields,
  })

const replayComplete = message({ type: "replay_complete", endOffset: 128 })

const exited = message({ type: "exited", exitCode: 0, finalOffset: 256 })

const controllerChanged = (attachmentID: string) => message({ type: "controller_changed", attachmentID, generation: 2 })

const resized = message({ type: "resized", cols: 100, rows: 30, generation: 2, checkpoint: btoa("checkpoint") })

const drained: ConnectionEvent = { type: "replay.drained" }

const interacted: ConnectionEvent = { type: "interacted" }

const input = (text: string): ConnectionEvent => ({ type: "input", data: new TextEncoder().encode(text) })

const size = (cols: number, rows: number): ConnectionEvent => ({ type: "size.changed", size: { cols, rows } })

const send = (cols: number, rows: number, text?: string): ConnectionEffect => ({
  type: "send",
  frame: persistentPtyFrame({ cols, rows }, text === undefined ? undefined : new TextEncoder().encode(text)),
})

/** Folds events from a fresh attachment and collects every effect. */
function run(events: readonly ConnectionEvent[], from: ConnectionState = createConnectionState(ID)) {
  const effects: ConnectionEffect[] = []

  const state = events.reduce((current, event) => {
    const next = transitionConnection(current, event)
    effects.push(...next.effects)

    return next.state
  }, from)

  return { state, effects }
}

/** Each event leaves `state` as the same object and emits nothing. */
function expectIgnored(state: ConnectionState, events: readonly ConnectionEvent[]) {
  events.forEach((event) => {
    const next = transitionConnection(state, event)

    expect(next.state).toBe(state)
    expect(next.effects).toEqual([])
  })
}

describe("transitionConnection", () => {
  test("a socket error or close after the shell exited reports no failure", () => {
    const replaying = run([attached(), exited]).state
    const live = run([size(120, 40), attached(), replayComplete, drained, exited]).state

    expect(replaying).toEqual({ status: "exited" })
    expect(live).toEqual({ status: "exited" })
    expectIgnored(replaying, [{ type: "socket.errored" }, { type: "socket.closed" }])
    expectIgnored(live, [{ type: "socket.errored" }, { type: "socket.closed" }])
  })

  test("sends nothing once the shell exited", () => {
    const live = run([size(120, 40), attached(), replayComplete, drained]).state
    const gone = transitionConnection(live, exited)

    expect(gone.effects).toEqual([])
    expectIgnored(gone.state, [input("a"), interacted, size(100, 30), controllerChanged(ID), resized, replayComplete])

    // Input typed during the replay is dropped with the exit, and a late end of the replay sends nothing.
    const replaying = run([size(120, 40), attached(), input("ls\r"), replayComplete, exited])

    expect(replaying.state).toEqual({ status: "exited" })
    expectIgnored(replaying.state, [drained])
  })

  test("messages before `attached` change nothing and keep the held input and click", () => {
    const held = run([input("ls\r"), interacted]).state

    expectIgnored(held, [
      replayComplete,
      resized,
      controllerChanged(ID),
      exited,
      drained,
      message({ type: "title_changed", title: "vim" }),
    ])

    const result = run([attached({ role: "observer" }), replayComplete, drained, size(120, 40)], held)

    expect(result.effects).toEqual([
      { type: "queue-resize", size: { cols: 40, rows: 10 } },
      { type: "queue-replay-end" },
      send(120, 40, "ls\r"),
    ])
  })

  test("a failure drops held input and ignores what follows", () => {
    const failures = [
      { event: { type: "socket.closed" }, failure: "disconnected" },
      { event: { type: "socket.errored" }, failure: "failed" },
      { event: attached({ inputProtocol: undefined }), failure: "outdated" },
    ] as const

    failures.forEach((item) => {
      const result = run([input("ls\r"), interacted, item.event])

      expect(result.state).toEqual({ status: "failed", failure: item.failure })
      expect(result.effects).toEqual([{ type: "fail", failure: item.failure }])
      expectIgnored(result.state, [
        input("a"),
        interacted,
        size(120, 40),
        drained,
        attached(),
        replayComplete,
        { type: "socket.closed" },
        { type: "socket.errored" },
      ])
    })

    // A failure during the replay ignores its late end.
    const replaying = run([size(120, 40), attached(), input("ls\r"), replayComplete, { type: "socket.closed" }])

    expect(replaying.effects.filter((effect) => effect.type === "send")).toEqual([])
    expectIgnored(replaying.state, [drained])
  })

  test("a second `attached` or `replay_complete` changes nothing", () => {
    const replaying = run([attached(), replayComplete]).state
    const live = run([size(120, 40), attached(), replayComplete, drained]).state

    expectIgnored(replaying, [attached({ role: "observer" }), replayComplete])
    expectIgnored(live, [attached({ role: "observer" }), replayComplete, drained])
  })

  test("an observer's click before the pane is measured takes control once it is, at the pane's size", () => {
    const live = run([attached({ role: "observer" }), interacted, replayComplete, drained])

    expect(live.state).toEqual({
      status: "live",
      attachmentID: ID,
      role: "observer",
      pane: { sized: false, wantsControl: true, pendingInput: [] },
    })
    expect(live.effects).toEqual([{ type: "queue-resize", size: { cols: 40, rows: 10 } }, { type: "queue-replay-end" }])

    const measured = transitionConnection(live.state, size(120, 40))

    expect(measured.effects).toEqual([send(120, 40)])
    expect(measured.state).toEqual({
      status: "live",
      attachmentID: ID,
      role: "observer",
      pane: { sized: true, size: { cols: 120, rows: 40 } },
    })
  })

  test("a click or input after the replay but before the pane is measured waits for the pane's size", () => {
    const live = run([attached({ role: "observer" }), replayComplete, drained]).state

    expect(run([interacted, size(120, 40)], live).effects).toEqual([send(120, 40)])
    expect(run([input("ls\r"), size(120, 40)], live).effects).toEqual([send(120, 40, "ls\r")])
  })

  test("a controller takes control at the pane's size once the replay is written, or sends its held input there", () => {
    const quiet = run([attached(), size(120, 40), replayComplete])

    expect(transitionConnection(quiet.state, drained).effects).toEqual([send(120, 40)])

    const typed = run([attached(), size(120, 40), input("ls\r"), input("pwd\r"), replayComplete])

    expect(transitionConnection(typed.state, drained).effects).toEqual([send(120, 40, "ls\r"), send(120, 40, "pwd\r")])
  })

  test("an observer that never asked for control sends nothing when the replay is written", () => {
    expect(
      transitionConnection(run([attached({ role: "observer" }), size(120, 40), replayComplete]).state, drained).effects,
    ).toEqual([])
  })

  test("follows control changes", () => {
    const live = run([size(120, 40), attached(), replayComplete, drained]).state

    expectIgnored(live, [controllerChanged(ID)])

    const observer = run([controllerChanged("attachment-2"), size(100, 30)], live)

    expect(observer.effects).toEqual([])

    const back = transitionConnection(observer.state, controllerChanged(ID))

    expect(back.effects).toEqual([send(100, 30)])
    expect(transitionConnection(back.state, size(90, 20)).effects).toEqual([send(90, 20)])

    // Control that changes during the replay decides what the end of the replay sends.
    expect(
      run([attached({ role: "observer" }), size(120, 40), controllerChanged(ID), replayComplete, drained]).effects,
    ).toContainEqual(send(120, 40))
  })

  test("queues the snapshot and every resize on the writer", () => {
    const result = run([
      { type: "snapshot.restored", size: { cols: 80, rows: 24 }, checkpoint: btoa("restored") },
      attached(),
      resized,
    ])

    expect(result.effects).toEqual([
      { type: "queue-resize", size: { cols: 80, rows: 24 }, checkpoint: btoa("restored") },
      { type: "queue-resize", size: { cols: 40, rows: 10 } },
      { type: "queue-resize", size: { cols: 100, rows: 30 }, checkpoint: btoa("checkpoint"), reset: true },
    ])
    expectIgnored(result.state, [{ type: "snapshot.restored", size: { cols: 80, rows: 24 }, checkpoint: "" }])
  })

  test("ignores what changes nothing", () => {
    const live = run([size(120, 40), attached(), replayComplete, drained]).state

    expectIgnored(live, [
      { type: "socket.message", text: "not json" },
      message({ type: "unknown" }),
      message({ type: "title_changed", title: "vim" }),
      message({ type: "foreground_process_changed", process: "vim" }),
      input(""),
      size(0, 40),
      size(120, 40),
    ])
    expectIgnored(run([interacted, size(120, 40)]).state, [interacted, size(120, 40)])
  })

  test("reports one failure when the socket errors and then closes", () => {
    const result = run([attached(), { type: "socket.errored" }, { type: "socket.closed" }])

    expect(result.state).toEqual({ status: "failed", failure: "failed" })
    expect(result.effects.filter((effect) => effect.type === "fail")).toEqual([{ type: "fail", failure: "failed" }])
  })

  test("disposing clears the writer once from every state and ignores everything after", () => {
    const states = [
      createConnectionState(ID),
      run([attached()]).state,
      run([size(120, 40), attached(), replayComplete, drained]).state,
      run([attached(), exited]).state,
      run([{ type: "socket.closed" }]).state,
    ]

    states.forEach((state) => {
      const disposed = transitionConnection(state, { type: "disposed" })

      expect(disposed.state).toEqual({ status: "disposed" })
      expect(disposed.effects).toEqual([{ type: "clear-writer" }])
      expectIgnored(disposed.state, [
        { type: "disposed" },
        attached(),
        drained,
        input("a"),
        interacted,
        { type: "socket.errored" },
      ])
    })
  })
})
