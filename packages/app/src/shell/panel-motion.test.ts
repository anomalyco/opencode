import { expect, it } from "bun:test"
import { panelOpacity, panelSpring } from "./panel-motion"

it("scales the shared spring's time by the square root of the distance against a 480px panel", () => {
  expect(panelSpring(480)).toEqual({ duration: 0.3, bounce: 0 })
  expect(panelSpring(260).duration).toBeCloseTo(0.2208, 3)
  expect(panelSpring(260).bounce).toBe(0)
})

it("clamps the scaled time between 0.15s and 0.3s", () => {
  expect(panelSpring(40).duration).toBe(0.15)
  expect(panelSpring(2000).duration).toBe(0.3)
})

it("keeps the shared spring when the distance is unknown", () => {
  expect(panelSpring(undefined)).toEqual({ duration: 0.3, bounce: 0 })
  expect(panelSpring(0)).toEqual({ duration: 0.3, bounce: 0 })
})

it("keeps a panel's contents solid until the last stretch of travel before closed", () => {
  expect(panelOpacity(0)).toBe("")
  expect(panelOpacity(0.5)).toBe("1")
  expect(panelOpacity(0.85)).toBe("1")
  expect(Number(panelOpacity(0.925))).toBeCloseTo(0.5, 5)
  expect(panelOpacity(1)).toBe("0")
})
