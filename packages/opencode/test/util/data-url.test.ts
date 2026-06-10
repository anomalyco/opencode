import { describe, expect, test } from "bun:test"
import { decodeDataUrl } from "../../src/util/data-url"

describe("decodeDataUrl", () => {
  test("decodes base64 data URLs", () => {
    const body = '{\n  "ok": true\n}\n'
    const url = `data:text/plain;base64,${Buffer.from(body).toString("base64")}`
    expect(decodeDataUrl(url)).toBe(body)
  })

  test("decodes plain data URLs", () => {
    expect(decodeDataUrl("data:text/plain,hello%20world")).toBe("hello world")
  })

  test("returns raw body when percent-encoding is malformed", () => {
    expect(decodeDataUrl("data:text/plain,100%off")).toBe("100%off")
    expect(decodeDataUrl("data:text/plain;charset=utf-8,Reported 50% savings")).toBe("Reported 50% savings")
  })

  test("returns empty string when there is no comma", () => {
    expect(decodeDataUrl("data:text/plain")).toBe("")
  })
})
