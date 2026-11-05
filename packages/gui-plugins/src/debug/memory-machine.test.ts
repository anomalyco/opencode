import { describe, expect, test } from "bun:test"
import {
  createMemoryDiagnosticsState,
  debugBarView,
  isMemoryDiagnosticsOn,
  isRendererProbing,
  transitionMemoryDiagnostics,
  type MemoryDiagnosticsEvent,
  type MemoryDiagnosticsState,
} from "./memory-machine"

const on: MemoryDiagnosticsEvent = { type: "synced", enabled: true }
const off: MemoryDiagnosticsEvent = { type: "synced", enabled: false }

function after(...events: MemoryDiagnosticsEvent[]) {
  return events.reduce<MemoryDiagnosticsState>(
    (state, event) => transitionMemoryDiagnostics(state, event).state,
    createMemoryDiagnosticsState(),
  )
}

describe("transitionMemoryDiagnostics", () => {
  test("turning on opens a run and waits an interval for the first sample", () => {
    const started = transitionMemoryDiagnostics(createMemoryDiagnosticsState(), on)

    expect(started.effects).toEqual([
      { type: "log.start", run: 1 },
      { type: "timer.schedule", run: 1 },
    ])
    expect(isMemoryDiagnosticsOn(started.state)).toBe(true)
    expect(transitionMemoryDiagnostics(started.state, on).state).toBe(started.state)
  })

  test("a sample still collecting when diagnostics turn off writes nothing and schedules nothing", () => {
    const sampling = after(on, { type: "tick", run: 1 })
    const stopped = transitionMemoryDiagnostics(sampling, off)

    expect(stopped.effects).toEqual([{ type: "timer.cancel" }, { type: "log.stop", run: 1 }])
    expect(
      transitionMemoryDiagnostics(stopped.state, { type: "sample.collected", attempt: 2, line: "{}\n" }).effects,
    ).toEqual([])
    expect(transitionMemoryDiagnostics(stopped.state, { type: "sample.written", attempt: 2 }).effects).toEqual([])

    // Nor once diagnostics are on again: the sample belongs to the earlier run.
    const restarted = after(on, { type: "tick", run: 1 }, off, on)

    expect(
      transitionMemoryDiagnostics(restarted, { type: "sample.collected", attempt: 2, line: "{}\n" }).state,
    ).toBe(restarted)
  })

  test("a hung renderer stays skipped across off and on until its probe settles", () => {
    const state = after(on, { type: "probe.started", contentsId: 7 }, off, on)

    expect(isRendererProbing(state, 7)).toBe(true)
    expect(isRendererProbing(transitionMemoryDiagnostics(state, { type: "probe.settled", contentsId: 7 }).state, 7)).toBe(
      false,
    )
  })

  test("a sample writes its line, then waits for the next interval; a failure is logged and waits too", () => {
    const sampling = transitionMemoryDiagnostics(after(on), { type: "tick", run: 1 })

    expect(sampling.effects).toEqual([{ type: "sample.collect", attempt: 2 }])
    expect(transitionMemoryDiagnostics(sampling.state, { type: "tick", run: 1 }).state).toBe(sampling.state)

    const collected = transitionMemoryDiagnostics(sampling.state, {
      type: "sample.collected",
      attempt: 2,
      line: "{}\n",
    })

    expect(collected.effects).toEqual([{ type: "sample.write", attempt: 2, line: "{}\n" }])
    expect(transitionMemoryDiagnostics(collected.state, { type: "sample.written", attempt: 2 }).effects).toEqual([
      { type: "timer.schedule", run: 1 },
    ])
    expect(
      transitionMemoryDiagnostics(sampling.state, { type: "sample.failed", attempt: 2, error: "EACCES" }).effects,
    ).toEqual([
      { type: "sample.report", error: "EACCES" },
      { type: "timer.schedule", run: 1 },
    ])
  })

  test("disposing stops a running log", () => {
    expect(transitionMemoryDiagnostics(after(on), { type: "disposed" })).toEqual({
      state: { status: "disposed" },
      effects: [{ type: "timer.cancel" }, { type: "log.stop", run: 1 }],
    })
    expect(transitionMemoryDiagnostics(after(), { type: "disposed" }).effects).toEqual([])
  })
})

describe("debugBarView", () => {
  test("running diagnostics pin the bar without a close button, and the Knobs open from it", () => {
    expect(debugBarView({ visible: false, motion: true }, { on: true })).toEqual({
      visibility: "pinned",
      open: true,
      closable: false,
      togglable: false,
      motion: true,
    })
  })

  test("otherwise the stored visibility decides", () => {
    expect(debugBarView({ visible: true, motion: false }, { on: false })).toEqual({
      visibility: "shown",
      open: true,
      closable: true,
      togglable: true,
      motion: false,
    })
    expect(debugBarView({ visible: false, motion: true }, undefined)).toMatchObject({ open: false, motion: false })
  })
})
