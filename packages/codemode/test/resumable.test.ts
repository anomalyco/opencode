import { describe, expect, test } from "bun:test"
import { Context } from "effect"
import { parseProgram } from "../src/interpreter/execute.js"
import { Interpreter } from "../src/interpreter/interpreter.js"
import { createBuiltins } from "../src/interpreter/intrinsics.js"
import { getOwn, Native, nativeRule, Obj } from "../src/interpreter/objects.js"
import { CodeMode } from "../src/index.js"
import { Effect } from "effect"
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

describe("natives only at intrinsic creation", () => {
  test("every native made with the intrinsics has a name", () => {
    const made: Array<Native> = []
    nativeRule.observe = (native) => made.push(native)
    const ctx = (() => {
      try {
        return interpreter()
      } finally {
        nativeRule.observe = undefined
      }
    })()
    expect(made.length).toBeGreaterThan(300)
    expect(
      made.filter((native) => ctx.intrinsics.nameOf(native) === undefined).map((native) => getOwn(native, "name")),
    ).toEqual([])
  })

  test("making a native once the program runs breaks the rule", () => {
    const ctx = interpreter()
    expect(() => new Native(ctx.builtins.Function, { name: "late", call: () => undefined })).toThrow(
      'Native "late" was made after the intrinsics',
    )
  })

  const value = async (code: string) => {
    const result = await Effect.runPromise(CodeMode.execute({ code, tools: {} }))
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  test("bound functions and resolvers behave as functions", async () => {
    expect(
      await value(`
        function add(a, b, c) { return [this?.k, a, b, c] }
        const bound = add.bind({ k: 1 }, 2)
        let resolve, reject
        const promise = new Promise((res, rej) => { resolve = res; reject = rej })
        const thenable = await new Promise((res) => res({ then(a, b) { a([a.name, a.length, typeof b]) } }))
        resolve(5)
        reject(6)
        return [bound.name, bound.length, typeof bound, bound(3, 4), bound.bind(null, 3).name, resolve.name, resolve.length,
          reject.name, typeof resolve, await promise, thenable]
      `),
    ).toEqual([
      "bound add",
      2,
      "function",
      [1, 2, 3, 4],
      "bound bound add",
      "resolve",
      1,
      "reject",
      "function",
      5,
      ["", 1, "function"],
    ])
  })
})
