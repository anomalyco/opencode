import { expect, test } from "bun:test"
import { classifySessionSwitch } from "../timeline/session-tab-switch-metrics"

test("counts source and blank samples before the destination is observed", () => {
  const result = classifySessionSwitch([
    { observedAtMs: 16, destination: [], source: ["source"], hasVisibleRows: true, last: false },
    { observedAtMs: 32, destination: [], source: [], hasVisibleRows: false, last: false },
    { observedAtMs: 48, destination: ["destination"], source: [], hasVisibleRows: true, last: true, bottomErrorPx: 0 },
    { observedAtMs: 64, destination: ["destination"], source: [], hasVisibleRows: true, last: true, bottomErrorPx: 0 },
    { observedAtMs: 80, destination: ["destination"], source: [], hasVisibleRows: true, last: true, bottomErrorPx: 0 },
  ])

  expect(result.blankSamples).toBe(1)
  expect(result.sourceSamples).toBe(1)
  expect(result.unknownSamples).toBe(0)
  expect(result.firstDestinationObservedMs).toBe(48)
  expect(result.stableObservedMs).toBe(80)
})

test("does not classify mixed source and destination content as correct", () => {
  const result = classifySessionSwitch([
    {
      observedAtMs: 16,
      destination: ["destination"],
      source: ["source"],
      hasVisibleRows: true,
      last: true,
      bottomErrorPx: 0,
    },
    { observedAtMs: 32, destination: ["destination"], source: [], hasVisibleRows: true, last: true, bottomErrorPx: 0 },
    { observedAtMs: 48, destination: ["destination"], source: [], hasVisibleRows: true, last: true, bottomErrorPx: 0 },
    { observedAtMs: 64, destination: ["destination"], source: [], hasVisibleRows: true, last: true, bottomErrorPx: 0 },
  ])

  expect(result.firstCorrectObservedMs).toBe(32)
  expect(result.stableObservedMs).toBe(64)
})

test("reports missing correctness without throwing", () => {
  const result = classifySessionSwitch([
    {
      observedAtMs: 16,
      destination: ["destination"],
      source: ["source"],
      hasVisibleRows: true,
      last: true,
      bottomErrorPx: 0,
    },
  ])

  expect(result.firstDestinationObservedMs).toBe(16)
  expect(result.firstCorrectObservedMs).toBeNull()
  expect(result.stableObservedMs).toBeNull()
})
