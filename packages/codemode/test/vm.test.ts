import { describe, expect, test } from "bun:test"
import { disassembleSource } from "../script/disasm.js"
import { hashOf } from "../src/code.js"
import { compileSource } from "../src/compiler/compile.js"
import { verifyAll } from "./verify-bytecode.js"
import { parseVmSource, runProgram } from "./run-program.js"

const val = (code: string) => {
  const parsed = parseVmSource(code)
  if (parsed.ok) {
    const errors = verifyAll(compileSource(parsed.source))
    expect(errors).toEqual([])
  }
  const res = runProgram(code)
  if (!res.ok) throw new Error(`${res.error.kind}: ${res.error.message}`)
  return res.value
}

const err = (code: string) => {
  const res = runProgram(code)
  if (res.ok) throw new Error(`Expected failure, got ${JSON.stringify(res.value)}`)
  return res.error
}

describe("VM compiler, verifier, and determinism", () => {
  test("compiles deterministically and passes the stack-depth verifier", () => {
    const src = `
      function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2) }
      const fns = []
      for (let i = 0; i < 3; i++) fns.push(() => i)
      try {
        return [fib(6), fns.map((f) => f())]
      } catch (e) {
        return null
      } finally {
        fns.length = 0
      }
    `
    const p1 = parseVmSource(src)
    const p2 = parseVmSource(src)
    expect(p1.ok && p2.ok).toBe(true)
    if (!p1.ok || !p2.ok) return
    const c1 = compileSource(p1.source, { noCache: true })
    const c2 = compileSource(p2.source, { noCache: true })
    expect(hashOf(c1)).toBe(hashOf(c2))
    expect(verifyAll(c1)).toEqual([])
  })

  test("disassembler formats bytecode, locals, upvalues, handlers, and finallies", () => {
    const out = disassembleSource(`
      const fns = []
      for (let i = 0; i < 3; i++) fns.push(() => i)
      try { return fns[1]() } catch (e) { return -1 } finally { fns.pop() }
    `)
    expect(out).toContain("fn#0 <program>")
    expect(out).toContain("COPY_CELL")
    expect(out).toContain("CLOSURE")
    expect(out).toContain("END_FINALLY")
    expect(out).toContain("GET_UPVAL")
  })

  test("forceExtra mode exercises EXTRA-prefixed 32-bit operands", () => {
    const src = `
      let total = 0
      const add = (a, b = 10) => a + b
      for (let i = 0; i < 10; i++) total += add(i)
      return total
    `
    const parsed = parseVmSource(src)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const codes = compileSource(parsed.source, { forceExtra: true })
    expect(verifyAll(codes)).toEqual([])
    expect(val(src)).toBe(145)
  })
})

