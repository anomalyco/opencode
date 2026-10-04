import { expect, test } from "bun:test"
import { layoutShiftValue, removeVisibleRow } from "../timeline/session-timeline-stream-probe"

test("excludes layout shifts before the probe window and recent input", () => {
  expect(layoutShiftValue({ startTime: 9, value: 0.1 }, 10)).toBeUndefined()
  expect(layoutShiftValue({ startTime: 10, value: 0.2, hadRecentInput: true }, 10)).toBeUndefined()
  expect(layoutShiftValue({ startTime: 11, value: 0.3 }, 10)).toBe(0.3)
})

test("classifies removed rows from their last painted visibility", () => {
  const row = {}
  const visible = new Set([row])

  expect(removeVisibleRow(visible, row)).toBe(true)
  expect(removeVisibleRow(visible, row)).toBe(false)
})
