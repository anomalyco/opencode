import { describe, expect, test } from "bun:test"
import { getSessionHandoff, setSessionDraft, setSessionHandoff, takeSessionDraft } from "./handoff"

describe("session handoff", () => {
  test("consumes draft and keeps other handoff state", () => {
    const key = `handoff-${Date.now()}`
    const draft = [{ type: "text" as const, content: "forked prompt", start: 0, end: 13 }]

    setSessionHandoff(key, {
      prompt: "forked prompt",
      files: {},
    })
    setSessionDraft(key, [...draft])

    expect(takeSessionDraft(key)).toEqual(draft)
    expect(takeSessionDraft(key)).toBeUndefined()
    expect(getSessionHandoff(key)).toEqual({
      prompt: "forked prompt",
      files: {},
    })
  })
})
