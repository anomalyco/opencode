import { describe, expect, test } from "bun:test"
import { shouldUseV2NewSessionPage } from "./new-session-layout"

describe("shouldUseV2NewSessionPage", () => {
  test("keeps disabled pages on the legacy layout", () => {
    expect(shouldUseV2NewSessionPage({ newLayoutDesigns: false, sessionID: "ses_123" })).toBe(false)
    expect(shouldUseV2NewSessionPage({ newLayoutDesigns: false })).toBe(false)
  })

  test("uses the v2 layout only for enabled new-session pages", () => {
    expect(shouldUseV2NewSessionPage({ newLayoutDesigns: true })).toBe(true)
    expect(shouldUseV2NewSessionPage({ newLayoutDesigns: true, sessionID: "ses_123" })).toBe(false)
  })
})
