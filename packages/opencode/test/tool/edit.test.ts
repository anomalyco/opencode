import { describe, expect, test } from "bun:test"
import { replace, unescapeString } from "../../src/tool/edit"

describe("tool.edit escaping", () => {
  test("unescapes escaped newline sequences", () => {
    expect(unescapeString('print("hello\\nworld")')).toBe('print("hello\nworld")')
  })

  test("uses unescaped replacement text for edits", () => {
    const content = "start\nold\nend\n"
    const output = replace(content, "old", 'print("hello\\nworld")')
    expect(output).toBe('start\nprint("hello\nworld")\nend\n')
  })

  test("preserves literal backslash-n when double escaped", () => {
    const output = replace("old", "old", "line1\\\\nline2")
    expect(output).toBe("line1\\nline2")
  })

  test("unescapes replacement text for replaceAll", () => {
    const output = replace("old\nold\n", "old", "a\\nb", true)
    expect(output).toBe("a\nb\na\nb\n")
  })
})
