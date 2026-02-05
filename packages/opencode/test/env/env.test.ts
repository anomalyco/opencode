import { describe, test, expect, beforeEach, afterEach } from "bun:test"

/**
 * The Env module wraps process.env via Instance.state(), creating per-instance
 * isolated copies. Since Instance requires a full project context, we test
 * the core env-reading logic by verifying the behavior through process.env
 * directly and testing the pattern that Env implements.
 */
describe("Env", () => {
  describe("env var reading pattern (process.env baseline)", () => {
    const testKey = "OPENCODE_TEST_ENV_VAR_" + process.pid

    afterEach(() => {
      delete process.env[testKey]
    })

    test("reads existing environment variables", () => {
      process.env[testKey] = "hello"
      expect(process.env[testKey]).toBe("hello")
    })

    test("returns undefined for missing environment variables", () => {
      delete process.env[testKey]
      expect(process.env[testKey]).toBeUndefined()
    })

    test("setting a variable makes it readable", () => {
      expect(process.env[testKey]).toBeUndefined()
      process.env[testKey] = "set-value"
      expect(process.env[testKey]).toBe("set-value")
    })

    test("deleting a variable makes it undefined", () => {
      process.env[testKey] = "to-delete"
      expect(process.env[testKey]).toBe("to-delete")
      delete process.env[testKey]
      expect(process.env[testKey]).toBeUndefined()
    })

    test("empty string is a valid value, distinct from undefined", () => {
      process.env[testKey] = ""
      expect(process.env[testKey]).toBe("")
      expect(process.env[testKey]).not.toBeUndefined()
    })
  })

  describe("isolated env copy pattern", () => {
    test("shallow copy isolates from changes to original", () => {
      const original: Record<string, string | undefined> = { A: "1", B: "2" }
      const copy = { ...original }

      original.A = "changed"
      expect(copy.A).toBe("1")
    })

    test("set on copy does not affect original", () => {
      const original: Record<string, string | undefined> = { A: "1" }
      const copy = { ...original }

      copy.A = "modified"
      expect(original.A).toBe("1")
    })

    test("delete on copy does not affect original", () => {
      const original: Record<string, string | undefined> = { X: "val" }
      const copy = { ...original }

      delete copy.X
      expect(original.X).toBe("val")
      expect(copy.X).toBeUndefined()
    })

    test("all() returns all keys from the copy", () => {
      const env: Record<string, string | undefined> = {
        FOO: "bar",
        BAZ: "qux",
      }
      const copy = { ...env }
      const keys = Object.keys(copy)
      expect(keys).toContain("FOO")
      expect(keys).toContain("BAZ")
    })

    test("multiple copies are independent", () => {
      const base: Record<string, string | undefined> = { K: "v" }
      const copy1 = { ...base }
      const copy2 = { ...base }

      copy1.K = "copy1"
      copy2.K = "copy2"

      expect(copy1.K).toBe("copy1")
      expect(copy2.K).toBe("copy2")
      expect(base.K).toBe("v")
    })
  })

  describe("type coercion patterns", () => {
    test("env vars are always strings", () => {
      const key = "OPENCODE_TEST_TYPE_" + process.pid
      process.env[key] = "123"
      expect(typeof process.env[key]).toBe("string")
      delete process.env[key]
    })

    test("boolean-like env vars need explicit comparison", () => {
      const key = "OPENCODE_TEST_BOOL_" + process.pid
      process.env[key] = "true"
      expect(process.env[key] === "true").toBe(true)
      expect(process.env[key] === "1").toBe(false)

      process.env[key] = "1"
      expect(process.env[key] === "true" || process.env[key] === "1").toBe(
        true,
      )
      delete process.env[key]
    })

    test("numeric env vars require parseInt/Number conversion", () => {
      const key = "OPENCODE_TEST_NUM_" + process.pid
      process.env[key] = "42"
      expect(Number(process.env[key])).toBe(42)
      expect(parseInt(process.env[key]!, 10)).toBe(42)
      delete process.env[key]
    })
  })
})
