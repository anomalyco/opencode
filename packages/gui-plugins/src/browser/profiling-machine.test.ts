import { describe, expect, test } from "bun:test"
import { Browser } from "@opencode/plugin-browser/rpc"
import {
  createProfilingState,
  isTraceStoppingAttempt,
  selectProfilingTarget,
  transitionProfiling,
  type ProfilingEvent,
  type ProfilingState,
  type ProfilingTransition,
  type SharedTrace,
} from "./profiling-machine"

const replay = (
  events: readonly ProfilingEvent[],
  state: ProfilingState = createProfilingState("page-a"),
  shared: SharedTrace = undefined,
) =>
  events.reduce<ProfilingTransition>((last, event) => transitionProfiling(last.state, last.shared, event), {
    state,
    shared,
    effects: [],
  })

const traceStart: ProfilingEvent = {
  type: "trace.start.requested",
  key: "trace-1",
  pid: 42,
  durationMs: 10_000,
  resources: ["https://alpha.example/"],
}

const cpuStart: ProfilingEvent = { type: "cpu.start.requested", key: "cpu-1", resources: ["https://alpha.example/"] }

const file = (digit: string) => Browser.FileID.make(`file_${digit.repeat(36)}`)

describe("CPU profile", () => {
  test("a second start while the first still starts is refused, and arms no second timer", () => {
    const first = replay([cpuStart])
    const second = transitionProfiling(first.state, first.shared, cpuStart)

    expect(first.effects).toEqual([{ type: "start-cpu", attempt: 1 }])
    expect(second.reply).toEqual({ status: "refused", refusal: "cpu-active" })
    expect(second.state).toBe(first.state)
    expect(second.effects).toEqual([])
  })

  test("a start while the profile stops is refused; once stopped, a stop replays the outcome and a start begins anew", () => {
    const stopping = replay([cpuStart, { type: "cpu.start.succeeded", attempt: 1 }, { type: "cpu.stop.requested" }])
    expect(stopping.effects).toEqual([
      { type: "cancel", timer: "cpu.duration" },
      { type: "schedule", timer: "cpu.stop", attempt: 1, delayMs: 10_000 },
      { type: "stop-cpu", attempt: 1, resources: ["https://alpha.example/"] },
    ])
    expect(transitionProfiling(stopping.state, undefined, cpuStart).reply).toEqual({
      status: "refused",
      refusal: "cpu-active",
    })

    const stopped = transitionProfiling(stopping.state, undefined, {
      type: "cpu.stop.succeeded",
      attempt: 1,
      value: { id: file("a"), durationMs: 12 },
    })

    expect(stopped.effects).toEqual([
      { type: "cancel", timer: "cpu.stop" },
      { type: "settle-cpu-stop", attempt: 1, outcome: { ok: true, value: { id: file("a"), durationMs: 12 } } },
    ])
    expect(transitionProfiling(stopped.state, undefined, { type: "cpu.stop.requested" }).reply).toEqual({
      status: "pending",
      attempt: 1,
    })
    expect(transitionProfiling(stopped.state, undefined, cpuStart).effects).toEqual([{ type: "start-cpu", attempt: 2 }])
  })

  test("a stop during the start stops right after Chromium starts, without a duration timer", () => {
    const requested = replay([cpuStart, { type: "cpu.stop.requested" }])
    expect(requested.reply).toEqual({ status: "pending", attempt: 1 })

    const started = transitionProfiling(requested.state, undefined, { type: "cpu.start.succeeded", attempt: 1 })
    expect(started.effects).toEqual([
      { type: "settle-cpu-start", attempt: 1, outcome: { ok: true, value: undefined } },
      { type: "schedule", timer: "cpu.stop", attempt: 1, delayMs: 10_000 },
      { type: "stop-cpu", attempt: 1, resources: ["https://alpha.example/"] },
    ])
  })

  test("a failed start fails a stop that waited on it", () => {
    const error = new Error("Profiler.start failed")
    const failed = replay([cpuStart, { type: "cpu.stop.requested" }, { type: "cpu.start.failed", attempt: 1, error }])

    expect(failed.state.cpu).toEqual({ status: "idle" })
    expect(failed.effects).toEqual([
      { type: "settle-cpu-start", attempt: 1, outcome: { ok: false, error } },
      { type: "settle-cpu-stop", attempt: 1, outcome: { ok: false, error } },
    ])
  })

  test("a stop that hangs fails at its timeout, and the late result is ignored", () => {
    const error = new Error("timeout")

    const timedOut = replay([
      cpuStart,
      { type: "cpu.start.succeeded", attempt: 1 },
      { type: "cpu.duration.elapsed", attempt: 1 },
      { type: "cpu.stop.failed", attempt: 1, error },
    ])

    expect(timedOut.state.cpu.status).toBe("stopped")

    const late = transitionProfiling(timedOut.state, undefined, {
      type: "cpu.stop.succeeded",
      attempt: 1,
      value: { id: file("b"), durationMs: 1 },
    })

    expect(late.state).toBe(timedOut.state)
    expect(late.effects).toEqual([])
  })
})

