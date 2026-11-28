import { afterEach, beforeEach, expect, test } from "bun:test"

const native = {
  groupBy: Map.groupBy,
  withResolvers: Promise.withResolvers,
  try: Promise.try,
  toSorted: Array.prototype.toSorted,
  toReversed: Array.prototype.toReversed,
  toSpliced: Array.prototype.toSpliced,
}

const maps: Partial<typeof Map> = Map

const promises: Partial<typeof Promise> = Promise

const arrays: { toSorted?: unknown; toReversed?: unknown; toSpliced?: unknown } = Array.prototype

beforeEach(async () => {
  delete maps.groupBy
  delete promises.withResolvers
  delete promises.try
  delete arrays.toSorted
  delete arrays.toReversed
  delete arrays.toSpliced
  await import(`./polyfills?${Math.random()}`)
})

afterEach(() => {
  Map.groupBy = native.groupBy
  Promise.withResolvers = native.withResolvers
  Promise.try = native.try
  // Restored with defineProperty so the methods stay non-enumerable for later tests, like the shims and the natives.
  Object.defineProperty(Array.prototype, "toSorted", { value: native.toSorted, writable: true, configurable: true })
  Object.defineProperty(Array.prototype, "toReversed", { value: native.toReversed, writable: true, configurable: true })
  Object.defineProperty(Array.prototype, "toSpliced", { value: native.toSpliced, writable: true, configurable: true })
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

test("Array.prototype.toSorted sorts a copy and leaves the original alone", () => {
  const items = [3, 1, 2]
  expect(items.toSorted((a, b) => a - b)).toEqual([1, 2, 3])
  expect(items).toEqual([3, 1, 2])

  expect(["b", "a"].toSorted()).toEqual(["a", "b"])
})

test("Array.prototype.toReversed reverses a copy and leaves the original alone", () => {
  const items = [1, 2, 3]
  expect(items.toReversed()).toEqual([3, 2, 1])
  expect(items).toEqual([1, 2, 3])
})

test("Array.prototype.toSpliced removes and inserts on a copy and leaves the original alone", () => {
  const items = ["a", "b", "c", "d"]
  expect(items.toSpliced(1, 2)).toEqual(["a", "d"])
  expect(items.toSpliced(1, 0, "x")).toEqual(["a", "x", "b", "c", "d"])
  expect(items.toSpliced(-1, 1, "y")).toEqual(["a", "b", "c", "y"])
  expect(items.toSpliced(1)).toEqual(["a"])
  expect(items).toEqual(["a", "b", "c", "d"])
})

test("Array.prototype.toSpliced matches native on the argument-count edge cases", () => {
  const items = ["a", "b", "c", "d"]
  // SAFETY: the assertion only relaxes which arguments are optional; the underlying method accepts all these shapes.
  const spliced = items.toSpliced.bind(items) as (start?: number, deleteCount?: number, ...values: string[]) => string[]

  expect(spliced()).toEqual(["a", "b", "c", "d"])
  expect(spliced(undefined)).toEqual([])
  expect(spliced(2, undefined)).toEqual(["a", "b", "c", "d"])
  expect(spliced(1, undefined, "z")).toEqual(["a", "z", "b", "c", "d"])
  expect(items).toEqual(["a", "b", "c", "d"])
})

test("prototype shims are non-enumerable, like the native methods", () => {
  expect(Array.prototype.propertyIsEnumerable("toSorted")).toBe(false)
  expect(Array.prototype.propertyIsEnumerable("toReversed")).toBe(false)
  expect(Array.prototype.propertyIsEnumerable("toSpliced")).toBe(false)
})
