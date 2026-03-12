import { describe, expect, test } from "bun:test"
import {
  clearSessionPrefetch,
  clearSessionPrefetchDirectory,
  getSessionPrefetch,
  runSessionPrefetch,
  setSessionPrefetch,
} from "./session-prefetch"

describe("session prefetch", () => {
  test("stores and clears message metadata by directory", () => {
    clearSessionPrefetch("/tmp/a", ["ses_1"])
    clearSessionPrefetch("/tmp/b", ["ses_1"])

    setSessionPrefetch({
      directory: "/tmp/a",
      sessionID: "ses_1",
      limit: 200,
      complete: false,
      at: 123,
    })

    expect(getSessionPrefetch("/tmp/a", "ses_1")).toEqual({ limit: 200, complete: false, at: 123 })
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
          return { limit: 100, complete: true, at: 456 }
        },
      })

    const [a, b] = await Promise.all([run(), run()])

    expect(calls).toBe(1)
    expect(a).toEqual({ limit: 100, complete: true, at: 456 })
    expect(b).toEqual({ limit: 100, complete: true, at: 456 })
  })

  test("clears a whole directory", () => {
    setSessionPrefetch({ directory: "/tmp/d", sessionID: "ses_1", limit: 10, complete: true, at: 1 })
    setSessionPrefetch({ directory: "/tmp/d", sessionID: "ses_2", limit: 20, complete: false, at: 2 })
    setSessionPrefetch({ directory: "/tmp/e", sessionID: "ses_1", limit: 30, complete: true, at: 3 })

    clearSessionPrefetchDirectory("/tmp/d")

    expect(getSessionPrefetch("/tmp/d", "ses_1")).toBeUndefined()
    expect(getSessionPrefetch("/tmp/d", "ses_2")).toBeUndefined()
    expect(getSessionPrefetch("/tmp/e", "ses_1")).toEqual({ limit: 30, complete: true, at: 3 })
  })
})