describe("trace", () => {
  test("a stop during the start ends tracing once Chromium started, keeping the app-wide claim until then", () => {
    const requested = replay([traceStart, { type: "trace.stop.requested", now: 5 }])
    expect(requested.shared).toEqual({ owner: "page-a", attempt: 1 })

    const started = transitionProfiling(requested.state, requested.shared, {
      type: "trace.start.succeeded",
      attempt: 1,
      now: 6,
    })

    expect(started.shared).toEqual({ owner: "page-a", attempt: 1 })
    expect(started.effects).toEqual([
      { type: "settle-trace-start", attempt: 1, outcome: { ok: true, value: undefined } },
      { type: "schedule", timer: "trace.stop", attempt: 1, delayMs: 10_000 },
      { type: "end-trace", attempt: 1, pid: 42, durationMs: 0, resources: ["https://alpha.example/"] },
    ])
  })

  test("one page traces at a time; the other starts once the owner's export settled", () => {
    const pageA = replay([traceStart, { type: "trace.start.succeeded", attempt: 1, now: 0 }])
    const pageB = createProfilingState("page-b")

    expect(transitionProfiling(pageA.state, pageA.shared, traceStart).reply).toEqual({
      status: "refused",
      refusal: "trace-active-here",
    })
    expect(transitionProfiling(pageB, pageA.shared, traceStart).reply).toEqual({
      status: "refused",
      refusal: "trace-active-elsewhere",
    })

    const stopped = replay(
      [
        { type: "trace.duration.elapsed", attempt: 1, now: 10_000 },
        {
          type: "trace.stop.succeeded",
          attempt: 1,
          value: { id: file("c"), durationMs: 10_000, incomplete: false },
        },
      ],
      pageA.state,
      pageA.shared,
    )

    expect(stopped.shared).toBeUndefined()
    expect(selectProfilingTarget(stopped.state, "trace")).toEqual({
      resources: ["https://alpha.example/"],
      key: "trace-1",
    })

    const started = transitionProfiling(pageB, stopped.shared, traceStart)
    expect(started.shared).toEqual({ owner: "page-b", attempt: 1 })
  })

  test("an export that hangs fails at its timeout and stops reading", () => {
    const stopping = replay([
      traceStart,
      { type: "trace.start.succeeded", attempt: 1, now: 0 },
      { type: "trace.stop.requested", now: 100 },
    ])

    expect(isTraceStoppingAttempt(stopping.state, 1)).toBe(true)

    const timedOut = transitionProfiling(stopping.state, stopping.shared, {
      type: "trace.stop.failed",
      attempt: 1,
      error: new Error("timeout"),
    })

    expect(isTraceStoppingAttempt(timedOut.state, 1)).toBe(false)
    expect(timedOut.shared).toBeUndefined()
  })

  test("a failed start releases the app-wide trace", () => {
    const failed = replay([traceStart, { type: "trace.start.failed", attempt: 1, error: new Error("no") }])

    expect(failed.shared).toBeUndefined()
    expect(failed.state.trace).toEqual({ status: "idle" })
  })
})

