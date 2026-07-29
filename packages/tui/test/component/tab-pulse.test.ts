import { expect, test } from "bun:test"
import { completionPulseOpacity, unreadGlowIntensity } from "../../src/component/tab-pulse"

test("completion pulse rises quickly and fades over the remaining duration", () => {
  expect(completionPulseOpacity(0)).toBe(0)
  expect(completionPulseOpacity(0.08)).toBeCloseTo(0.5)
  expect(completionPulseOpacity(0.16)).toBe(1)
  expect(completionPulseOpacity(0.58)).toBeCloseTo(0.5)
  expect(completionPulseOpacity(1)).toBe(0)
})

test("unread glow peaks behind the tab number and fades to the normal background", () => {
  const intensities = Array.from({ length: 22 }, (_, index) => unreadGlowIntensity(index, 22))

  expect(intensities[0]).toBe(1)
  expect(intensities[1]).toBe(1)
  expect(intensities[2]).toBeLessThan(1)
  expect(intensities.slice(1)).toEqual(intensities.slice(1).sort((a, b) => b - a))
  expect(intensities[13]).toBe(0)
  expect(intensities.at(-1)).toBe(0)
})

test("unread glow reaches the normal background on compact tabs", () => {
  expect(unreadGlowIntensity(0, 8)).toBe(1)
  expect(unreadGlowIntensity(7, 8)).toBe(0)
})
