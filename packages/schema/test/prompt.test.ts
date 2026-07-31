import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Base64 } from "../src/prompt.js"

describe("Prompt.Base64", () => {
  const decode = Schema.decodeUnknownSync(Base64)

  test("accepts large encoded attachments", () => {
    const value = "A".repeat(5 * 1024 * 1024 + 512 * 1024)
    expect(decode(value)).toBe(value)
  })

  test("rejects malformed encoding", () => {
    for (const value of ["A", "AAAA=", "A===", "AA=A", "AAAA!"]) {
      expect(() => decode(value)).toThrow()
    }
  })
})
