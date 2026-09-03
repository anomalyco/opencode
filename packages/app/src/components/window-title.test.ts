import { describe, expect, test } from "bun:test"
import { formatWindowTitle, WINDOW_TITLE_MAX_LENGTH } from "./window-title"

describe("formatWindowTitle", () => {
  test("combines the tab title and directory name", () => {
    expect(formatWindowTitle("Add window labels", "/Users/me/code/opencode")).toBe("Add window labels — opencode")
    expect(formatWindowTitle("New session", "C:\\Users\\me\\code\\opencode\\")).toBe("New session — opencode")
  })

  test("falls back to OpenCode without an active tab", () => {
    expect(formatWindowTitle()).toBe("OpenCode")
    expect(formatWindowTitle("Add window labels")).toBe("OpenCode")
    expect(formatWindowTitle(undefined, "/Users/me/code/opencode")).toBe("OpenCode")
  })

  test("bounds the complete title and truncates both long parts", () => {
    const result = formatWindowTitle(
      "An extremely long tab title that also needs to be truncated for the native menu",
      "/Users/me/code/an-extremely-long-directory-name-that-needs-truncation",
    )

    expect(Array.from(result)).toHaveLength(WINDOW_TITLE_MAX_LENGTH)
    expect(result).toStartWith("An extremely long tab")
    expect(result).toContain("… — an-extremely-")
    expect(result).toEndWith("truncation")
  })

  test("truncates both parts and gives unused directory space to the tab title", () => {
    const result = formatWindowTitle(
      "A tab title that is deliberately much longer than the configured title limit",
      "/repo",
    )

    expect(Array.from(result)).toHaveLength(WINDOW_TITLE_MAX_LENGTH)
    expect(result).toStartWith("A tab title")
    expect(result).toEndWith("… — r…o")
  })

  test("honors a small custom limit", () => {
    const result = formatWindowTitle("abcdef", "/uvwxyz", 7)

    expect(result).toBe("a… — u…")
    expect(Array.from(result)).toHaveLength(7)
  })

  test("does not split surrogate pairs while truncating", () => {
    const result = formatWindowTitle("Investigate 🚀 launch behavior", "/projects/robot-🤖-workspace", 24)

    expect(Array.from(result)).toHaveLength(24)
    expect(result).not.toContain("�")
  })
})
