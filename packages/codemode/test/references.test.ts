import { describe, expect, test } from "bun:test"
import {
  containsOpaqueReference,
  containsRuntimeReference,
  rejectCircularInsertion,
} from "../src/interpreter/references.js"
import { ToolReference } from "../src/tool-runtime.js"
import { CodeModeMap } from "../src/values.js"

const node = { type: "Test" }

describe("interpreter reference walks", () => {
  test("visit shared object graphs once per identity", () => {
    const shared = Array.from({ length: 24 }).reduce<unknown>((value) => [value, value], {})

    expect(containsRuntimeReference(shared)).toBe(false)
    expect(containsOpaqueReference(shared)).toBe(false)
    expect(() => rejectCircularInsertion({}, shared, "Value", node)).not.toThrow()
  })

  test("handle deeply nested values without recursive host calls", () => {
    const deep = Array.from({ length: 20_000 }).reduce<unknown>((value) => ({ value }), {})

    expect(containsRuntimeReference(deep)).toBe(false)
    expect(containsOpaqueReference(deep)).toBe(false)
    expect(() => rejectCircularInsertion({}, deep, "Value", node)).not.toThrow()
  })

  test("preserve runtime and opaque reference classification", () => {
    const tool = new ToolReference(["items", "get"])
    const map = new CodeModeMap()

    expect(containsRuntimeReference({ tool })).toBe(true)
    expect(containsOpaqueReference({ tool })).toBe(true)
    expect(containsRuntimeReference({ map })).toBe(true)
    expect(containsOpaqueReference({ map })).toBe(false)
  })

  test("short-circuit sparse arrays in index order", () => {
    const tool = new ToolReference(["items", "get"])
    const sparse: Array<unknown> = [tool]
    sparse.length = 1_000_000
    Object.defineProperty(sparse, sparse.length - 1, {
      enumerable: true,
      get: () => {
        throw new Error("walked past the decisive first child")
      },
    })

    expect(containsRuntimeReference(sparse)).toBe(true)
    expect(containsOpaqueReference(sparse)).toBe(true)

    const container = {}
    const insertion: Array<unknown> = [container]
    insertion.length = sparse.length
    Object.defineProperty(insertion, insertion.length - 1, {
      enumerable: true,
      get: () => {
        throw new Error("walked past the destination container")
      },
    })

    expect(() => rejectCircularInsertion(container, insertion, "Value", node)).toThrow(
      "Value contains a circular value.",
    )
  })

  test("skip cycles that do not reach the destination container", () => {
    const cycle: { self?: unknown } = {}
    cycle.self = cycle

    expect(containsRuntimeReference(cycle)).toBe(false)
    expect(containsOpaqueReference(cycle)).toBe(false)
    expect(() => rejectCircularInsertion({}, cycle, "Value", node)).not.toThrow()
  })

  test("reject insertion graphs that reach the destination container", () => {
    const container = {}
    const value = Array.from({ length: 20_000 }).reduce<unknown>((child) => ({ child }), container)

    expect(() => rejectCircularInsertion(container, value, "Value", node)).toThrow("Value contains a circular value.")
  })
})
