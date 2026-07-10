import { describe, expect, test } from "bun:test"
import { isDefaultTitle, titleStatusGlyph } from "../../src/util/session"

describe("util.session", () => {
  test("recognizes generated parent and child titles", () => {
    expect(isDefaultTitle("New session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("Child session - 2026-06-06T12:34:56.789Z")).toBeTrue()
    expect(isDefaultTitle("New session - custom")).toBeFalse()
  })

  test("animates the busy glyph between spinner frames", () => {
    expect(titleStatusGlyph({ type: "busy" }, 0)).toBe("· ")
    expect(titleStatusGlyph({ type: "busy" }, 1)).toBe(" ·")
    expect(titleStatusGlyph({ type: "busy" }, 2)).toBe("· ")
    expect(titleStatusGlyph({ type: "retry", attempt: 1, message: "", next: 0 }, 1)).toBe(" ·")
  })

  test("uses the idle glyph when idle or unknown", () => {
    expect(titleStatusGlyph({ type: "idle" }, 0)).toBe("*")
    expect(titleStatusGlyph({ type: "idle" }, 1)).toBe("*")
    expect(titleStatusGlyph(undefined)).toBe("*")
  })
})
