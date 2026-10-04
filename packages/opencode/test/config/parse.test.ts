import { expect, test } from "bun:test"
import { ConfigParse } from "@/config/parse"

test.each([1, 10, 100])("aligns a JSONC error caret on line %i", (line) => {
  const text = [...Array.from({ length: line - 1 }, () => "//"), '{"a": 1} X'].join("\n")
  const message = (() => {
    try {
      ConfigParse.jsonc(text, "opencode.jsonc")
    } catch (error) {
      const detail = (error as { data?: { message?: string } }).data?.message
      return detail ?? (error instanceof Error ? error.message : String(error))
    }
    throw new Error("expected JSONC parsing to fail")
  })()
  const rows = message.split("\n")
  const source = rows.findIndex((row) => row.startsWith(`   Line ${line}: `))
  if (source === -1) throw new Error(`missing source line in parse error:\n${message}`)

  expect(rows[source + 1]?.indexOf("^")).toBe(rows[source]?.indexOf("X"))
})
