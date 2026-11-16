import { expect, test } from "bun:test"
import { actionGuard } from "./action-guard"

test("a new bar requires a fresh press on the answered control after its delay", () => {
  const guard = actionGuard(20)
  const target = new EventTarget()
  const event = (timeStamp: number) => ({isTrusted:true, currentTarget:target, timeStamp})
  guard.press(event(519))
  expect(guard.accept(event(530))).toBe(false)
  guard.press(event(600), true)
  expect(guard.accept(event(610))).toBe(false)
  guard.press(event(620))
  expect(actionGuard(621).accept(event(1300))).toBe(false)
  expect(guard.accept({...event(630),currentTarget:new EventTarget()})).toBe(false)
  guard.press(event(640))
  expect(guard.accept(event(650))).toBe(true)
  expect(guard.accept(event(660))).toBe(false)
})
