import { describe, expect, test } from "bun:test"
import { sessionTitle } from "./session-title"

describe("sessionTitle", () => {
  test("uses a display fallback without persisting it", () => {
    expect(sessionTitle(undefined)).toBe("New session")
    expect(sessionTitle(undefined, "ses_parent")).toBe("Child session")
    expect(sessionTitle("New session - 2026-07-30T18:45:03.662Z")).toBe("New session")
    expect(sessionTitle("Generated title")).toBe("Generated title")
  })
})
