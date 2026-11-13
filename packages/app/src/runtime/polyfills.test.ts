import { afterEach, beforeEach, expect, test } from "bun:test"

const native = {
  groupBy: Map.groupBy,
  withResolvers: Promise.withResolvers,
  try: Promise.try,
  any:
    typeof (AbortSignal as unknown as { any?: unknown }).any === "function"
      ? (AbortSignal as unknown as { any: unknown }).any
      : undefined,
}

const maps: Partial<typeof Map> = Map

const promises: Partial<typeof Promise> = Promise

const signals: { any?: unknown } = AbortSignal

beforeEach(async () => {
  delete maps.groupBy
  delete promises.withResolvers
  delete promises.try
  signals.any = undefined
  await import(`./polyfills?${Math.random()}`)
})

afterEach(() => {
  Map.groupBy = native.groupBy
  Promise.withResolvers = native.withResolvers
  Promise.try = native.try
  signals.any = native.any
})

test("Map.groupBy keeps first-seen key order and passes the index", () => {
  const groups = Map.groupBy([1, 2, 3, 4, 5], (n) => (n % 2 ? "odd" : "even"))
  expect([...groups]).toEqual([
    ["odd", [1, 3, 5]],
    ["even", [2, 4]],
  ])
  expect([...Map.groupBy(["a", "b"], (_, index) => index).keys()]).toEqual([0, 1])
})

test("Promise.withResolvers settles from outside", async () => {
  const resolved = Promise.withResolvers<number>()
  resolved.resolve(1)
  expect(await resolved.promise).toBe(1)

  const rejected = Promise.withResolvers<number>()
  rejected.reject(new Error("no"))

  await expect(rejected.promise).rejects.toThrow("no")
})

test("Promise.try runs synchronously and isolates a throw", async () => {
  let ran = false

  const value = Promise.try(() => {
    ran = true

    return 2
  })

  expect(ran).toBe(true)
  expect(await value).toBe(2)

  expect(await Promise.try((a: number, b: number) => a + b, 1, 2)).toBe(3)

  await expect(
    Promise.try(() => {
      throw new Error("boom")
    }),
  ).rejects.toThrow("boom")
})

test("AbortSignal.any aborts when any input signal aborts and forwards the reason", () => {
  const c1 = new AbortController()
  const c2 = new AbortController()
  const c3 = new AbortController()

  const combined = AbortSignal.any([c1.signal, c2.signal, c3.signal])
  expect(combined.aborted).toBe(false)

  let abortCount = 0
  combined.addEventListener("abort", () => {
    abortCount++
  })

  c2.abort("test-reason")
  expect(combined.aborted).toBe(true)
  expect(combined.reason).toBe("test-reason")
  expect(abortCount).toBe(1)

  // Subsequent abort on another controller should not re-trigger
  c1.abort("other-reason")
  expect(combined.reason).toBe("test-reason")
  expect(abortCount).toBe(1)
})

test("AbortSignal.any returns an immediately aborted signal if an input is already aborted", () => {
  const c1 = new AbortController()
  c1.abort("pre-aborted")
  const c2 = new AbortController()

  const combined = AbortSignal.any([c1.signal, c2.signal])
  expect(combined.aborted).toBe(true)
  expect(combined.reason).toBe("pre-aborted")
})

test("AbortSignal.any returns an unaborted signal for empty iterable or unaborted inputs", () => {
  const empty = AbortSignal.any([])
  expect(empty.aborted).toBe(false)

  const c1 = new AbortController()
  const c2 = new AbortController()
  const active = AbortSignal.any([c1.signal, c2.signal])
  expect(active.aborted).toBe(false)
})
