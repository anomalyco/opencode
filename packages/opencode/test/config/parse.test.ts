import { describe, expect, test } from "bun:test"
import { JsonError } from "@opencode-ai/core/v1/config/error"
import { ConfigParse } from "@/config/parse"

function diagnostic(text: string): string {
  try {
    ConfigParse.jsonc(text, "opencode.jsonc")
  } catch (error) {
    if (error instanceof JsonError) return error.data.message ?? ""
    throw error
  }
  throw new Error("expected ConfigParse.jsonc to reject invalid input")
}

describe("ConfigParse.jsonc diagnostics", () => {
  test.each([1, 10, 100])("aligns the caret under the invalid character on line %i", (line) => {
    const problem = '{"a": 1} X'
    const text = [...Array.from({ length: line - 1 }, () => "//"), problem].join("\n")
    const prefix = `   Line ${line}: `
    const sourceRow = `${prefix}${problem}`
    const caretRow = `${" ".repeat(prefix.length + problem.indexOf("X"))}^`

    const message = diagnostic(text)

    expect(message).toContain(`${sourceRow}\n${caretRow}`)

    const rows = message.split("\n")
    const source = rows.findIndex((row) => row === sourceRow)
    expect(rows[source + 1]?.indexOf("^")).toBe(sourceRow.indexOf("X"))
  })
})
