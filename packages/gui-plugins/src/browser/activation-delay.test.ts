import { expect, test } from "bun:test"
import { ACTIVATION_DELAY_MS, actionGuard, activationAllowed } from "./activation-delay"

test("a press that began before the prompt appeared, or elsewhere, never activates it", () => {
  expect(activationAllowed({ shownAt: 1_000, at: 5_000 })).toBe(false)
  expect(activationAllowed({ shownAt: 1_000, pressedAt: 950, at: 5_000 })).toBe(false)
})

test("a press on the prompt activates it only once the prompt has been there long enough to read", () => {
  // A page's double-click target: the second click lands on the new bar 100 ms after it appears.
  expect(activationAllowed({ shownAt: 1_000, pressedAt: 1_100, at: 1_100 })).toBe(false)
  expect(
    activationAllowed({
      shownAt: 1_000,
      pressedAt: 1_000 + ACTIVATION_DELAY_MS - 50,
      at: 1_000 + ACTIVATION_DELAY_MS - 1,
    }),
  ).toBe(false)
  // A press that began inside the delay does not count even when it ends after it; one that began after it does.
  expect(activationAllowed({ shownAt: 1_000, pressedAt: 1_400, at: 1_000 + ACTIVATION_DELAY_MS })).toBe(false)
  expect(activationAllowed({ shownAt: 1_000, pressedAt: 1_000 + ACTIVATION_DELAY_MS, at: 1_600 })).toBe(true)
  expect(ACTIVATION_DELAY_MS).toBe(500)
})

test("a new bar requires a fresh press on the answered control after its delay", () => {
  const guard = actionGuard(20)
  const target = new EventTarget()
  const event = (timeStamp: number) => ({ isTrusted: true, currentTarget: target, timeStamp })
  guard.press(event(519))
  expect(guard.accept(event(530))).toBe(false)
  guard.press(event(600), true)
  expect(guard.accept(event(610))).toBe(false)
  guard.press(event(620))
  expect(actionGuard(621).accept(event(1300))).toBe(false)
  expect(guard.accept({ ...event(630), currentTarget: new EventTarget() })).toBe(false)
  guard.press(event(640))
  expect(guard.accept(event(650))).toBe(true)
  expect(guard.accept(event(660))).toBe(false)
  // A synthetic click never answers, even after a real press.
  guard.press(event(700))
  expect(guard.accept({ ...event(710), isTrusted: false })).toBe(false)
})
