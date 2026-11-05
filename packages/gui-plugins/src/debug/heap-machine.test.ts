import { describe, expect, test } from "bun:test"
import {
  createHeapCaptureState,
  createHeapCommandState,
  HEAP_CAPTURE_TIMEOUT_MS,
  isHeapCommandEnabled,
  transitionHeapCapture,
  transitionHeapCommand,
  type HeapCaptureEvent,
  type HeapCaptureReply,
  type HeapCaptureState,
  type HeapCommandEvent,
  type HeapCommandState,
} from "./heap-machine"

const reply = (): HeapCaptureReply => ({ resolve: () => undefined, reject: () => undefined })

const result = { directory: "/downloads/opencode-heap-1", complete: true }

const command = (value = reply()): HeapCaptureEvent => ({
  type: "command.requested",
  root: "/downloads",
  includeServer: true,
  reply: value,
})

const signal: HeapCaptureEvent = { type: "signal.received", root: "/heap", includeServer: false }

function captureAfter(...events: HeapCaptureEvent[]) {
  return events.reduce<HeapCaptureState>(
    (state, event) => transitionHeapCapture(state, event).state,
    createHeapCaptureState(),
  )
}

describe("transitionHeapCapture", () => {
  test("a second command while one captures joins it instead of writing another folder", () => {
    const first = reply()
    const second = reply()
    const started = transitionHeapCapture(createHeapCaptureState(), command(first))
    const joined = transitionHeapCapture(started.state, command(second))

    expect(started.effects).toEqual([
      { type: "capture.run", attempt: 1, root: "/downloads", includeServer: true, timeoutMs: HEAP_CAPTURE_TIMEOUT_MS },
    ])
    expect(joined.effects).toEqual([])
    expect(transitionHeapCapture(joined.state, { type: "capture.succeeded", attempt: 1, result })).toEqual({
      state: { status: "idle", attempt: 1 },
      effects: [
        { type: "timer.cancel" },
        { type: "replies.settle", replies: [first, second], outcome: { ok: true, result } },
      ],
    })
  })

  test("repeated signals coalesce, and each source queues at most one job behind the other", () => {
    const signals = captureAfter(signal)

    expect(transitionHeapCapture(signals, signal).state).toBe(signals)

    const first = reply()
    const second = reply()
    const behindSignal = captureAfter(signal, command(first), command(second))

    expect(behindSignal).toMatchObject({
      active: { source: "signal" },
      pending: { source: "command", replies: [first, second] },
    })
    expect(transitionHeapCapture(behindSignal, signal).state).toBe(behindSignal)

    const behindCommand = captureAfter(command(), signal)

    expect(behindCommand).toMatchObject({ active: { source: "command" }, pending: { source: "signal" } })
    expect(transitionHeapCapture(behindCommand, signal).state).toBe(behindCommand)
  })

  test("a failed capture still starts the queued one", () => {
    const first = reply()
    const error = new Error("ENOSPC")
    const state = captureAfter(command(first), signal)

    expect(transitionHeapCapture(state, { type: "capture.failed", attempt: 1, error })).toEqual({
      state: {
        status: "capturing",
        attempt: 2,
        active: { source: "signal", root: "/heap", includeServer: false },
        pending: undefined,
      },
      effects: [
        { type: "timer.cancel" },
        { type: "replies.settle", replies: [first], outcome: { ok: false, error } },
        { type: "capture.run", attempt: 2, root: "/heap", includeServer: false, timeoutMs: HEAP_CAPTURE_TIMEOUT_MS },
      ],
    })
  })

  test("a capture that never settles times out, logs for a signal, and starts the queued command", () => {
    const queued = reply()
    const state = captureAfter(signal, command(queued))
    const timedOut = transitionHeapCapture(state, { type: "capture.timed-out", attempt: 1 })

    expect(timedOut.state).toMatchObject({ status: "capturing", attempt: 2, active: { replies: [queued] } })
    expect(timedOut.effects).toEqual([
      { type: "timer.cancel" },
      { type: "signal.failed", error: "Heap capture timed out" },
      { type: "capture.run", attempt: 2, root: "/downloads", includeServer: true, timeoutMs: HEAP_CAPTURE_TIMEOUT_MS },
    ])
    expect(transitionHeapCapture(timedOut.state, { type: "capture.succeeded", attempt: 1, result }).state).toBe(
      timedOut.state,
    )
  })

  test("disposing rejects every waiting command, and later commands at once", () => {
    const first = reply()
    const second = reply()
    const disposed = transitionHeapCapture(captureAfter(signal, command(first), command(second)), { type: "disposed" })

    expect(disposed).toEqual({
      state: { status: "disposed" },
      effects: [
        { type: "timer.cancel" },
        {
          type: "replies.settle",
          replies: [first, second],
          outcome: { ok: false, error: new Error("Heap capture disposed") },
        },
      ],
    })

    const late = reply()

    expect(transitionHeapCapture(disposed.state, command(late)).effects).toEqual([
      { type: "replies.settle", replies: [late], outcome: { ok: false, error: new Error("Heap capture disposed") } },
    ])
  })
})

function commandAfter(...events: HeapCommandEvent[]) {
  return events.reduce<HeapCommandState>(
    (state, event) => transitionHeapCommand(state, event).state,
    createHeapCommandState(),
  )
}

describe("transitionHeapCommand", () => {
  test("running the command again while it captures shows no second toast", () => {
    const capturing = commandAfter({ type: "run" })

    expect(transitionHeapCommand(capturing, { type: "run" })).toEqual({ state: capturing, effects: [] })
    expect(isHeapCommandEnabled(capturing)).toBe(false)
  })

  test("each outcome replaces the loading toast and offers the command again", () => {
    const capturing = commandAfter({ type: "run" })
    const succeeded = transitionHeapCommand(capturing, { type: "succeeded", attempt: 1, result })
    const failed = transitionHeapCommand(capturing, { type: "failed", attempt: 1 })

    expect(succeeded).toEqual({
      state: { status: "idle", issued: 1 },
      effects: [{ type: "toast.result", attempt: 1, result }],
    })
    expect(failed.effects).toEqual([{ type: "toast.failed", attempt: 1 }])
    expect(isHeapCommandEnabled(succeeded.state)).toBe(true)
    expect(transitionHeapCommand(commandAfter({ type: "run" }, { type: "failed", attempt: 1 }), { type: "run" })).toEqual(
      { state: { status: "capturing", attempt: 2 }, effects: [{ type: "capture.start", attempt: 2 }] },
    )
  })

  test("disposing dismisses the loading toast and silences a late failure", () => {
    const disposed = transitionHeapCommand(commandAfter({ type: "run" }), { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "capture.abort", attempt: 1 }] })
    expect(transitionHeapCommand(disposed.state, { type: "failed", attempt: 1 }).effects).toEqual([])
  })
})
