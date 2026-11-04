import { describe, expect, test } from "bun:test"
import { parseProgram } from "../src/interpreter/execute.js"
import { nodeId, sourceOf } from "../src/interpreter/source.js"

// Groundwork for suspending and resuming a run: everything the state refers to has a stable name.

const parse = (code: string) => {
  const parsed = parseProgram(code)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed
}

describe("node ids", () => {
  const code = `const add = (a, b) => a + b\nfor (const x of [1, 2]) { if (x) add(x, \`t\${x}\`) }\nreturn /a/g`

  test("number every node in pre-order and resolve back to it", () => {
    const parsed = parse(code)
    const nodes = parsed.source.nodes
    expect(nodes[0]).toBe(parsed.program)
    expect(nodes.map((node) => node.type).slice(0, 6)).toEqual([
      "Program",
      "VariableDeclaration",
      "VariableDeclarator",
      "Identifier",
      "ArrowFunctionExpression",
      "Identifier",
    ])
    nodes.forEach((node, index) => {
      expect(nodeId(node)).toEqual({ source: "main", index })
      expect(parsed.source.node({ source: "main", index })).toBe(node)
      expect(sourceOf(node)).toBe(parsed.source)
    })
  })

  test("give the same ids when the same code is parsed again", () => {
    const first = parse(code).source.nodes
    const second = parse(code).source.nodes
    expect(second.map((node) => [node.type, node.start, node.end])).toEqual(
      first.map((node) => [node.type, node.start, node.end]),
    )
  })

  test("do not resolve ids from another source", () => {
    expect(parse(code).source.node({ source: "other", index: 0 })).toBeUndefined()
  })
})
