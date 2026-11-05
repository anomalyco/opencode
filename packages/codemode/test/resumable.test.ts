import { describe, expect, test } from "bun:test"
import { parseProgram } from "../src/interpreter/execute.js"
import { Interpreter } from "../src/interpreter/interpreter.js"
import { createBuiltins } from "../src/interpreter/intrinsics.js"
import { getOwn, Native, nativeRule, Obj } from "../src/interpreter/objects.js"
import { CodeMode } from "../src/index.js"
import { decode, encode } from "../src/snapshot/codec.js"
import { Lost, PendingThrow } from "../src/interpreter/model.js"
import { normalizeError } from "../src/interpreter/errors.js"
import { Effect } from "effect"
import { ToolRuntime } from "../src/tool-runtime.js"
import { nodeId, sourceOf } from "../src/interpreter/source.js"
import { finished } from "./finished.js"

// Groundwork for suspending and resuming a run: everything the state refers to has a stable name.

const interpreter = () =>
  new Interpreter<never>({
    tools: ToolRuntime.make(ToolRuntime.prepare<never>({}), undefined, {}),
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
    const result = await Effect.runPromise(finished(CodeMode.execute({ code, tools: {} })))
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

describe("heap as data", () => {
  // Each program's result must match the host engine's.
  const programs = {
    "map iteration is live": `
      const m = new Map([[1, 1], [2, 2], [3, 3]])
      const out = []
      for (const [k] of m) {
        out.push(k)
        if (k === 1) { m.delete(2); m.set(4, 4) }
        if (k === 3) { m.clear(); m.set(5, 5) }
      }
      return [out, [...m]]`,
    "a live iterator survives compaction": `
      const m = new Map(Array.from({ length: 100 }, (_, i) => [i, i]))
      const it = m.keys()
      const seen = []
      for (let i = 0; i < 10; i++) seen.push(it.next().value)
      for (let i = 0; i < 80; i++) m.delete(i)
      seen.push(...it)
      const s = new Set(Array.from({ length: 100 }, (_, i) => i))
      const values = s.values()
      for (let i = 0; i < 50; i++) values.next()
      for (let i = 50; i < 90; i++) s.delete(i)
      for (let i = 0; i < 40; i++) s.delete(i)
      return [seen, values.next().value, [...s].length, m.size]`,
    "clear mid-iteration continues with new entries": `
      const s = new Set([1, 2, 3])
      const it = s.values()
      const out = [it.next().value]
      s.clear()
      s.add(7)
      out.push(...it)
      s.add(8)
      return [out, it.next().done, [...s.entries()]]`,
    "keys compare by SameValueZero": `
      const s = new Set([-0, NaN, NaN, 0])
      const m = new Map([[-0, "a"]])
      return [s.size, 1 / [...s][0], 1 / [...m.keys()][0], m.get(0), s.has(NaN)]`,
    "forEach visits entries added during the walk": `
      const m = new Map([["a", 1]])
      const out = []
      m.forEach((v, k) => { out.push(k); if (m.size < 4) m.set(k + "x", v + 1) })
      const s = new Set([1, 2, 3])
      const seen = []
      s.forEach((v) => { seen.push(v); s.delete(v + 1) })
      return [out, seen]`,
    "set operations read the live table": `
      const a = new Set([1, 2, 3, 4])
      const other = { size: 10, has(v) { a.delete(v + 1); return true }, keys() { return [][Symbol.iterator]() } }
      return [[...a.intersection(other)], [...a]]`,
    "array, string and bytes iterators keep a position": `
      const a = [1, 2]
      const it = a.values()
      it.next()
      a.push(3)
      const rest = [...it]
      a.push(4)
      const done = it.next().done
      const entries = [...[5, , 6].entries()]
      return [rest, done, entries, [..."a😀b"], [...new Uint8Array([1, 2]).entries()], [...[7, 8].keys()]]`,
    "headers and search params iterate the live sorted list": `
      const h = new Headers({ b: "1", d: "2" })
      const hk = h.keys()
      const first = hk.next().value
      h.append("a", "x")
      h.append("c", "y")
      const p = new URLSearchParams("b=1&d=2")
      const pk = p.keys()
      const pFirst = pk.next().value
      p.append("a", "x")
      p.delete("b")
      return [first, [...hk], pFirst, [...pk], [...h.entries()], [...p]]`,
    "a RegExp keeps lastIndex as a field shared with the String methods": `
      const r = /a/g
      const out = [r.exec("aaa").index, r.lastIndex]
      out.push("xaxa".replace(r, "b"), r.lastIndex)
      r.lastIndex = 1
      out.push(r.test("ab"), r.lastIndex, r.test("ab"), r.lastIndex)
      const y = /a/y
      y.lastIndex = 1
      out.push("ba".search(y), y.lastIndex, "ba".match(y)?.[0], y.lastIndex, "ba".split(y), y.lastIndex)
      r.lastIndex = 2
      out.push([..."aaaa".matchAll(r)].length, r.lastIndex, new RegExp(r).lastIndex, String(new RegExp(r, "i")))
      return out`,
  }

  for (const [name, code] of Object.entries(programs)) {
    test(name, async () => {
      const expected: unknown = await new Function(`return (async () => {${code}})()`)()
      const result = await Effect.runPromise(finished(CodeMode.execute({ code, tools: {} })))
      if (!result.ok) throw new Error(result.error.message)
      expect(result.value).toEqual(JSON.parse(JSON.stringify(expected)))
    })
  }
})

describe("prelude", () => {
  test("a run saved and restored while prelude built-ins run continues in their frames", async () => {
    const child = Bun.spawn(["bun", `${import.meta.dir}/fixtures/prelude-roundtrip.ts`], {
      env: { ...process.env, CODEMODE_ROUNDTRIP: "1" },
      stdout: "pipe",
      stderr: "inherit",
    })
    const output = JSON.parse(await new Response(child.stdout).text())
    expect(await child.exited).toBe(0)
    expect(output.result).toMatchObject({
      ok: true,
      value: [{ odd: [1, 3, 5], even: [2, 4, 6] }, [1, 2, 3, 7, 8], { a: [10, 20, { b: 30 }] }, 6],
    })
    expect(output.saved).toBeGreaterThan(0)
  })

  test("prelude functions look like built-ins and are named by their path", () => {
    const names = interpreter().intrinsics
    const groupBy = names.valueOf("Object.groupBy")!
    expect(getOwn(groupBy, "name")).toBe("groupBy")
    expect(getOwn(groupBy, "length")).toBe(2)
    expect(names.all()).toContain("%Prelude%.fillCollection")
    expect(names.all()).toContain("%PreludeHelpers%.$Call")
  })
  test("programs can't see the helpers or internal functions, and failures inside are located at the call", async () => {
    const run = (code: string) => Effect.runPromise(finished(CodeMode.execute({ code, tools: {} })))
    expect(await run("return [typeof $Call, typeof $Throw, typeof fillCollection]")).toMatchObject({
      value: ["undefined", "undefined", "undefined"],
    })
    expect(await run("const x = 1\nreturn Object.groupBy(null, (v) => v)")).toMatchObject({
      ok: false,
      error: { location: { line: 2, column: 8 } },
    })
  })
})

describe("lost values", () => {
  const encodeEnv = (lost: Array<string>) => ({
    nameOf: () => undefined,
    unchanged: () => false,
    anchorOf: () => undefined,
    nodeId: () => undefined,
    astArray: () => undefined,
    lost,
    strict: false,
  })
  const decodeEnv = {
    named: () => undefined,
    anchor: () => undefined,
    node: () => undefined,
    astArray: () => undefined,
    interruption: () => {
      throw new Error("no interruption is saved")
    },
  }

  test("a host function, a host object, and an unknown host error decode to what using a lost value throws", () => {
    class Handle {}
    class SocketError extends Error {}
    const lost: Array<string> = []
    const saved = encode(
      [{ data: [1, "two", { three: 3 }], fn: () => 1, host: new Handle(), error: new SocketError("boom") }],
      encodeEnv(lost),
    )
    expect(lost).toEqual(["a host function", "a host Handle", "a host SocketError"])
    const [root] = decode(JSON.parse(JSON.stringify(saved)), decodeEnv) as [Record<string, unknown>]
    expect(root.data).toEqual([1, "two", { three: 3 }])
    expect(root.fn).toBeInstanceOf(Lost)
    expect((root.fn as Lost).description).toBe("a host function")
    expect(root.host).toBeInstanceOf(Lost)
    expect((root.host as Lost).description).toBe("a host Handle")
    expect(root.error).toBeInstanceOf(PendingThrow)
    expect(normalizeError(root.error)).toEqual({
      kind: "ExecutionFailure",
      message:
        "TypeError: An error of class SocketError came from the host and was lost when the run was suspended; get it again after resuming.",
    })
    // A restored placeholder saves and restores again the same way.
    const again = decode(JSON.parse(JSON.stringify(encode([root], encodeEnv([])))), decodeEnv) as [
      Record<string, unknown>,
    ]
    expect((again[0].fn as Lost).description).toBe("a host function")
  })
})
