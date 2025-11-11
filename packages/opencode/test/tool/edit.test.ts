import { describe, expect, test } from "bun:test"
import { replace } from "../../src/tool/edit"

describe("tool.edit replace", () => {
  test("replaces exact block without prefixes", () => {
    const content = ["const a = 1;", "const b = 2;", "console.log(a + b);"].join("\n")
    const oldBlock = ["const a = 1;", "const b = 2;"].join("\n")
    const newBlock = ["const a = 3;", "const b = 4;"].join("\n")
    const updated = replace(content, oldBlock, newBlock)
    expect(updated).toContain(newBlock)
    expect(updated).not.toContain(oldBlock)
    expect(updated.split("\n")[2]).toBe("console.log(a + b);")
  })

  test("replaces block when old text carries read prefixes", () => {
    const content = ["const x = 10;", "const y = 20;", "return x + y;"].join("\n")
    const oldBlock = ["0001| const x = 10;", "0002| const y = 20;"].join("\n")
    const newBlock = ["const x = 100;", "const y = 200;"].join("\n")
    const updated = replace(content, oldBlock, newBlock)
    expect(updated).toContain(newBlock)
    expect(updated).not.toContain("const x = 10;")
    expect(updated).not.toContain("const y = 20;")
  })

  test("replaces all occurrences while handling prefixes", () => {
    const content = ["const foo = 1;", "const bar = 2;", "const foo = 1;"].join("\n")
    const oldLine = "0001| const foo = 1;"
    const newLine = "const foo = 9;"
    const updated = replace(content, oldLine, newLine, true)
    const lines = updated.split("\n")
    const fooMatches = lines.filter((line) => line === newLine)
    expect(fooMatches.length).toBe(2)
    expect(updated).toContain("const bar = 2;")
  })
})
