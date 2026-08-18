import { expect, test } from "bun:test"
import { lazy } from "@opencode-ai/core/util/lazy"

test("lazy caches the resolved value and calls fn once", () => {
  let calls = 0
  const get = lazy(() => {
    calls++
    return { id: calls }
  })

  const first = get()
  expect(get()).toBe(first)
  expect(calls).toBe(1)
})

test("lazy retries after the initializer throws", () => {
  let calls = 0
  const get = lazy(() => {
    calls++
    if (calls === 1) throw new Error("transient")
    return "value"
  })

  expect(() => get()).toThrow("transient")
  expect(get()).toBe("value")
  expect(calls).toBe(2)
})

test("lazy keeps rethrowing while the initializer keeps failing", () => {
  let calls = 0
  const get = lazy(() => {
    calls++
    throw new Error("always")
  })

  expect(() => get()).toThrow("always")
  expect(() => get()).toThrow("always")
  expect(calls).toBe(2)
})

test("lazy caches an undefined result without re-running fn", () => {
  let calls = 0
  const get = lazy(() => {
    calls++
    return undefined
  })

  expect(get()).toBeUndefined()
  expect(get()).toBeUndefined()
  expect(calls).toBe(1)
})
