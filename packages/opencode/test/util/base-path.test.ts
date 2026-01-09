import { describe, expect, test } from "bun:test"
import { normalizeBasePath, joinPath } from "../../src/util/base-path"

describe("util.base-path", () => {
  describe("normalizeBasePath", () => {
    test("returns empty string for root", () => {
      expect(normalizeBasePath("/")).toBe("")
      expect(normalizeBasePath(undefined)).toBe("")
    })

    test("returns empty string for empty string", () => {
      expect(normalizeBasePath("")).toBe("")
    })

    test("normalizes paths with leading slash", () => {
      expect(normalizeBasePath("/prefix")).toBe("/prefix")
      expect(normalizeBasePath("/notebook/namespace/name")).toBe("/notebook/namespace/name")
    })

    test("removes trailing slash", () => {
      expect(normalizeBasePath("/prefix/")).toBe("/prefix")
      expect(normalizeBasePath("/notebook/namespace/name/")).toBe("/notebook/namespace/name")
    })

    test("adds leading slash if missing", () => {
      expect(normalizeBasePath("prefix")).toBe("/prefix")
      expect(normalizeBasePath("notebook/namespace/name")).toBe("/notebook/namespace/name")
    })

    test("handles path without leading slash and with trailing slash", () => {
      expect(normalizeBasePath("prefix/")).toBe("/prefix")
      expect(normalizeBasePath("notebook/namespace/name/")).toBe("/notebook/namespace/name")
    })

    test("handles multiple trailing slashes", () => {
      expect(normalizeBasePath("/prefix///")).toBe("/prefix")
    })
  })

  describe("joinPath", () => {
    test("joins base path with segments", () => {
      expect(joinPath("/prefix", "api", "v1")).toBe("/prefix/api/v1")
      expect(joinPath("/prefix", "/api", "/v1")).toBe("/prefix/api/v1")
    })

    test("handles empty base path", () => {
      expect(joinPath("/", "api", "v1")).toBe("/api/v1")
      expect(joinPath("", "api", "v1")).toBe("/api/v1")
    })

    test("normalizes multiple slashes", () => {
      expect(joinPath("/prefix", "//api//", "//v1")).toBe("/prefix/api/v1")
    })

    test("handles segments with leading slashes", () => {
      expect(joinPath("/prefix", "/session")).toBe("/prefix/session")
    })

    test("handles trailing slash on base path", () => {
      expect(joinPath("/prefix/", "api")).toBe("/prefix/api")
    })
  })
})
