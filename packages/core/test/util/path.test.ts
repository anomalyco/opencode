import { describe, expect, test } from "bun:test"
import { getDirectory, getFilenameTruncated, truncateMiddle } from "@opencode-ai/core/util/path"

describe("util.path", () => {
  describe("getDirectory", () => {
    test("returns the parent directory with a trailing separator", () => {
      expect(getDirectory("packages/core/src/util/path.ts")).toBe("packages/core/src/util/")
      expect(getDirectory("src/index.ts")).toBe("src/")
    })

    test("returns an empty string for a path with no directory part", () => {
      expect(getDirectory("README.md")).toBe("")
      expect(getDirectory("")).toBe("")
      expect(getDirectory(undefined)).toBe("")
    })
  })

  describe("truncateMiddle", () => {
    test("never returns more characters than maxLength", () => {
      const text = "packages/core/src/util/path.ts"
      for (const width of [0, 1, 2, 3, 4, 10, text.length - 1]) {
        expect(truncateMiddle(text, width).length).toBeLessThanOrEqual(width)
      }
    })

    test("keeps both ends once there is room for them", () => {
      expect(truncateMiddle("abcdefgh", 1)).toBe("…")
      expect(truncateMiddle("abcdefgh", 2)).toBe("a…")
      expect(truncateMiddle("abcdefgh", 3)).toBe("a…h")
      expect(truncateMiddle("abcdefgh", 5)).toBe("ab…gh")
    })

    test("returns the input unchanged when it already fits", () => {
      expect(truncateMiddle("abc", 3)).toBe("abc")
      expect(truncateMiddle("abc", 10)).toBe("abc")
    })
  })

  describe("getFilenameTruncated", () => {
    test("never returns more characters than maxLength", () => {
      for (const width of [0, 1, 2, 5, 14]) {
        expect(getFilenameTruncated("src/very-long-file-name.ts", width).length).toBeLessThanOrEqual(width)
      }
    })

    test("keeps the extension when there is room for it", () => {
      expect(getFilenameTruncated("src/very-long-file-name.ts", 14)).toBe("very-long-….ts")
    })
  })
})
