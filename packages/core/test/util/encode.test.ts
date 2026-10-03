import { describe, expect, test } from "bun:test"
import { base64Decode, base64Encode } from "@opencode-ai/core/util/encode"

describe("base64", () => {
  test("round trips utf-8 values", () => {
    const value = "项目/café"
    expect(base64Decode(base64Encode(value))).toBe(value)
  })

  test("throws when the decoded bytes are not valid utf-8", () => {
    // "app" is valid base64 whose bytes (6a 9a) are not valid utf-8.
    expect(() => base64Decode("app")).toThrow()
  })
})
