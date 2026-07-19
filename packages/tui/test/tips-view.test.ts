import { expect, test } from "bun:test"
import { selectTip } from "../src/feature-plugins/home/tips-view"

test("uses the randomized tip while connected or still loading", () => {
  const tips = ["first", "second"]
  expect(selectTip(tips, 0.75, true)).toBe("second")
  expect(selectTip(tips, 0.75, undefined)).toBe("second")
})

test("uses the no-models tip when disconnected is known", () => {
  expect(selectTip(["tip"], 0, false)).toContain("/connect")
})
