import { expect, test } from "bun:test"
import { ACTIVATION_DELAY_MS, activationAllowed } from "./activation-delay"

test("a press that began before the prompt appeared, or elsewhere, never activates it", () => {
  expect(activationAllowed({ shownAt: 1_000, at: 5_000 })).toBe(false)
  expect(activationAllowed({ shownAt: 1_000, pressedAt: 950, at: 5_000 })).toBe(false)
})

test("a press on the prompt activates it only once the prompt has been there long enough to read", () => {
  // A page's double-click target: the second click lands on the new bar 100 ms after it appears.
  expect(activationAllowed({ shownAt: 1_000, pressedAt: 1_100, at: 1_100 })).toBe(false)
  expect(activationAllowed({ shownAt: 1_000, pressedAt: 1_000 + ACTIVATION_DELAY_MS - 50, at: 1_000 + ACTIVATION_DELAY_MS - 1 })).toBe(false)
  expect(activationAllowed({ shownAt: 1_000, pressedAt: 1_400, at: 1_000 + ACTIVATION_DELAY_MS })).toBe(true)
  expect(ACTIVATION_DELAY_MS).toBe(500)
})
