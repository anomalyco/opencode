import { describe, expect, test } from "bun:test"
import { WakeWatch } from "../../src/provider/wake"
import { SessionRetry } from "../../src/session/retry"

describe("WakeWatch", () => {
  test("handleWake aborts registered streams with a retryable reason", () => {
    const ctl = new AbortController()
    WakeWatch.register(ctl)

    WakeWatch.handleWake()

    expect(ctl.signal.aborted).toBe(true)
    const reason = ctl.signal.reason as Error
    expect(reason.message).toBe("connection reset (resumed from sleep)")
  })

  test("unregister removes a stream so wake does not abort it", () => {
    const ctl = new AbortController()
    const unregister = WakeWatch.register(ctl)

    unregister()
    WakeWatch.handleWake()

    expect(ctl.signal.aborted).toBe(false)
  })

  test("wake abort reason classifies as a retryable network error", () => {
    const error = { name: "", data: { message: "connection reset (resumed from sleep)" } }
    expect(SessionRetry.retryable(error as any, "ollama-cloud")).toEqual({
      message: "connection reset (resumed from sleep)",
    })
  })
})