describe("scopes, TDZ, hoisting, and closures", () => {
  test("var hoisting, function hoisting, and block-scoped function declarations", () => {
    expect(
      val(`
        const before = [typeof hoistedFn, hoistedVar]
        var hoistedVar = 42
        function hoistedFn() { return "top" }
        function hoistedFn() { return "second" }
        let blockVal
        {
          blockVal = inner()
          function inner() { return "inner" }
        }
        return [before, hoistedVar, hoistedFn(), blockVal]
      `),
    ).toEqual([["function", null], 42, "second", "inner"])
  })

  test("always-checked TDZ for let and const, including hoisted functions and loop blocks", () => {
    expect(err(`const x = x + 1`).message).toContain("Cannot access 'x' before initialization")
    expect(err(`{ f(); let x = 1; function f() { return x } }`).message).toContain(
      "Cannot access 'x' before initialization",
    )
    expect(err(`{ x = 1; const x = 2 }`).message).toContain("Cannot access 'x' before initialization")
    expect(err(`const x = 1; x = 2`).message).toContain("Cannot assign to constant 'x'")
  })

  test("per-iteration let bindings in for, for-in, and for-of loops", () => {
    expect(
      val(`
        const a = []
        for (let i = 0; i < 4; i++) a.push(() => i)
        const b = []
        for (const k in { x: 1, y: 2 }) b.push(() => k)
        const c = []
        for (let v of [10, 20, 30]) {
          c.push(() => v)
          v += 1
        }
        return [a.map((f) => f()), b.map((f) => f()), c.map((f) => f())]
      `),
    ).toEqual([
      [0, 1, 2, 3],
      ["x", "y"],
      [11, 21, 31],
    ])
  })

  test("parameter scopes, TDZ between defaults, and parameter -> body var copy", () => {
    expect(
      val(`
        const outer = "outer"
        function f(a = () => outer, x = 1, b = () => x) {
          var outer = "inner"
          var x = 2
          return [a(), x, b()]
        }
        return f()
      `),
    ).toEqual(["outer", 2, 1])

    expect(err(`function f(a = b, b = 1) { return a }; return f()`).message).toContain(
      "Cannot access 'b' before initialization",
    )
  })

  test("arguments, rest parameters, duplicate non-strict params, and named function expressions", () => {
    expect(
      val(`
        function dup(a, a) { return a }
        function withArgs(a, b = 1) {
          var arguments
          const arrow = () => [...arguments]
          return [arguments.length, arrow()]
        }
        const named = function self(n) {
          return n <= 0 ? "done" : self(n - 1)
        }
        return [dup(1, 2), withArgs(10, 20, 30), named(2)]
      `),
    ).toEqual([2, [3, [10, 20, 30]], "done"])

    expect(err(`const f = function me() { me = 1 }; f()`).message).toContain("Cannot assign to constant 'me'")
  })
})

describe("expressions, evaluation order, and destructuring", () => {
  test("member evaluation order: nullish base before key conversion, base check before rhs", () => {
    expect(err(`const base = null; base[{ toString() { throw new RangeError("boom") } }]`).message).toContain(
      "Cannot read properties of null",
    )
    expect(err(`(1).x = (() => { throw new RangeError("rhs ran") })()`).message).toContain(
      "Cannot create property 'x' on number '1'",
    )
    expect(
      val(`
        const log = []
        const key = { toString() { log.push("key"); return "a" } }
        const o = { a: 10 }
        o[key] += (log.push("rhs"), 5)
        const post = o[key]++
        const pre = ++o[key]
        return [o.a, post, pre, log]
      `),
    ).toEqual([17, 15, 17, ["key", "rhs", "key", "key"]])
  })

  test("optional chaining and short-circuiting", () => {
    expect(
      val(`
        const o = { a: { b: (x) => ({ c: x * 2 }) } }
        const n = null
        return [
          o?.a.b(21).c,
          n?.a.b(1).c,
          o.a.missing?.(1),
          delete n?.a.b,
        ]
      `),
    ).toEqual([42, null, null, true])
  })

  test("object and array destructuring with defaults, rest, and custom iterator close", () => {
    expect(
      val(`
        const closed = []
        const iterable = {
          [Symbol.iterator]() {
            let i = 0
            return {
              next() { return { value: ++i, done: false } },
              return() { closed.push(i); return {} },
            }
          }
        }
        const [first, , third] = iterable
        const { a = 1, b: { c = 2 } = {}, ...rest } = { b: { c: 3 }, x: 4, y: 5 }
        return [first, third, closed, a, c, rest]
      `),
    ).toEqual([1, 3, [3], 1, 3, { x: 4, y: 5 }])
  })
})

