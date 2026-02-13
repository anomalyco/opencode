import { describe, expect, test } from "bun:test"
import { sanitizeForTitle } from "./sanitize-title"

describe("sanitizeForTitle", () => {
  test("strips ANSI color codes", () => {
    expect(sanitizeForTitle("\x1b[32mhello\x1b[0m")).toBe("hello")
  })

  test("strips SGR sequences with multiple params", () => {
    expect(sanitizeForTitle("\x1b[1;31;42mbold red on green\x1b[0m")).toBe("bold red on green")
  })

  test("strips OSC sequences (BEL terminated)", () => {
    expect(sanitizeForTitle("\x1b]0;window title\x07actual content")).toBe("actual content")
  })

  test("strips OSC sequences (ST terminated)", () => {
    expect(sanitizeForTitle("\x1b]0;window title\x1b\\actual content")).toBe("actual content")
  })

  test("truncates to 32 characters", () => {
    const long = "a".repeat(50)
    const result = sanitizeForTitle(long)
    expect(result).toBe("a".repeat(32))
  })

  test("trims whitespace", () => {
    expect(sanitizeForTitle("  hello world  ")).toBe("hello world")
  })

  test("returns null for empty string", () => {
    expect(sanitizeForTitle("")).toBeNull()
  })

  test("returns null for whitespace-only", () => {
    expect(sanitizeForTitle("   ")).toBeNull()
  })

  test("returns null for ANSI-only content", () => {
    expect(sanitizeForTitle("\x1b[32m\x1b[0m")).toBeNull()
  })

  test("preserves special characters (npm scoped packages)", () => {
    expect(sanitizeForTitle("@scope/package")).toBe("@scope/package")
  })

  test("handles mixed ANSI + content", () => {
    expect(sanitizeForTitle("\x1b[1muser\x1b[0m@\x1b[32mhost\x1b[0m:~$")).toBe("user@host:~$")
  })

  test("handles cursor movement sequences", () => {
    expect(sanitizeForTitle("\x1b[5Ahello")).toBe("hello")
  })

  test("preserves Unicode characters", () => {
    expect(sanitizeForTitle("日本語")).toBe("日本語")
  })
})
