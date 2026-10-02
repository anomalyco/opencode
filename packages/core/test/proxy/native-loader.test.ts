import { expect, test } from "bun:test"
import { load } from "../../src/proxy/native"

test("load returns undefined when the optional addon is not installed and never throws", async () => {
  const native = await load()
  expect(native).toBeUndefined()
})

test("load is memoized", async () => {
  const [first, second] = await Promise.all([load(), load()])
  expect(first).toBe(second)
})