describe("try/catch/finally static tag routing", () => {
  test("all synchronous spike finally cases pass and verify", () => {
    expect(
      val(`
        const out = []
        function f() { try { out.push("t"); return "r" } finally { out.push("f") } }
        out.push(f())
        return out.join(",")
      `),
    ).toBe("t,f,r")

    expect(
      val(`
        const out = []
        function f() { try { out.push("t"); throw "e" } finally { out.push("f") } }
        try { f() } catch (e) { out.push("c:" + e) }
        return out.join(",")
      `),
    ).toBe("t,f,c:e")

    expect(
      val(`
        const out = []
        outer: for (let i = 0; i < 4; i++) {
          try {
            for (let j = 0; j < 3; j++) {
              try {
                try {
                  if (j === 1) continue
                  if (i === 1 && j === 2) continue outer
                  if (i === 2 && j === 2) break outer
                  out.push(i + ":" + j)
                } finally { out.push("a" + j) }
              } finally { out.push("b" + j) }
            }
          } finally { out.push("c" + i) }
        }
        out.push("end")
        return out.join(",")
      `),
    ).toBe("0:0,a0,b0,a1,b1,0:2,a2,b2,c0,1:0,a0,b0,a1,b1,a2,b2,c1,2:0,a0,b0,a1,b1,a2,b2,c2,end")

    expect(
      val(`
        const out = []
        function f() { try { throw "e" } finally { return "fin" } }
        out.push(f())
        function g() { try { return "a" } finally { return "b" } }
        out.push(g())
        return out.join(",")
      `),
    ).toBe("fin,b")

    expect(
      val(`
        const out = []
        function f() {
          try { return "r" } finally {
            try { throw "x" } catch (e) { out.push("c" + e) }
            out.push("after")
          }
        }
        out.push(f())
        function g(n) {
          for (let i = 0; i < 3; i++) {
            try { if (i === n) return "ret" + i } finally {
              try { if (i === 1) throw "boom" } catch (e) { out.push("caught " + e) } finally { out.push("inner" + i) }
            }
          }
          return "none"
        }
        out.push(g(1))
        out.push(g(5))
        return out.join(",")
      `),
    ).toBe("cx,after,r,inner0,caught boom,inner1,ret1,inner0,caught boom,inner1,inner2,none")

    expect(
      val(`
        const out = []
        function f() {
          try { throw "outer" } finally {
            try { try { throw "inner" } finally { out.push("if") } } catch (e) { out.push("caught " + e) }
            out.push("of")
          }
        }
        try { f() } catch (e) { out.push("final " + e) }
        return out.join(",")
      `),
    ).toBe("if,caught inner,of,final outer")

    expect(
      val(`
        const out = []
        for (let i = 0; i < 3; i++) { try { throw "e" + i } finally { out.push("f" + i); break } }
        out.push("done")
        let k = 0
        while (k < 3) { k++; try { try { throw "x" } finally { out.push("in" + k); continue } } finally { out.push("out" + k) } }
        out.push("k" + k)
        return out.join(",")
      `),
    ).toBe("f0,done,in1,out1,in2,out2,in3,out3,k3")

    // Spike cases 8-12: generators + yield in try/finally + for-of
    expect(
      val(`
        const out = []
        function* g() { try { yield 1; yield 2 } finally { out.push("cleanup") } out.push("unreached") }
        const it = g()
        out.push(it.next().value)
        const r = it.return(9)
        out.push(r.value + "/" + r.done)
        out.push(String(it.next().done))
        const it2 = g()
        const r2 = it2.return(3)
        out.push(r2.value + "/" + r2.done)
        return out.join(",")
      `),
    ).toBe("1,cleanup,9/true,true,3/true")

    expect(
      val(`
        const out = []
        function* g() { try { yield 1 } finally { yield "f"; out.push("after-f") } }
        const it = g()
        it.next()
        let r = it.return(9)
        out.push(r.value + "/" + r.done)
        r = it.next()
        out.push(r.value + "/" + r.done)
        r = it.next()
        out.push(String(r.value) + "/" + r.done)
        const it2 = g()
        it2.next()
        it2.return(1)
        r = it2.return(2)
        out.push(r.value + "/" + r.done)
        return out.join(",")
      `),
    ).toBe("f/false,after-f,9/true,undefined/true,2/true")

    expect(
      val(`
        const out = []
        function* g() { try { yield 1 } finally { try { yield "f" } catch (e) { out.push("caught " + e) } out.push("end-f") } }
        const it = g()
        it.next()
        let r = it.return(5)
        out.push(r.value + "/" + r.done)
        r = it.throw("boom")
        out.push(r.value + "/" + r.done)
        function* g2() { try { yield 1 } finally { yield 2; out.push("g2-after") } }
        const it2 = g2()
        it2.next()
        r = it2.throw("x")
        out.push(r.value + "/" + r.done)
        try { it2.next() } catch (e) { out.push("rethrown " + e) }
        r = it2.next()
        out.push(String(r.value) + "/" + r.done)
        return out.join(",")
      `),
    ).toBe("f/false,caught boom,end-f,5/true,2/false,g2-after,rethrown x,undefined/true")

    expect(
      val(`
        const out = []
        function* g() { try { const v = 1 + (yield 2); out.push(v) } finally { out.push("f") } return "end" }
        const it = g()
        out.push(it.next().value)
        let r = it.return(7)
        out.push(r.value + "/" + r.done)
        const it2 = g()
        it2.next()
        r = it2.next(10)
        out.push(r.value + "/" + r.done)
        function* h() { const xs = [1, 2]; try { xs.push(3 + (yield xs.length) * (yield 5)) } finally { out.push("h" + xs.join("")) } }
        const it3 = h()
        it3.next()
        it3.next(4)
        r = it3.return(8)
        out.push(r.value + "/" + r.done)
        return out.join(",")
      `),
    ).toBe("2,f,7/true,11,f,end/true,h12,8/true")

    expect(
      val(`
        const out = []
        function* src() { try { yield 1; yield 2; yield 3 } finally { out.push("src-closed") } }
        function f() {
          for (const x of src()) {
            try { if (x === 2) return x * 10 } finally { out.push("f" + x) }
          }
          return "no"
        }
        out.push(f())
        function g() {
          for (const x of [1, 2, 3]) { try { if (x === 2) return "arr" + x } finally { out.push("af" + x) } }
        }
        out.push(g())
        function* outer() {
          try { for (const x of src()) { try { yield x } finally { out.push("of" + x) } } } finally { out.push("outer-f") }
        }
        const it = outer()
        it.next()
        it.next()
        const r = it.return(42)
        out.push(r.value + "/" + r.done)
        function h() {
          for (const x of src()) { for (const y of [7, 8]) { try { if (x === 1 && y === 8) break } finally { out.push("y" + y) } } if (x === 2) break }
          return "h"
        }
        out.push(h())
        function t() {
          try { for (const x of src()) { if (x === 2) throw "thrown" + x } } catch (e) { out.push("t:" + e) }
        }
        t()
        return out.join(",")
      `),
    ).toBe(
      "f1,f2,src-closed,20,af1,af2,arr2,of1,of2,src-closed,outer-f,42/true,y7,y8,y7,y8,src-closed,h,src-closed,t:thrown2",
    )
  })
})

