import { describe, expect, test } from "bun:test"
import { getSessionHandoff, setSessionHandoff, takeSessionDraft } from "./handoff"

describe("session handoff", () => {
  test("consumes draft and keeps other handoff state", () => {
    const key = `handoff-${Date.now()}`
    const draft = [{ type: "text" as const, content: "forked prompt", start: 0, end: 13 }]

    setSessionHandoff(key, {
      prompt: "forked prompt",
      draft: [...draft],
      files: {
        "src/app.tsx": { start: 1, end: 3 },
      },
    })

    expect(takeSessionDraft(key)).toEqual(draft)
    expect(takeSessionDraft(key)).toBeUndefined()
    expect(getSessionHandoff(key)).toEqual({
      prompt: "forked prompt",
      files: {
        "src/app.tsx": { start: 1, end: 3 },
      },
      draft: undefined,
    })
  })
})
