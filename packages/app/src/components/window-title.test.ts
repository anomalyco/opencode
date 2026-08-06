import { describe, expect, test } from "bun:test"
import { formatWindowTitle, WINDOW_TITLE_MAX_LENGTH } from "./window-title"

describe("formatWindowTitle", () => {
  test("combines the directory name and tab title", () => {
    expect(formatWindowTitle("/Users/me/code/opencode", "Add window labels")).toBe("opencode - Add window labels")
    expect(formatWindowTitle("C:\\Users\\me\\code\\opencode\\", "New session")).toBe("opencode - New session")
  })

  test("falls back to OpenCode without an active tab", () => {
    expect(formatWindowTitle()).toBe("OpenCode")
    expect(formatWindowTitle("/Users/me/code/opencode")).toBe("OpenCode")
    expect(formatWindowTitle(undefined, "Add window labels")).toBe("OpenCode")
  })

  test("bounds the complete title and truncates both long parts", () => {
    const result = formatWindowTitle(
      "/Users/me/code/an-extremely-long-directory-name-that-needs-truncation",
      "An extremely long tab title that also needs to be truncated for the native menu",
    )

    expect(Array.from(result)).toHaveLength(WINDOW_TITLE_MAX_LENGTH)
    expect(result).toStartWith("an-extremely-")
    expect(result).toContain("…")
    expect(result).toEndWith("…")
  })

  test("gives unused directory space to the tab title", () => {
    const result = formatWindowTitle(
      "/repo",
      "A tab title that is deliberately much longer than the configured title limit",
    )

    expect(Array.from(result)).toHaveLength(WINDOW_TITLE_MAX_LENGTH)
    expect(result).toStartWith("repo - A tab title")
    expect(result).toEndWith("…")
  })

  test("does not split surrogate pairs while truncating", () => {
    const result = formatWindowTitle("/projects/robot-🤖-workspace", "Investigate 🚀 launch behavior", 24)

    expect(Array.from(result)).toHaveLength(24)
    expect(result).not.toContain("�")
  })
})
