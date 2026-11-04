import { describe, expect, test } from "bun:test"
import { displayLabel, isExactRootFallback, isFallbackTitle, withTimestampedFallback } from "./session-title-fallback.js"

const CREATED = 1_735_689_600_000
const CREATED_ISO = "2025-01-01T00:00:00.000Z"
const ROOT_FALLBACK = `New session - ${CREATED_ISO}`
const CHILD_FALLBACK = `Child session - ${CREATED_ISO}`

describe("withTimestampedFallback", () => {
  test("keeps an authored title", () => {
    expect(withTimestampedFallback({ title: "Refactor auth", time: { created: CREATED } })).toBe("Refactor auth")
  })

  test("builds a root fallback from the creation time", () => {
    expect(withTimestampedFallback({ time: { created: CREATED } })).toBe(ROOT_FALLBACK)
  })

  test("builds a child fallback for child sessions", () => {
    expect(withTimestampedFallback({ parentID: "parent", time: { created: CREATED } })).toBe(CHILD_FALLBACK)
  })

  test("keeps an empty authored title instead of falling back", () => {
    expect(withTimestampedFallback({ title: "", time: { created: CREATED } })).toBe("")
  })
})

describe("displayLabel", () => {
  test("labels sessions without a title", () => {
    expect(displayLabel({})).toBe("New session")
    expect(displayLabel({ parentID: "parent" })).toBe("Child session")
  })

  test("collapses historical timestamped fallbacks", () => {
    expect(displayLabel({ title: ROOT_FALLBACK })).toBe("New session")
    expect(displayLabel({ title: CHILD_FALLBACK })).toBe("Child session")
  })

  test("keeps authored titles", () => {
    expect(displayLabel({ title: "Investigate flaky test" })).toBe("Investigate flaky test")
  })

  test("keeps titles that only resemble a fallback", () => {
    expect(displayLabel({ title: "New session - yesterday" })).toBe("New session - yesterday")
    expect(displayLabel({ title: "New session - 2025-01-01T00:00:00Z" })).toBe("New session - 2025-01-01T00:00:00Z")
    expect(displayLabel({ title: "Child session - 2025-01-01T00:00:00.00Z" })).toBe(
      "Child session - 2025-01-01T00:00:00.00Z",
    )
  })
})

describe("isFallbackTitle", () => {
  test("treats a missing title as a fallback", () => {
    expect(isFallbackTitle(undefined)).toBe(true)
    expect(isFallbackTitle()).toBe(true)
  })

  test("recognizes timestamped root and child fallbacks", () => {
    expect(isFallbackTitle(ROOT_FALLBACK)).toBe(true)
    expect(isFallbackTitle(CHILD_FALLBACK)).toBe(true)
  })

  test("rejects authored titles and near misses", () => {
    expect(isFallbackTitle("Release notes")).toBe(false)
    expect(isFallbackTitle("")).toBe(false)
    expect(isFallbackTitle("New session")).toBe(false)
    expect(isFallbackTitle("New session - 2025-01-01T00:00:00Z")).toBe(false)
    expect(isFallbackTitle("Other session - 2025-01-01T00:00:00.000Z")).toBe(false)
    expect(isFallbackTitle("new session - 2025-01-01T00:00:00.000Z")).toBe(false)
  })
})

describe("isExactRootFallback", () => {
  test("treats a missing title as the exact root fallback", () => {
    expect(isExactRootFallback({ time: { created: CREATED } })).toBe(true)
  })

  test("accepts the root fallback for the same session", () => {
    expect(isExactRootFallback({ title: ROOT_FALLBACK, time: { created: CREATED } })).toBe(true)
  })

  test("rejects fallbacks for a different timestamp", () => {
    expect(isExactRootFallback({ title: ROOT_FALLBACK, time: { created: CREATED + 1 } })).toBe(false)
  })

  test("rejects the child fallback for the same timestamp", () => {
    expect(isExactRootFallback({ title: CHILD_FALLBACK, time: { created: CREATED } })).toBe(false)
  })

  test("rejects authored titles", () => {
    expect(isExactRootFallback({ title: "Release notes", time: { created: CREATED } })).toBe(false)
  })
})
