import { describe, expect, test } from "bun:test"
import { shouldUseV2NewSessionPage } from "./new-session-layout"

describe("shouldUseV2NewSessionPage", () => {
  test("keeps prod session pages on the legacy layout", () => {
    expect(shouldUseV2NewSessionPage({ channel: "prod", sessionID: "ses_123" })).toBe(false)
    expect(shouldUseV2NewSessionPage({ channel: "prod" })).toBe(false)
  })

  test("uses the v2 layout only for non-prod new-session pages", () => {
    expect(shouldUseV2NewSessionPage({ channel: "dev" })).toBe(true)
    expect(shouldUseV2NewSessionPage({ channel: "dev", sessionID: "ses_123" })).toBe(false)
  })
})