test("navigations add pages only while a capture records", () => {
  const recording = replay([
    cpuStart,
    { type: "frame.navigated", url: "https://alpha.example/next" },
    { type: "frame.navigated", url: "https://alpha.example/next" },
  ])

  expect(selectProfilingTarget(recording.state, "cpu").resources).toEqual([
    "https://alpha.example/",
    "https://alpha.example/next",
  ])

  const stopping = replay(
    [{ type: "cpu.start.succeeded", attempt: 1 }, { type: "cpu.stop.requested" }],
    recording.state,
  )

  const after = transitionProfiling(stopping.state, undefined, {
    type: "frame.navigated",
    url: "https://beta.example/",
  })

  expect(after.state).toBe(stopping.state)
})

describe("heap snapshot", () => {
  test("one capture at a time, bounded by its timeout", () => {
    const capturing = replay([{ type: "heap.requested", resources: ["https://alpha.example/"] }])
    expect(capturing.effects).toEqual([
      { type: "schedule", timer: "heap", attempt: 1, delayMs: 30_000 },
      { type: "capture-heap", attempt: 1, resources: ["https://alpha.example/"] },
    ])
    expect(transitionProfiling(capturing.state, undefined, { type: "heap.requested", resources: [] }).reply).toEqual({
      status: "refused",
      refusal: "heap-active",
    })

    const error = new Error("timeout")
    const timedOut = transitionProfiling(capturing.state, undefined, { type: "heap.failed", attempt: 1, error })
    expect(timedOut.state.heap).toEqual({ status: "idle" })
    expect(timedOut.effects).toContainEqual({ type: "settle-heap", attempt: 1, outcome: { ok: false, error } })
    expect(
      transitionProfiling(timedOut.state, undefined, { type: "heap.succeeded", attempt: 1, id: file("b") }).effects,
    ).toEqual([])
  })
})

describe("disposal", () => {
  test("during a CPU start, stops the profile Chromium then starts, and finishes once it settled", () => {
    const disposing = replay([cpuStart, { type: "dispose.requested", now: 0 }])
    expect(disposing.state.lifecycle).toBe("disposing")

    const started = transitionProfiling(disposing.state, undefined, { type: "cpu.start.succeeded", attempt: 1 })
    expect(started.effects).toContainEqual({ type: "stop-cpu", attempt: 1, resources: ["https://alpha.example/"] })
    expect(started.effects).not.toContainEqual(expect.objectContaining({ timer: "cpu.duration" }))

    const settled = transitionProfiling(started.state, undefined, {
      type: "cpu.stop.failed",
      attempt: 1,
      error: new Error("closed"),
    })

    expect(settled.state.lifecycle).toBe("disposed")
    expect(settled.effects).toContainEqual({ type: "settle-dispose" })
  })

  test("during a trace start, ends the trace instead of leaving Chromium tracing", () => {
    const disposing = replay([traceStart, { type: "dispose.requested", now: 0 }])

    const started = transitionProfiling(disposing.state, disposing.shared, {
      type: "trace.start.succeeded",
      attempt: 1,
      now: 1,
    })

    expect(started.effects).toContainEqual({
      type: "end-trace",
      attempt: 1,
      pid: 42,
      durationMs: 0,
      resources: ["https://alpha.example/"],
    })
    expect(started.shared).toEqual({ owner: "page-a", attempt: 1 })
  })

  test("with nothing recording, finishes at once and refuses new recordings", () => {
    const disposed = replay([{ type: "dispose.requested", now: 0 }])

    expect(disposed.state.lifecycle).toBe("disposed")
    expect(disposed.effects).toEqual([{ type: "settle-dispose" }])
    expect(transitionProfiling(disposed.state, undefined, cpuStart).reply).toEqual({
      status: "refused",
      refusal: "closed",
    })
  })
})
