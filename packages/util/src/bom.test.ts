import { expect, test } from "bun:test"
import { Bom } from "./bom.js"

test.each([
  { prefix: "", bom: false, expected: undefined },
  { prefix: "", bom: true, expected: "\uFEFF" },
  { prefix: "\uFEFF", bom: false, expected: "" },
  { prefix: "\uFEFF", bom: true, expected: undefined },
  { prefix: "\uFEFF\uFEFF", bom: false, expected: "" },
  { prefix: "\uFEFF\uFEFF", bom: true, expected: "\uFEFF" },
])("syncBytes(%j)", (row) => {
  const encoder = new TextEncoder()
  const text = "a\uFEFF\u00e9"
  const input = encoder.encode(row.prefix + text)

  expect(Bom.syncBytes(input, row.bom)).toEqual({
    text,
    bytes: row.expected === undefined ? undefined : encoder.encode(row.expected + text),
  })
  expect(input).toEqual(encoder.encode(row.prefix + text))
})
