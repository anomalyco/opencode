import { describe, expect, test } from "bun:test"
import { terminalPasteText } from "./paste"

describe("terminalPasteText", () => {
  test("types one CR for a CR LF line break", () => {
    expect(terminalPasteText("echo one\r\necho two")).toBe("echo one\recho two")
  })

  test("types one CR for an LF line break", () => {
    expect(terminalPasteText("echo one\necho two")).toBe("echo one\recho two")
  })

  test("leaves a lone CR alone", () => {
    expect(terminalPasteText("echo one\recho two")).toBe("echo one\recho two")
  })

  test("keeps mixed line endings at one CR each", () => {
    expect(terminalPasteText("a\r\nb\nc\rd")).toBe("a\rb\rc\rd")
  })

  test("leaves text without a line break untouched", () => {
    expect(terminalPasteText("a\tb\\n")).toBe("a\tb\\n")
  })
})
