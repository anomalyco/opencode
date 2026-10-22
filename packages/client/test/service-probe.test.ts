import { expect, test } from "bun:test"
import { stalled } from "../src/service-probe"

test("treats a probe that outlasted its own timeout by far as a stall", () => {
  expect(stalled(53_000, 2_000)).toBe(true)
  expect(stalled(2_100, 2_000)).toBe(false)
  expect(stalled(3_100, 2_000)).toBe(true)
  expect(stalled(1_200, 100)).toBe(true)
})
