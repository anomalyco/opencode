import { describe, expect, test } from "bun:test"
import { sessionTabTitle } from "./tab-title"

describe("session tab titles", () => {
  test("uses the same localized label before a title arrives", () => {
    for (const title of [
      undefined,
      "",
      "New session - 2026-07-30T18:45:03.662Z",
      "Child session - 2026-07-30T18:45:03.662Z",
    ]) {
      expect(sessionTabTitle(title, "Session")).toBe("Session")
      expect(sessionTabTitle(title, "Sitzung")).toBe("Sitzung")
    }
  })

  test("preserves generated and user-supplied titles", () => {
    for (const title of ["Generated title", "New session", "New session - custom"]) {
      expect(sessionTabTitle(title, "Session")).toBe(title)
    }
  })
})
