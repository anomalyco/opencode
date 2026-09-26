import { expect, test } from "bun:test"
import { compressCachedRepaintTrace, layoutShiftSample } from "../timeline/session-tab-repaint-probe"

test("compresses repeated repaint states without losing frame samples", () => {
  const state = {
    root: 1,
    scrollTop: 10,
    scrollHeight: 20,
    bottomErrorPx: 0,
    last: true,
    rows: [{ key: "row", node: 2, top: 0, bottom: 10 }],
    mounted: 1,
    center: "content",
  }
  const trace = {
    timeOriginEpochMs: 1_000,
    startedAtPerformanceMs: 100,
    samples: [
      { observedAtMs: 16, ...state, destination: ["target"], source: [] },
      { observedAtMs: 32, ...state, destination: ["target"], source: [] },
      { observedAtMs: 48, ...state, scrollTop: 11, destination: ["target"], source: [] },
    ],
    mutations: [{ observedAtMs: 20, changed: [{ type: "add", node: 2 }] }],
    shifts: [{ occurredAtMs: 24, value: 0.1 }],
    windowMs: 1_000,
    running: false,
    stop() {},
  }
  const compressed = compressCachedRepaintTrace(trace)
  const samples = compressed.samples.flatMap((group) =>
    group.observedAtMs.map((observedAtMs) => ({ observedAtMs, ...group.state })),
  )

  expect(samples).toEqual(trace.samples)
  expect(compressed.mutations).toEqual(trace.mutations)
  expect(compressed.shifts).toEqual(trace.shifts)
})

test("records layout shifts at occurrence time within the probe window", () => {
  expect(layoutShiftSample({ startTime: 99, value: 0.1 }, 100)).toBeUndefined()
  expect(layoutShiftSample({ startTime: 124, value: 0.2 }, 100)).toEqual({ occurredAtMs: 24, value: 0.2 })
})
