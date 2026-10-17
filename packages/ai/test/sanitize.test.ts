import { describe, expect, test } from "bun:test"
import { Media, Message } from "../src/index.js"
import { sanitizeSurrogates } from "../src/utils/sanitize.js"

describe("sanitizeSurrogates", () => {
  test("returns well-formed input by reference", () => {
    const message = Message.user("valid \u{1F600}")
    const input = { messages: [message], metadata: { nested: ["valid", { "key \u{1F600}": "value" }] } }

    const sanitized = sanitizeSurrogates(input)

    expect(sanitized).toBe(input)
  })

  test("reallocates only along the path to a repaired string", () => {
    const untouched = { list: ["a", "b"] }
    const sibling = Message.user("sibling")
    const input = {
      untouched,
      messages: [sibling, Message.user("broken \uD800")],
      metadata: { deep: { list: ["valid", { text: "lone \uDC00" }] } },
    }

    const sanitized = sanitizeSurrogates(input)

    expect(sanitized).not.toBe(input)
    expect(sanitized.untouched).toBe(untouched)
    expect(sanitized.messages).not.toBe(input.messages)
    expect(sanitized.messages[0]).toBe(sibling)
    expect(sanitized.messages[1].content).toEqual([{ type: "text", text: "broken \uFFFD" }])
    expect(sanitized.metadata.deep.list).toEqual(["valid", { text: "lone \uFFFD" }])
    expect(input.metadata.deep.list[1]).toEqual({ text: "lone \uDC00" })
  })

  test("repairs record keys and preserves key order", () => {
    const value = { inner: true }
    const input = { first: 1, "key \uD800": value, last: 3 }

    const sanitized = sanitizeSurrogates(input)

    expect(Object.entries(sanitized)).toEqual([
      ["first", 1],
      ["key \uFFFD", value],
      ["last", 3],
    ])
    expect(Object.values(sanitized)[1]).toBe(value)
  })

  test("passes binary and media assets through without walking them", () => {
    const bytes = new Uint8Array([1, 2, 3])
    const asset = Media.url("https://example.test/\uD800")
    const input = { bytes, asset, text: "lone \uDC00" }

    const sanitized = sanitizeSurrogates(input)

    expect(sanitized.bytes).toBe(bytes)
    expect(sanitized.asset).toBe(asset)
    expect(sanitized.text).toBe("lone \uFFFD")
  })
})
