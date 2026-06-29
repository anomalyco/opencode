import { describe, expect, test } from "bun:test"
import { shouldFlushPromptQueueOnStatus, type PromptQueueFlushState } from "./queue"

describe("shouldFlushPromptQueueOnStatus", () => {
  test("flushes once on a busy to idle edge", () => {
    const state: PromptQueueFlushState = { armed: false }

    expect(shouldFlushPromptQueueOnStatus(state, { sessionID: "ses", statusType: "busy", queueLength: 1 })).toBe(false)
    expect(shouldFlushPromptQueueOnStatus(state, { sessionID: "ses", statusType: "idle", queueLength: 1 })).toBe(true)
    expect(shouldFlushPromptQueueOnStatus(state, { sessionID: "ses", statusType: "idle", queueLength: 1 })).toBe(false)
  })

  test("does not flush without an active session or queued prompt", () => {
    const state: PromptQueueFlushState = { armed: true }

    expect(shouldFlushPromptQueueOnStatus(state, { statusType: "idle", queueLength: 1 })).toBe(false)

    state.armed = true
    expect(shouldFlushPromptQueueOnStatus(state, { sessionID: "ses", statusType: "idle", queueLength: 0 })).toBe(false)
  })
})
