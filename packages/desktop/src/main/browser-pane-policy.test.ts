import { describe, expect, test } from "bun:test"
import {
  allowedBrowserURL,
  boundedBrowserOperation,
  browserBottomMasks,
  invalidateBrowserRefs,
  normalizeBrowserBounds,
  normalizeBrowserRef,
  normalizeBrowserURL,
  runBrowserInputPair,
  stopBrowserOperation,
} from "./browser-pane-policy"

async function rejected(promise: Promise<unknown>) {
  return promise.then(
    () => new Error("Expected operation to reject"),
    (error) => (error instanceof Error ? error : new Error(String(error))),
  )
}

describe("browser pane policy", () => {
  test("normalizes supported browser URLs", () => {
    expect(normalizeBrowserURL("localhost:3000/test")).toBe("http://localhost:3000/test")
    expect(normalizeBrowserURL("example.com")).toBe("https://example.com/")
    expect(normalizeBrowserURL("https://example.com/path")).toBe("https://example.com/path")
    expect(normalizeBrowserURL("file:///tmp/clicker/index.html")).toBe("file:///tmp/clicker/index.html")
  })

  test("rejects unsafe browser URLs", () => {
    expect(() => normalizeBrowserURL("javascript:alert(1)")).toThrow()
    expect(() => normalizeBrowserURL("https://user:pass@example.com")).toThrow()
    expect(allowedBrowserURL("data:text/html,test")).toBe(false)
    expect(allowedBrowserURL("file:///tmp/clicker/index.html")).toBe(true)
  })

  test("clamps browser bounds to the parent content view", () => {
    expect(
      normalizeBrowserBounds({ x: 90.4, y: 40.6, width: 50.2, height: 70.8 }, { x: 0, y: 0, width: 120, height: 100 }),
    ).toEqual({ x: 90, y: 41, width: 30, height: 59 })
    expect(
      normalizeBrowserBounds({ x: 10, y: 10, width: 0, height: 20 }, { x: 0, y: 0, width: 100, height: 100 }),
    ).toBeUndefined()
  })

  test("builds bottom-only corner masks", () => {
    expect(browserBottomMasks({ x: 100, y: 50, width: 400, height: 300 })).toEqual([
      { x: 100, y: 348, width: 6, height: 2 },
      { x: 494, y: 348, width: 6, height: 2 },
      { x: 100, y: 346, width: 3, height: 2 },
      { x: 497, y: 346, width: 3, height: 2 },
      { x: 100, y: 344, width: 2, height: 2 },
      { x: 498, y: 344, width: 2, height: 2 },
      { x: 100, y: 340, width: 1, height: 4 },
      { x: 499, y: 340, width: 1, height: 4 },
    ])
  })

  test("accepts browser refs with or without the display prefix", () => {
    expect(normalizeBrowserRef("e2")).toBe("@e2")
    expect(normalizeBrowserRef("@e2")).toBe("@e2")
  })

  test("invalidates refs when attachment ownership changes", () => {
    const state = { snapshot: 4, refs: new Map([["@e1", 1]]) }
    invalidateBrowserRefs(state)
    expect(state.snapshot).toBe(5)
    expect(state.refs.size).toBe(0)
  })

  test("stops and aborts the active operation immediately", () => {
    const active = new AbortController()
    let stopped = false
    stopBrowserOperation({
      active,
      stop: () => {
        stopped = true
      },
    })
    expect(active.signal.aborted).toBe(true)
    expect(stopped).toBe(true)
  })

  test("bounds hung operations by timeout and cancellation", async () => {
    expect(
      await boundedBrowserOperation(() => Promise.resolve(undefined), {
        timeout: 1_000,
        aborted: () => new Error("aborted"),
        timedOut: () => new Error("timed out"),
      }),
    ).toBeUndefined()

    const timeout = boundedBrowserOperation(() => new Promise<never>(() => undefined), {
      timeout: 5,
      aborted: () => new Error("aborted"),
      timedOut: () => new Error("timed out"),
    })
    expect((await rejected(timeout)).message).toBe("timed out")

    const controller = new AbortController()
    const cancelled = boundedBrowserOperation(() => new Promise<never>(() => undefined), {
      signal: controller.signal,
      timeout: 1_000,
      aborted: () => new Error("aborted"),
      timedOut: () => new Error("timed out"),
    })
    controller.abort()
    expect((await rejected(cancelled)).message).toBe("aborted")
  })

  test("releases paired input when cancellation races after press", async () => {
    const controller = new AbortController()
    const events: string[] = []
    const assert = () => {
      if (controller.signal.aborted) throw new Error("aborted")
    }
    const result = runBrowserInputPair({
      assert,
      press: async () => {
        events.push("press")
        controller.abort()
        throw new Error("aborted")
      },
      release: async () => {
        events.push("release")
      },
    })
    expect((await rejected(result)).message).toBe("aborted")
    expect(events).toEqual(["press", "release"])
  })

  test("does not dispatch paired input when already cancelled", async () => {
    const events: string[] = []
    const result = runBrowserInputPair({
      assert: () => {
        throw new Error("aborted")
      },
      press: async () => {
        events.push("press")
      },
      release: async () => {
        events.push("release")
      },
    })
    expect((await rejected(result)).message).toBe("aborted")
    expect(events).toEqual([])
  })
})
