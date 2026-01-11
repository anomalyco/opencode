import { describe, expect, test } from "bun:test"
import { iife } from "../../src/util/iife"

describe("util.iife", () => {
  test("should execute function immediately and return result", () => {
    let called = false
    const result = iife(() => {
      called = true
      return 42
    })

    expect(called).toBe(true)
    expect(result).toBe(42)
  })

  test("should work with async functions", async () => {
    let called = false
    const result = await iife(async () => {
      called = true
      return "async result"
    })

    expect(called).toBe(true)
    expect(result).toBe("async result")
  })

  test("should handle functions with no return value", () => {
    let called = false
    const result = iife(() => {
      called = true
    })

    expect(called).toBe(true)
    expect(result).toBeUndefined()
  })
})