describe("generators, async functions, async generators, yield*, and for-await", () => {
  test("verifies and executes sync/async generators, yield*, for-await, and Promise combinators (including forceExtra)", () => {
    const src = `
      function* innerSync() {
        const x = yield 10
        return x * 2
      }
      function* outerSync() {
        const r = yield* innerSync()
        yield r + 1
      }
      async function* innerAsync() {
        yield await Promise.resolve(1)
        return Promise.resolve(5)
      }
      async function* outerAsync() {
        const d = yield* innerAsync()
        yield d * 10
      }
      const syncOut = []
      const g = outerSync()
      syncOut.push(g.next().value)
      syncOut.push(g.next(3).value)
      const asyncOut = []
      for await (const item of outerAsync()) {
        asyncOut.push(item)
      }
      const all = await Promise.all([Promise.resolve("a"), "b", Promise.try(() => "c")])
      const iterHelper = [1, 2, 3, 4].values().map((x) => x * 10).filter((x) => x > 10).toArray()
      return [syncOut, asyncOut, all, iterHelper]
    `
    const parsed = parseVmSource(src)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(verifyAll(compileSource(parsed.source, { forceExtra: true }))).toEqual([])
    const dis = disassembleSource(src)
    expect(dis).toContain("GENERATOR_START")
    expect(dis).toContain("YIELD")
    expect(dis).toContain("RESUME")
    expect(dis).toContain("AWAIT")
    expect(dis).toContain("YSTAR")
    expect(dis).toContain("YSTAR_RESULT")
    expect(val(src)).toEqual([
      [10, 7],
      [1, 50],
      ["a", "b", "c"],
      [20, 30, 40],
    ])
  })
})

