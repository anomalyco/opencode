import { expect, test } from "bun:test"
import { workingHandoffPose } from "./row-growth"

test("computes WorkingHandoffPose curves for copy handoff and reduced motion", () => {
  expect(workingHandoffPose(0)).toEqual({
    indicatorOpacity: 1,
    indicatorBlur: 0,
    indicatorScale: 1,
    copyOpacity: 0,
    copyBlur: 6,
    copyScale: 0.6,
  })
  const mid = workingHandoffPose(0.5, true, false)
  expect(mid.indicatorOpacity).toBeLessThan(0.5)
  expect(mid.indicatorBlur).toBeGreaterThan(3)
  expect(mid.indicatorScale).toBeLessThan(0.75)
  expect(mid.copyOpacity).toBeGreaterThan(0.5)
  expect(mid.copyBlur).toBeLessThan(4.5)
  expect(mid.copyScale).toBeGreaterThan(0.8)
  expect(workingHandoffPose(1, true, false)).toEqual({
    indicatorOpacity: 0,
    indicatorBlur: 6,
    indicatorScale: 0.5,
    copyOpacity: 1,
    copyBlur: 0,
    copyScale: 1,
  })
  expect(workingHandoffPose(0.5, true, true)).toEqual({
    indicatorOpacity: 0.5,
    indicatorBlur: 0,
    indicatorScale: 1,
    copyOpacity: 0.5,
    copyBlur: 0,
    copyScale: 1,
  })
})
