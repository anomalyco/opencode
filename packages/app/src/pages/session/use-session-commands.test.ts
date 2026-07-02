import { describe, expect, test } from "bun:test"
import { sessionV2CommandMode } from "./command-mode"

describe("sessionV2CommandMode", () => {
  test("uses v2 command behavior for any platform when the v2 session layout is active", () => {
    expect(sessionV2CommandMode({ newLayoutDesigns: true, sessionID: "ses_123" })).toBe(true)
  })

  test("does not use v2 command behavior outside a session or v2 layout", () => {
    expect(sessionV2CommandMode({ newLayoutDesigns: true, sessionID: undefined })).toBe(false)
    expect(sessionV2CommandMode({ newLayoutDesigns: false, sessionID: "ses_123" })).toBe(false)
  })
})
