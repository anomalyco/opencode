import { describe, expect, test } from "bun:test"
import { coerceFsPath } from "../../src/util/coerce-path"
import path from "path"

describe("coerceFsPath", () => {
  describe("accepts valid inputs", () => {
    test("returns empty string for undefined", () => {
      expect(coerceFsPath(undefined)).toBe("")
    })

    test("returns empty string for null", () => {
      expect(coerceFsPath(null)).toBe("")
    })

    test("returns string as-is", () => {
      expect(coerceFsPath("/path/to/file")).toBe("/path/to/file")
      expect(coerceFsPath("relative/path")).toBe("relative/path")
      expect(coerceFsPath("")).toBe("")
    })

    test("extracts pathname from URL instance", () => {
      const url = new URL("file:///path/to/file.txt")
      expect(coerceFsPath(url)).toBe("/path/to/file.txt")
    })

    test("extracts path from object with path property", () => {
      expect(coerceFsPath({ path: "/some/path" })).toBe("/some/path")
    })

    test("extracts filePath from object with filePath property", () => {
      expect(coerceFsPath({ filePath: "/some/file.ts" })).toBe("/some/file.ts")
    })

    test("extracts cwd from object with cwd property", () => {
      expect(coerceFsPath({ cwd: "/working/dir" })).toBe("/working/dir")
    })

    test("extracts value from object with value property", () => {
      expect(coerceFsPath({ value: "/value/path" })).toBe("/value/path")
    })

    test("returns empty string for object with null path property", () => {
      expect(coerceFsPath({ path: null })).toBe("")
      expect(coerceFsPath({ filePath: undefined })).toBe("")
    })

    test("prioritizes path over other properties", () => {
      expect(coerceFsPath({ path: "/a", cwd: "/b", value: "/c" })).toBe("/a")
    })

    test("falls back to filePath when path is missing", () => {
      expect(coerceFsPath({ filePath: "/a", cwd: "/b" })).toBe("/a")
    })

    test("joins string array with path separator", () => {
      const result = coerceFsPath(["path", "to", "file"])
      expect(result).toBe(path.join("path", "to", "file"))
    })

    test("returns empty string for empty array", () => {
      expect(coerceFsPath([])).toBe("")
    })
  })

  describe("rejects invalid inputs", () => {
    test("throws for number", () => {
      expect(() => coerceFsPath(123)).toThrow(TypeError)
      expect(() => coerceFsPath(123)).toThrow("expected string or path-like object, got number")
    })

    test("throws for boolean", () => {
      expect(() => coerceFsPath(true)).toThrow(TypeError)
      expect(() => coerceFsPath(true)).toThrow("expected string or path-like object, got boolean")
    })

    test("throws for function", () => {
      expect(() => coerceFsPath(() => {})).toThrow(TypeError)
      expect(() => coerceFsPath(() => {})).toThrow("expected string or path-like object, got function")
    })

    test("throws for object without recognized path property", () => {
      expect(() => coerceFsPath({ foo: "bar" })).toThrow(TypeError)
      expect(() => coerceFsPath({ foo: "bar" })).toThrow("no recognized path property")
    })

    test("throws for object with non-string path property", () => {
      expect(() => coerceFsPath({ path: 123 })).toThrow(TypeError)
      expect(() => coerceFsPath({ path: 123 })).toThrow("object.path is not a string")
    })

    test("throws for array with non-string element", () => {
      expect(() => coerceFsPath(["a", 123, "b"])).toThrow(TypeError)
      expect(() => coerceFsPath(["a", 123, "b"])).toThrow("array element at index 1 is not a string")
    })

    test("throws for object with nested object path", () => {
      expect(() => coerceFsPath({ path: { nested: "value" } })).toThrow(TypeError)
      expect(() => coerceFsPath({ path: { nested: "value" } })).toThrow("object.path is not a string")
    })
  })

  describe("includes context in error messages", () => {
    test("includes context for primitive type error", () => {
      expect(() => coerceFsPath(123, "session route")).toThrow("in session route")
    })

    test("includes context for object property error", () => {
      expect(() => coerceFsPath({ path: 123 }, "permission check")).toThrow("in permission check")
    })

    test("includes context for unrecognized object error", () => {
      expect(() => coerceFsPath({ unknown: "value" }, "list tool")).toThrow("in list tool")
    })

    test("includes context for array element error", () => {
      expect(() => coerceFsPath(["a", null], "glob tool")).toThrow("in glob tool")
    })
  })

  describe("edge cases", () => {
    test("handles empty path property", () => {
      expect(coerceFsPath({ path: "" })).toBe("")
    })

    test("handles whitespace-only path", () => {
      expect(coerceFsPath("   ")).toBe("   ")
    })

    test("handles path with special characters", () => {
      expect(coerceFsPath("/path/with spaces/and-dashes")).toBe("/path/with spaces/and-dashes")
    })

    test("handles object toString that returns [object Object]", () => {
      // This should NOT fall through to naive String() conversion
      const badObject = { toString: () => "[object Object]" }
      expect(() => coerceFsPath(badObject)).toThrow("no recognized path property")
    })
  })
})
