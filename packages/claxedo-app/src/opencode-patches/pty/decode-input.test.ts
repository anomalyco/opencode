import { describe, expect, test } from "bun:test"
import { decodeInput } from "./decode-input"

describe("decodeInput", () => {
  const decoder = new TextDecoder()

  test("returns plain string input", () => {
    expect(decodeInput("abc", decoder)).toBe("abc")
  })

  test("returns event.data string input", () => {
    expect(decodeInput({ data: "abc" }, decoder)).toBe("abc")
  })

  test("decodes ArrayBuffer input", () => {
    const data = new TextEncoder().encode("abc").buffer
    expect(decodeInput(data, decoder)).toBe("abc")
  })

  test("decodes Uint8Array input", () => {
    const data = new TextEncoder().encode("abc")
    expect(decodeInput(data, decoder)).toBe("abc")
  })

  test("decodes DataView input", () => {
    const bytes = new TextEncoder().encode("abc")
    const data = new DataView(bytes.buffer)
    expect(decodeInput(data, decoder)).toBe("abc")
  })

  test("stringifies unknown input", () => {
    expect(decodeInput(42, decoder)).toBe("42")
  })

  test("ignores plain object input", () => {
    expect(decodeInput({ foo: "bar" }, decoder)).toBe("")
  })

  test("ignores nullish input", () => {
    expect(decodeInput(null, decoder)).toBe("")
    expect(decodeInput(undefined, decoder)).toBe("")
  })

  test("ignores unsupported event.data payload", () => {
    expect(decodeInput({ data: { foo: "bar" } }, decoder)).toBe("")
  })
})
