import { describe, expect, test } from "bun:test"
import { hasDrawContent } from "./drawing"
import {
  followupShouldQueue,
  parseFollowupMode,
  promptHasDraft,
  sessionBusy,
  submitIntent,
} from "./composer-state"

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

describe("parseFollowupMode", () => {
  test("accepts known modes", () => {
    expect(parseFollowupMode("queue")).toBe("queue")
    expect(parseFollowupMode("steer")).toBe("steer")
    expect(parseFollowupMode("none")).toBe("none")
  })

  test("falls back to none for unknown values", () => {
    expect(parseFollowupMode("steer-old")).toBe("none")
    expect(parseFollowupMode(undefined)).toBe("none")
  })
})

describe("submitIntent", () => {
  test("stop when busy without draft", () => {
    expect(submitIntent(true, false, "queue")).toBe("stop")
  })

  test("queue when busy with draft in queue mode", () => {
    expect(submitIntent(true, true, "queue")).toBe("queue")
  })

  test("send when busy with draft in steer mode", () => {
    expect(submitIntent(true, true, "steer")).toBe("send")
  })

  test("stop when busy with draft in none mode", () => {
    expect(submitIntent(true, true, "none")).toBe("stop")
  })
})

describe("followupShouldQueue", () => {
  test("false without session", () => {
    expect(followupShouldQueue(undefined, "queue", true)).toBe(false)
  })

  test("false when mode is not queue", () => {
    expect(followupShouldQueue("ses_1", "steer", true)).toBe(false)
    expect(followupShouldQueue("ses_1", "none", true)).toBe(false)
  })

  test("false when session is idle", () => {
    expect(followupShouldQueue("ses_1", "queue", false)).toBe(false)
  })

  test("true when queue mode and session is busy", () => {
    expect(followupShouldQueue("ses_1", "queue", true)).toBe(true)
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