describe("built-ins, prelude, and coercion", () => {
  test("array callbacks, sort, Map/Set, Object.groupBy, JSON reviver/replacer, and ToPrimitive", () => {
    expect(
      val(`
        const arr = Array.from({ length: 6 }, (_, i) => i + 1)
        const mapped = arr.map((x) => x * 2).filter((x) => x > 4)
        const sum = mapped.reduce((a, b) => a + b, 0)
        const sorted = [3, 1, 4, 1, 5].sort((a, b) => a - b)
        const grouped = Object.groupBy(["a", "bb", "c", "dd"], (s) => s.length)
        const parsed = JSON.parse('{"a":1,"b":2}', (k, v) => (typeof v === "number" ? v * 10 : v))
        const str = JSON.stringify({ x: 1, y: { toJSON() { return 99 } } })
        const coerced = { valueOf() { return 7 } } * 6
        return [mapped, sum, sorted, grouped, parsed, str, coerced]
      `),
    ).toEqual([
      [6, 8, 10, 12],
      36,
      [1, 1, 3, 4, 5],
      { "1": ["a", "c"], "2": ["bb", "dd"] },
      { a: 10, b: 20 },
      '{"x":1,"y":99}',
      42,
    ])
  })

  test("Function.prototype.call, apply, bind, and built-in callbacks", () => {
    expect(
      val(`
        function greet(prefix, suffix) {
          return prefix + ":" + this.name + ":" + suffix
        }
        const bound = greet.bind({ name: "vm" }, "hi")
        return [
          greet.call({ name: "c" }, "a", "b"),
          greet.apply({ name: "ap" }, ["x", "y"]),
          bound("!"),
          bound.name,
          bound.length,
          [-1, 2, -3].map(Math.abs),
          ["1", "2"].map(Number.parseInt),
          ["a", "b"].map(Error).map((e) => e.message),
        ]
      `),
    ).toEqual(["a:c:b", "x:ap:y", "hi:vm:!", "bound greet", 1, [1, 2, 3], [1, null], ["a", "b"]])
  })

  test("new expressions, Set composition, Uint8Array, String callbacks, and imports", () => {
    expect(
      val(`
        import { URL as ImportedURL } from "node:url"
        const s1 = new Set([1, 2, 3])
        const s2 = new Set([2, 3, 4])
        const bytes = Uint8Array.from([1, 2, 3], (x) => x * 10)
        const replaced = "a1b22c".replace(/(\\d+)/g, (m) => "[" + m + "]")
        const u = new ImportedURL("https://example.com/p?q=1")
        const errWithCause = new TypeError("bad", { cause: "root" })
        return [
          [...s1.union(s2)],
          [...s1.intersection(s2)],
          [...s1.difference(s2)],
          [...bytes.map((b) => b + 1)],
          replaced,
          u.searchParams.get("q"),
          errWithCause.cause,
        ]
      `),
    ).toEqual([[1, 2, 3, 4], [2, 3], [1], [11, 21, 31], "a[1]b[22]c", "1", "root"])
  })

  test("error locations, rethrow preservation, and call stack depth limit", () => {
    const e1 = err(`const a = 1\nconst b = null\nreturn b.foo`)
    expect(e1.location).toEqual({ line: 3, column: 8 })

    const e2 = err(`const a = 1\ntry {\n  null.bar\n} catch (e) {\n  throw e\n}`)
    expect(e2.location).toEqual({ line: 3, column: 3 })

    expect(
      val(`
        function recurse(n) { return recurse(n + 1) }
        try {
          recurse(0)
        } catch (e) {
          return [e instanceof RangeError, e.message.includes("Maximum call stack size exceeded")]
        }
      `),
    ).toEqual([true, true])
  })
})
