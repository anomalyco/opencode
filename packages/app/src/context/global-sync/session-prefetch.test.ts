import { describe, expect, test } from "bun:test"
import {
  clearSessionPrefetch,
  clearSessionPrefetchDirectory,
  getSessionPrefetch,
  runSessionPrefetch,
  setSessionPrefetch,
  shouldSkipSessionPrefetch,
} from "./session-prefetch"

describe("session prefetch", () => {
  test("stores and clears message metadata by directory", () => {
    clearSessionPrefetch("/tmp/a", ["ses_1"])
    clearSessionPrefetch("/tmp/b", ["ses_1"])

    setSessionPrefetch({
      directory: "/tmp/a",
      sessionID: "ses_1",
      limit: 200,
      cursor: "abc",
      complete: false,
      at: 123,
    })

    expect(getSessionPrefetch("/tmp/a", "ses_1")).toEqual({ limit: 200, cursor: "abc", complete: false, at: 123 })
    expect(getSessionPrefetch("/tmp/b", "ses_1")).toBeUndefined()

    clearSessionPrefetch("/tmp/a", ["ses_1"])

    expect(getSessionPrefetch("/tmp/a", "ses_1")).toBeUndefined()
  })

  test("dedupes inflight work", async () => {
    clearSessionPrefetch("/tmp/c", ["ses_2"])

    let calls = 0
    const run = () =>
      runSessionPrefetch({
        directory: "/tmp/c",
        sessionID: "ses_2",
        task: async () => {
          calls += 1
          return { limit: 100, cursor: "next", complete: true, at: 456 }
        },
      })

    const [a, b] = await Promise.all([run(), run()])

    expect(calls).toBe(1)
    expect(a).toEqual({ limit: 100, cursor: "next", complete: true, at: 456 })
    expect(b).toEqual({ limit: 100, cursor: "next", complete: true, at: 456 })
  })

  test("clears a whole directory", () => {
    setSessionPrefetch({ directory: "/tmp/d", sessionID: "ses_1", limit: 10, cursor: "a", complete: true, at: 1 })
    setSessionPrefetch({ directory: "/tmp/d", sessionID: "ses_2", limit: 20, cursor: "b", complete: false, at: 2 })
    setSessionPrefetch({ directory: "/tmp/e", sessionID: "ses_1", limit: 30, cursor: "c", complete: true, at: 3 })

    clearSessionPrefetchDirectory("/tmp/d")

    expect(getSessionPrefetch("/tmp/d", "ses_1")).toBeUndefined()
    expect(getSessionPrefetch("/tmp/d", "ses_2")).toBeUndefined()
    expect(getSessionPrefetch("/tmp/e", "ses_1")).toEqual({ limit: 30, cursor: "c", complete: true, at: 3 })
  })

  test("refreshes stale first-page prefetched history", () => {
    expect(
      shouldSkipSessionPrefetch({
        message: true,
        info: { limit: 200, cursor: "x", complete: false, at: 1 },
        chunk: 200,
        now: 1 + 15_001,
      }),
    ).toBe(false)
  })

  test("keeps deeper or complete history cached", () => {
    expect(
      shouldSkipSessionPrefetch({
        message: true,
        info: { limit: 400, cursor: "x", complete: false, at: 1 },
        chunk: 200,
        now: 1 + 15_001,
      }),
    ).toBe(true)

    expect(
      shouldSkipSessionPrefetch({
        message: true,
        info: { limit: 120, complete: true, at: 1 },
        chunk: 200,
        now: 1 + 15_001,
      }),
    ).toBe(true)
  })
})
