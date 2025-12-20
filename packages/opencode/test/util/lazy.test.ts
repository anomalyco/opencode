import { describe, expect, test } from "bun:test"
import { lazy } from "../../src/util/lazy"

describe("util.lazy", () => {
  test("should call function only once", () => {
    let callCount = 0
    const getValue = () => {
      callCount++
      return "expensive value"
    }

    const lazyValue = lazy(getValue)

    expect(callCount).toBe(0)

    const result1 = lazyValue()
    expect(result1).toBe("expensive value")
    expect(callCount).toBe(1)

    const result2 = lazyValue()
    expect(result2).toBe("expensive value")
    expect(callCount).toBe(1)
  })

  test("should preserve the same reference", () => {
    const obj = { value: 42 }
    const lazyObj = lazy(() => obj)

    const result1 = lazyObj()
    const result2 = lazyObj()

    expect(result1).toBe(obj)
    expect(result2).toBe(obj)
    expect(result1).toBe(result2)
  })

  test("should work with different return types", () => {
    const lazyString = lazy(() => "string")
    const lazyNumber = lazy(() => 123)
    const lazyBoolean = lazy(() => true)
    const lazyNull = lazy(() => null)
    const lazyUndefined = lazy(() => undefined)

    expect(lazyString()).toBe("string")
    expect(lazyNumber()).toBe(123)
    expect(lazyBoolean()).toBe(true)
    expect(lazyNull()).toBe(null)
    expect(lazyUndefined()).toBe(undefined)
  })
})
