import { afterEach, beforeEach, expect, test } from "bun:test"

const native = { canParse: URL.canParse, groupBy: Map.groupBy, withResolvers: Promise.withResolvers, try: Promise.try }

const urls: Partial<typeof URL> = URL

const maps: Partial<typeof Map> = Map

const promises: Partial<typeof Promise> = Promise

beforeEach(async () => {
  delete urls.canParse
  delete maps.groupBy
  delete promises.withResolvers
  delete promises.try
  await import(`./polyfills?${Math.random()}`)
})

afterEach(() => {
  urls.canParse = native.canParse
  Map.groupBy = native.groupBy
  Promise.withResolvers = native.withResolvers
  Promise.try = native.try
})

test("URL.canParse validates absolute and relative URLs without native support", () => {
  expect(URL.canParse("https://opencode.ai/docs")).toBe(true)
  expect(URL.canParse("/docs", "https://opencode.ai")).toBe(true)
  expect(URL.canParse(new URL("https://opencode.ai"))).toBe(true)
  expect(URL.canParse("not a url")).toBe(false)
  expect(URL.canParse("http://[", "https://opencode.ai")).toBe(false)
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
