import { describe, expect, test } from "bun:test"
import { Context } from "effect"
import { parseProgram } from "../src/interpreter/execute.js"
import { Interpreter } from "../src/interpreter/interpreter.js"
import { createBuiltins } from "../src/interpreter/intrinsics.js"
import { Native, Obj } from "../src/interpreter/objects.js"
import { ToolRuntime } from "../src/tool-runtime.js"
import { nodeId, sourceOf } from "../src/interpreter/source.js"

// Groundwork for suspending and resuming a run: everything the state refers to has a stable name.

const interpreter = () =>
  new Interpreter<never>({
    tools: ToolRuntime.make(ToolRuntime.prepare<never>({}), undefined, {}),
    services: Context.empty(),
    builtins: createBuiltins(),
  })

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

describe("intrinsic names", () => {
  test("name every intrinsic once, from the globals first", () => {
    const names = interpreter().intrinsics
    const all = names.all()
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(names.values).size).toBe(names.values.length)
    for (const name of [
      "Array.prototype.map",
      "Promise.prototype.then",
      "String.prototype[Symbol.iterator]",
      "JSON.parse",
    ]) {
      expect(all).toContain(name)
    }
    for (const name of ["%Generator%", "%Generator%.next", "%AsyncGenerator%.return", "%IteratorHelper%.return"]) {
      expect(all).toContain(name)
    }
    all.forEach((name, index) => {
      expect(names.valueOf(name)).toBe(names.values[index]!)
      expect(names.nameOf(names.values[index]!)).toBe(name)
    })
  })

  test("cover everything reachable from a named intrinsic", () => {
    const names = interpreter().intrinsics
    for (const value of names.values) {
      for (const slot of value.props.values()) {
        if ("value" in slot && slot.value instanceof Obj) expect(names.nameOf(slot.value)).toBeDefined()
      }
      if (value.proto !== null) expect(names.nameOf(value.proto)).toBeDefined()
    }
    expect(names.values.filter((value) => value instanceof Native).length).toBeGreaterThan(300)
  })

  test("are identical across fresh runtimes", () => {
    const shape = (names: Interpreter<never>["intrinsics"]) =>
      names.all().map((name, index) => {
        const value = names.values[index]!
        return [name, value.constructor.name, [...value.props.keys()].map(String)]
      })
    expect(shape(interpreter().intrinsics)).toEqual(shape(interpreter().intrinsics))
  })

  test("are taken before the program can change a built-in", () => {
    const ctx = interpreter()
    const map = ctx.intrinsics.valueOf("Array.prototype.map")!
    const array = ctx.intrinsics.valueOf("Array.prototype")!
    array.props.delete("map")
    expect(ctx.intrinsics.nameOf(map)).toBe("Array.prototype.map")
  })
})
