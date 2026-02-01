import { describe, expect, test } from "bun:test"

describe("visibility", () => {
  test("wasRecentlyBackgrounded returns false when never hidden", async () => {
    const { wasRecentlyBackgrounded } = await import("./visibility")
    expect(wasRecentlyBackgrounded()).toBe(false)
  })

  test("wasRecentlyBackgrounded returns true after background/foreground cycle", async () => {
    const { wasRecentlyBackgrounded } = await import("./visibility")

    // Simulate hiding
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    await new Promise((r) => setTimeout(r, 50))

    // Simulate showing
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    expect(wasRecentlyBackgrounded(5000)).toBe(true)
  })

  test("wasRecentlyBackgrounded respects threshold", async () => {
    const { wasRecentlyBackgrounded } = await import("./visibility")

    // Simulate hide then show
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    await new Promise((r) => setTimeout(r, 50))

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    // Wait past a short threshold
    await new Promise((r) => setTimeout(r, 100))

    expect(wasRecentlyBackgrounded(50)).toBe(false)
    expect(wasRecentlyBackgrounded(5000)).toBe(true)
  })

  test("wasHiddenFor returns true when hidden long enough", async () => {
    const { wasHiddenFor } = await import("./visibility")

    // Simulate hide
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    await new Promise((r) => setTimeout(r, 100))

    // Simulate show
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    })
    document.dispatchEvent(new Event("visibilitychange"))

    expect(wasHiddenFor(50)).toBe(true)
    expect(wasHiddenFor(500)).toBe(false)
  })
})
