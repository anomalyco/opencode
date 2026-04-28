import { describe, expect, test } from "bun:test"
import { hasSettledLatestAssistantTurn, isSessionActuallyWorking, isSessionWorking } from "./session-working"

describe("isSessionWorking", () => {
  test("treats busy and retry as working", () => {
    expect(isSessionWorking({ type: "busy" })).toBe(true)
    expect(isSessionWorking({ type: "retry" })).toBe(true)
  })

  test("treats idle and missing status as not working", () => {
    expect(isSessionWorking({ type: "idle" })).toBe(false)
    expect(isSessionWorking(undefined)).toBe(false)
  })

  test("detects a settled latest user turn from completed assistant response", () => {
    expect(
      hasSettledLatestAssistantTurn([
        { role: "user", time: {} },
        { role: "assistant", time: { completed: Date.now() } },
      ]),
    ).toBe(true)
  })

  test("treats latest user turn as unsettled without completed assistant response", () => {
    expect(
      hasSettledLatestAssistantTurn([
        { role: "user", time: {} },
        { role: "assistant", time: {} },
      ]),
    ).toBe(false)
  })

  test("treats tool-call assistant responses as unsettled", () => {
    expect(
      hasSettledLatestAssistantTurn([
        { role: "user", time: {} },
        { role: "assistant", finish: "tool-calls", time: { completed: Date.now() } },
      ]),
    ).toBe(false)
  })

  test("suppresses stale busy state once latest assistant turn is settled", () => {
    expect(
      isSessionActuallyWorking(
        { type: "busy" },
        [
          { role: "user", time: {} },
          { role: "assistant", time: { completed: Date.now() } },
        ],
      ),
    ).toBe(false)
  })

  test("keeps busy state during tool-call turns", () => {
    expect(
      isSessionActuallyWorking(
        { type: "busy" },
        [
          { role: "user", time: {} },
          { role: "assistant", finish: "tool-calls", time: { completed: Date.now() } },
        ],
      ),
    ).toBe(true)
  })
})
