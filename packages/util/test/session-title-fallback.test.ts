import { describe, expect, test } from "bun:test"
import { SessionTitleFallback } from "../src/session-title-fallback.js"

const root = { title: undefined, time: { created: 0 } }
const child = { ...root, parentID: "ses_parent" }

describe("SessionTitleFallback", () => {
  test("supplies timestamped compatibility titles", () => {
    expect(SessionTitleFallback.withTimestampedFallback(root)).toBe("New session - 1970-01-01T00:00:00.000Z")
    expect(SessionTitleFallback.withTimestampedFallback(child)).toBe("Child session - 1970-01-01T00:00:00.000Z")
    expect(SessionTitleFallback.withTimestampedFallback({ ...root, title: "Generated title" })).toBe("Generated title")
    expect(SessionTitleFallback.withTimestampedFallback({ ...root, title: "" })).toBe("")
  })

  test("supplies compact display labels", () => {
    expect(SessionTitleFallback.displayLabel(root)).toBe("New session")
    expect(SessionTitleFallback.displayLabel(child)).toBe("Child session")
    expect(SessionTitleFallback.displayLabel({ title: "", parentID: "ses_parent" })).toBe("Child session")
    expect(SessionTitleFallback.displayLabel({ title: "New session - 2026-07-30T18:45:03.662Z" })).toBe("New session")
    expect(SessionTitleFallback.displayLabel({ title: "Child session - 2026-07-30T18:45:03.662Z" })).toBe(
      "Child session",
    )
    expect(SessionTitleFallback.displayLabel({ title: "Generated title" })).toBe("Generated title")
  })

  test("recognizes historical fallback titles", () => {
    expect(SessionTitleFallback.isFallbackTitle(undefined)).toBeTrue()
    expect(SessionTitleFallback.isFallbackTitle("New session - 2026-07-30T18:45:03.662Z")).toBeTrue()
    expect(SessionTitleFallback.isFallbackTitle("Child session - 2026-07-30T18:45:03.662Z")).toBeTrue()
    expect(SessionTitleFallback.isFallbackTitle("")).toBeFalse()
    expect(SessionTitleFallback.isFallbackTitle("New session - custom")).toBeFalse()
  })

  test("recognizes only the fallback associated with a session", () => {
    expect(SessionTitleFallback.isExactRootFallback(root)).toBeTrue()
    expect(
      SessionTitleFallback.isExactRootFallback({ ...root, title: "New session - 1970-01-01T00:00:00.000Z" }),
    ).toBeTrue()
    expect(
      SessionTitleFallback.isExactRootFallback({ ...root, title: "New session - 2099-01-01T00:00:00.000Z" }),
    ).toBeFalse()
    expect(
      SessionTitleFallback.isExactRootFallback({
        ...child,
        title: "Child session - 1970-01-01T00:00:00.000Z",
      }),
    ).toBeFalse()
  })
})
