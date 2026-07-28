import { expect, test } from "bun:test"
import { completionPulseOpacity } from "../../src/component/tab-pulse"

test("completion pulse rises quickly and fades over the remaining duration", () => {
  expect(completionPulseOpacity(0)).toBe(0)
  expect(completionPulseOpacity(0.08)).toBeCloseTo(0.5)
  expect(completionPulseOpacity(0.16)).toBe(1)
  expect(completionPulseOpacity(0.58)).toBeCloseTo(0.5)
  expect(completionPulseOpacity(1)).toBe(0)
})
