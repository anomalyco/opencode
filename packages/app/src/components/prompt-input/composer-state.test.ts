import { describe, expect, test } from "bun:test"
import { hasDrawContent } from "./drawing"
import { followupQueueAllowed, promptHasDraft, sessionBusy, submitIntent } from "./composer-state"

describe("sessionBusy", () => {
  test("idle without in-flight assistant", () => {
    expect(sessionBusy({ type: "idle" }, [{ role: "assistant", time: { completed: 1 } }])).toBe(false)
  })

  test("non-idle status", () => {
    expect(sessionBusy({ type: "running" }, [])).toBe(true)
  })

  test("in-flight assistant", () => {
    expect(sessionBusy({ type: "idle" }, [{ role: "assistant", time: {} }])).toBe(true)
  })
})

describe("submitIntent", () => {
  test("stop when busy without draft", () => {
    expect(submitIntent(true, false, true)).toBe("stop")
  })

  test("queue when busy with draft and queue allowed", () => {
    expect(submitIntent(true, true, true)).toBe("queue")
  })

  test("send when busy with draft but queue off", () => {
    expect(submitIntent(true, true, false)).toBe("send")
  })
})

describe("followupQueueAllowed", () => {
  test("false without session", () => {
    expect(followupQueueAllowed(undefined, true, true)).toBe(false)
  })

  test("false when followup mode is not queue", () => {
    expect(followupQueueAllowed("ses_1", false, true)).toBe(false)
  })

  test("false when session is idle", () => {
    expect(followupQueueAllowed("ses_1", true, false)).toBe(false)
  })

  test("true when queue mode and session is busy", () => {
    expect(followupQueueAllowed("ses_1", true, true)).toBe(true)
  })
})

describe("promptHasDraft", () => {
  test("whitespace only is empty", () => {
    expect(promptHasDraft([{ type: "text", content: "   ", start: 0, end: 3 }])).toBe(false)
  })

  test("non-text part counts as draft", () => {
    expect(
      promptHasDraft([
        {
          type: "image",
          id: "img-1",
          filename: "a.png",
          mime: "image/png",
          dataUrl: "data:image/png;base64,AA==",
        },
      ]),
    ).toBe(true)
  })
})

describe("hasDrawContent", () => {
  test("visible stroke counts as content", () => {
    expect(hasDrawContent([{ isDeleted: false }, { isDeleted: true }])).toBe(true)
  })

  test("all deleted is empty", () => {
    expect(hasDrawContent([{ isDeleted: true }])).toBe(false)
  })
})
