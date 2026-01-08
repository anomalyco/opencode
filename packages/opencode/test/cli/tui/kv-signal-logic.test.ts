import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"

describe("context.kv.signal-logic", () => {
  test("signal setter works with direct values", () => {
    const [getter, setter] = createSignal("auto" as "auto" | "show" | "hide")

    expect(getter()).toBe("auto")

    setter("show")
    expect(getter()).toBe("show")
  })

  test("signal setter works with functional updates", () => {
    const [getter, setter] = createSignal(true)

    expect(getter()).toBe(true)

    setter((prev) => {
      expect(prev).toBe(true)
      return false
    })

    expect(getter()).toBe(false)
  })

  test("signal setter handles multiple rapid updates", () => {
    const [getter, setter] = createSignal(0)

    for (let i = 0; i < 10; i++) {
      setter(i)
    }

    expect(getter()).toBe(9)
  })

  test("signal setter with string union types", () => {
    const [getter, setter] = createSignal("hide" as "show" | "hide")

    expect(getter()).toBe("hide")

    setter("show")
    expect(getter()).toBe("show")

    setter("hide")
    expect(getter()).toBe("hide")
  })

  test("signal functional update receives correct previous value", () => {
    const [getter, setter] = createSignal("auto" as "auto" | "show" | "hide")

    const transitions: Array<string> = []

    setter((prev) => {
      transitions.push(prev)
      return prev === "auto" ? "show" : prev === "show" ? "hide" : "auto"
    })

    expect(getter()).toBe("show")
    expect(transitions).toEqual(["auto"])
  })

  test("signal toggling pattern", () => {
    const [getter, setter] = createSignal(false)

    // Toggle on
    setter((prev) => !prev)
    expect(getter()).toBe(true)

    // Toggle off
    setter((prev) => !prev)
    expect(getter()).toBe(false)

    // Toggle on again
    setter((prev) => !prev)
    expect(getter()).toBe(true)
  })
})
