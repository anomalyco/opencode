import { expect, test } from "bun:test"
import { mapLimit } from "./pool"

test("bounds concurrent work and preserves input order", async () => {
  let active = 0
  let peak = 0
  const output = await mapLimit([1, 2, 3, 4], 2, async (item) => {
    active++
    peak = Math.max(peak, active)
    await Promise.resolve()
    active--
    return item * 2
  })
  expect(output).toEqual([2, 4, 6, 8])
  expect(peak).toBe(2)
})
