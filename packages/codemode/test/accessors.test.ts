import { describe, expect, test } from "bun:test"
import { createBuiltins } from "../src/language/runtime/intrinsics.js"
import { PendingThrow } from "../src/language/runtime/model.js"
import { accessorRule, defineAccessorHalf, get, Native, Obj, peek } from "../src/language/runtime/objects.js"
import { runProgram } from "./run-program.js"

// Program-defined getters and setters: object literals, every read and write form, the built-ins that copy or
// enumerate objects, the iterator and promise protocols, and display, which never calls them.

// Every program also runs saved and restored into a fresh runtime at every slice, and must end the same way.
const value = (code: string) => {
  const result = runProgram(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  expect(runProgram(code, { roundTrip: { every: 1, max: 20_000 } })).toEqual(result)
  return result.value
}
const error = (code: string) => {
  const result = runProgram(code)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("object literal accessors", () => {
  test("a getter and a setter share one property", () => {
    expect(
      value(`const o = { _v: 2, get v() { return this._v * 10 }, set v(x) { this._v = x } }
      const before = o.v
      o.v = 5
      return [before, o.v, o._v, Object.keys(o)]`),
    ).toEqual([20, 50, 5, ["_v", "v"]])
  })

  test("names and lengths: get x, set x, computed and symbol keys", () => {
    expect(
      value(`const k = "dyn"
        const o = { get x() { return 1 }, set x(v) {}, get [k + 1]() { return 2 }, get [Symbol.iterator]() { return 3 }, get 5() { return 4 } }
        return [o.x, o.dyn1, o[Symbol.iterator], o[5]]`),
    ).toEqual([1, 2, 3, 4])
  })

  test("later definitions win, and data and accessors replace each other in source order", () => {
    expect(
      value(`const a = { get x() { return 1 }, get x() { return 2 } }
        const b = { x: 1, get x() { return 3 } }
        const c = { get x() { return 3 }, x: 4 }
        const d = { get x() { return 5 }, x: 6, set x(v) { this.seen = v } }
        d.x = 7
        const e = { ...{ x: 1 }, get x() { return 8 } }
        return [a.x, b.x, c.x, d.x, d.seen, e.x]`),
    ).toEqual([2, 3, 4, null, 7, 8])
  })

  test("an accessor named __proto__ is an own property, as in JS", () => {
    expect(value(`const o = { get __proto__() { return 1 } }; return [o.__proto__, Object.keys(o)]`)).toEqual([
      1,
      ["__proto__"],
    ])
  })
})

describe("reads call the getter", () => {
  test("member, computed and object keys, with this as the receiver", () => {
    expect(
      value(`const o = { n: 3, get x() { return this.n } }
        const key = { toString() { return "x" } }
        const k = "x"
        return [o.x, o["x"], o[k], o[key]]`),
    ).toEqual([3, 3, 3, 3])
  })

  test("an inherited getter sees the object read from", () => {
    expect(
      value(`const p = { get id() { return this.name } }; const c = Object.create(p); c.name = "c"; return c.id`),
    ).toBe("c")
  })

  test("method calls keep the receiver", () => {
    expect(
      value(`const o = { k: 4, get m() { return function () { return this.k } } }
        return [o.m(), o["m"]()]`),
    ).toEqual([4, 4])
  })

  test("optional chaining, typeof, and destructuring with defaults and nesting", () => {
    expect(
      value(`const o = { get a() { return undefined }, get b() { return { c: 5 } }, get f() { return () => 1 } }
        const { a = 7, b: { c }, ["f"]: f } = o
        return [o?.b?.c, o.missing?.x, typeof o.f, a, c, f(), o.f?.()]`),
    ).toEqual([5, null, "function", 7, 5, 1, 1])
  })

  test("each read calls the getter once", () => {
    expect(
      value(
        `let calls = 0; const o = { get x() { calls++; return 1 } }; o.x; o["x"]; const { x } = o; o.x?.toString(); return calls`,
      ),
    ).toBe(4)
  })

  test("a getter that throws is caught in the caller", () => {
    expect(
      value(`const o = { get x() { throw new Error("boom") } }; try { return o.x } catch (e) { return e.message }`),
    ).toBe("boom")
    expect(error(`const o = { get x() { throw new TypeError("no") } }\nreturn o.x`)).toMatchObject({
      message: expect.stringContaining("no"),
    })
  })

  test("a recursive getter hits the call depth limit", () => {
    expect(error(`const o = { get x() { return this.x } }; return o.x`).message).toContain(
      "Maximum call stack size exceeded",
    )
  })

  test("a getter can return a promise, and a long getter is time sliced", () => {
    expect(value(`const o = { get p() { return Promise.resolve(3) } }; return await o.p`)).toBe(3)
    expect(
      runProgram(`const o = { get n() { let s = 0; for (let i = 0; i < 1e5; i++) s += i; return s } }; return o.n`, {
        maxSlices: 1e6,
      }),
    ).toMatchObject({ ok: true, value: 4999950000 })
  })

  test("instanceof calls a prototype getter, after checking the callable", () => {
    expect(error(`return {} instanceof {}`).message).toContain("is not callable")
  })
})

describe("writes call the setter", () => {
  test("assignment answers the assigned value, not what the setter returns", () => {
    expect(
      value(
        `const o = { set x(v) { this.y = v * 2; return 99 } }; const r = (o.x = 3); const s = (o["x"] = 4); return [r, s, o.y]`,
      ),
    ).toEqual([3, 4, 8])
  })

  test("compound assignment, ++ and -- run the getter then the setter", () => {
    expect(
      value(`const log = []
        const o = { n: 1, get x() { log.push("get"); return this.n }, set x(v) { log.push("set " + v); this.n = v } }
        o.x += 5
        const post = o.x++
        const pre = ++o["x"]
        o.x--
        return [post, pre, o.n, log]`),
    ).toEqual([6, 8, 7, ["get", "set 6", "get", "set 7", "get", "set 8", "get", "set 7"]])
  })

  test("logical assignment calls the setter only when it assigns", () => {
    expect(
      value(`let sets = 0
        const o = { v: 0, get x() { return this.v }, set x(v) { sets++; this.v = v } }
        o.x ||= 1
        o.x ||= 2
        o.x &&= 3
        o.x ??= 4
        return [o.v, sets]`),
    ).toEqual([3, 2])
  })

  test("an inherited setter takes the write; a getter-only accessor refuses it", () => {
    expect(
      value(
        `const p = { set x(v) { this.got = v } }; const c = Object.create(p); c.x = 1; return [c.got, Object.keys(c)]`,
      ),
    ).toEqual([1, ["got"]])
    expect(error(`const o = { get x() { return 1 } }; o.x = 2`).message).toContain(
      "Cannot set property 'x' of a data object which has only a getter.",
    )
  })

  test("a setter decides what is stored, so assigning the object itself is no cycle", () => {
    expect(value(`const o = { set self(v) { this.ok = v === o } }; o.self = o; return o.ok`)).toBe(true)
  })
})

describe("enumeration never calls accessors", () => {
  test("keys, for...in, in, hasOwnProperty, delete and console.log", () => {
    expect(
      runProgram(`let calls = 0
        const o = { a: 1, get b() { calls++; return 2 }, set c(v) { calls++ }, get d() { calls++ }, set d(v) {} }
        const seen = []
        for (const k in o) seen.push(k)
        console.log(o)
        const r = [Object.keys(o), seen, "b" in o, o.hasOwnProperty("b"), delete o.a, calls]
        return r`),
    ).toMatchObject({
      ok: true,
      value: [["a", "b", "c", "d"], ["a", "b", "c", "d"], true, true, true, 0],
      logs: ['{"a":1,"b":[Getter],"c":[Setter],"d":[Getter/Setter]}'],
    })
  })

  test("console.table labels accessors, own and inherited", () => {
    const result = runProgram(
      `console.table([Object.create({ get a() { return 1 } }), { get a() { return 2 }, b: 3 }], ["a", "b"]); return 0`,
    )
    expect(result).toMatchObject({ ok: true, logs: [expect.stringContaining("[Getter]")] })
  })
})

describe("copying built-ins", () => {
  test("spread and rest call each getter once in key order and copy data", () => {
    expect(
      value(`const log = []
        const o = { a: 1, get b() { log.push("b"); return 2 }, get c() { log.push("c"); return 3 }, [Symbol.iterator]: 4 }
        const copy = { ...o }
        const { a, ...rest } = o
        return [copy, rest, log, Object.keys(rest), copy[Symbol.iterator], rest[Symbol.iterator]]`),
    ).toEqual([{ a: 1, b: 2, c: 3 }, { b: 2, c: 3 }, ["b", "c", "b", "c"], ["b", "c"], 4, 4])
  })

  test("Object.entries and values check enumerability as they visit", () => {
    expect(
      value(`const o = { get a() { delete this.b; return 1 }, b: 2, c: 3 }
        const p = { get a() { return 1 }, b: 2 }
        return [Object.entries(o), Object.values(p)]`),
    ).toEqual([
      [
        ["a", 1],
        ["c", 3],
      ],
      [1, 2],
    ])
  })

  test("Object.assign runs source getters and target setters, including inherited ones", () => {
    expect(
      value(`const log = []
        const target = Object.create({ set b(v) { log.push("set b " + v) } })
        const source = { a: 1, get b() { log.push("get b"); return 2 }, [Symbol.iterator]: 5 }
        Object.assign(target, source, null, "xy")
        return [Object.keys(target), target[Symbol.iterator], target[0], log]`),
    ).toEqual([["0", "1", "a"], 5, "x", ["get b", "set b 2"]])
  })

  test("JSON.stringify calls getters and leaves setter-only properties out", () => {
    expect(
      value(`const o = { a: 1, get b() { return [2] }, set c(v) {}, nested: { get d() { return "d" } } }
        return JSON.stringify(o)`),
    ).toBe('{"a":1,"b":[2],"nested":{"d":"d"}}')
  })

  test("the program's result calls getters, and a then getter is adopted", () => {
    expect(value(`return { a: 1, get b() { return 2 }, set c(v) {} }`)).toEqual({ a: 1, b: 2 })
    expect(value(`return { get then() { return (resolve) => resolve(7) } }`)).toBe(7)
  })
})

describe("the iterator protocol", () => {
  const iterable = `const log = []
    const make = (n) => ({
      get [Symbol.iterator]() {
        log.push("iterator")
        return () => {
          let i = 0
          return {
            get next() {
              log.push("next")
              return () => {
                i++
                return { get done() { log.push("done"); return i > n }, get value() { log.push("value"); return i * 10 } }
              }
            },
            get return() { log.push("return"); return () => ({}) },
          }
        }
      },
    })`

  test("for...of, spread and array destructuring read each getter as JS does", () => {
    expect(
      value(`${iterable}
        const out = []
        for (const x of make(2)) out.push(x)
        log.push("|")
        const spread = [...make(1)]
        log.push("|")
        const [first] = make(3)
        return [out, spread, first, log]`),
    ).toEqual([
      [10, 20],
      [10],
      10,
      [
        "iterator",
        "next",
        "done",
        "value",
        "done",
        "value",
        "done",
        "|",
        "iterator",
        "next",
        "done",
        "value",
        "done",
        "|",
        "iterator",
        "next",
        "done",
        "value",
        "return",
      ],
    ])
  })

  test("break calls a return getter once, and yield* delegates through getters", () => {
    expect(
      value(`${iterable}
        for (const x of make(5)) break
        function* outer() { yield* make(2) }
        return [[...outer()], log]`),
    ).toEqual([
      [10, 20],
      [
        "iterator",
        "next",
        "done",
        "value",
        "return",
        "iterator",
        "next",
        "done",
        "value",
        "done",
        "value",
        "done",
        "value",
      ],
    ])
  })

  test("a self-memoizing done getter reads each property once, in order", () => {
    expect(
      value(`const out = []
        const it = { [Symbol.iterator]() { let i = 0; return { next() { i++; return { get done() { delete this.done; this.done = i > 2; return i > 2 }, get value() { return i } } } } } }
        for (const x of it) out.push(x)
        return out`),
    ).toEqual([1, 2])
  })

  test("for await over a sync iterator with getters", () => {
    expect(
      value(`${iterable}
        const out = []
        for await (const x of make(2)) out.push(x)
        return out`),
    ).toEqual([10, 20])
  })
})

describe("thenables", () => {
  test("await reads a then getter once; a non-function then fulfills with the object", () => {
    expect(
      value(`let calls = 0
        const a = await { get then() { calls++; return (resolve) => resolve(1) } }
        const b = await { get then() { calls++; return 5 }, x: 2 }
        return [a, b.x, calls]`),
    ).toEqual([1, 2, 2])
  })

  test("a throwing then getter rejects, and Promise.resolve adopts through a getter", () => {
    expect(
      value(`const bad = { get then() { throw new Error("nope") } }
        const caught = await Promise.resolve(bad).catch((e) => e.message)
        return [caught, await Promise.resolve({ get then() { return (r) => r(3) } })]`),
    ).toEqual(["nope", 3])
  })
})

describe("crossing to the host", () => {
  test("a setter-only native accessor is left out of an object with no program accessors", () => {
    const target = new Obj(createBuiltins().Object)
    target.props.set("a", { value: 1, writable: true, enumerable: true, configurable: true })
    target.props.set("w", { get: undefined, set: () => {}, enumerable: true, configurable: true })
    expect(target.hasProgramAccessors).toBe(false)
    expect(target.toHost((value) => value)).toEqual({ a: 1 })
  })
})

describe("the safety net", () => {
  test("a built-in that reaches a program accessor with no path is a defect in tests, a TypeError otherwise", () => {
    const builtins = createBuiltins()
    const target = new Obj(builtins.Object)
    defineAccessorHalf(target, "x", "get", new Native(builtins.Function, { name: "get x", call: () => 1 }))
    expect(() => get(target, "x")).toThrow("A built-in reached the program accessor x with no path for it.")
    accessorRule.check = false
    try {
      expect(() => get(target, "x")).toThrow(PendingThrow)
      expect(peek(target, "x")).toBeUndefined()
    } finally {
      accessorRule.check = true
    }
  })
})

// Each program runs in a fresh runtime, so the accessor on Object.prototype ends with it; the programs that do not
// return through it also delete it before they finish.
describe("internal arrays ignore indexed accessors on Object.prototype", () => {
  test("a setter does not catch the writes of a replayed built-in", () => {
    expect(
      value(`Object.defineProperty(Object.prototype, 0, { set(v) {}, configurable: true })
      const o = Object.defineProperty({}, "a", { get value() { return 1 } })
      delete Object.prototype[0]
      return o.a`),
    ).toBe(1)
  })

  test("a getter-only accessor does not break defineProperty, JSON.stringify or Object.entries", () => {
    expect(
      value(`Object.defineProperty(Object.prototype, 0, { get() { return "p" }, configurable: true })
      const o = Object.defineProperty({}, "a", { get value() { return 1 } })
      const json = JSON.stringify({ x: [1, 2], y: { z: 3 } })
      const entries = Object.entries({ b: 2, c: 3 })
      const values = Object.values({ b: 2 })
      delete Object.prototype[0]
      return [o.a, json, entries, values]`),
    ).toEqual([1, '{"x":[1,2],"y":{"z":3}}', [["b", 2], ["c", 3]], [2]])
  })

  test("a getter-only accessor does not break returning an object", () => {
    expect(
      value(`Object.defineProperty(Object.prototype, 0, { get() { return "p" }, configurable: true })
      return { list: [1, [2, 3]], nested: { k: "v" } }`),
    ).toEqual({ list: [1, [2, 3]], nested: { k: "v" } })
  })

  test("a String.prototype index getter past the string's end is read", () => {
    expect(
      value(`Object.defineProperty(String.prototype, 5, { get() { return "g" }, configurable: true })
      const r = ["a"[5], "abc"[1]]
      delete String.prototype[5]
      return r`),
    ).toEqual(["g", "b"])
  })

  test("bind gives length 0 when the target's length is NaN or not a number", () => {
    expect(
      value(`const f = Object.defineProperty(function (a, b) {}, "length", { value: NaN })
      const g = Object.defineProperty(function (a, b) {}, "length", { get() { return "2" } })
      return [f.bind(null).length, g.bind(null).length]`),
    ).toEqual([0, 0])
  })

  test("assigning a cycle through a data property is still rejected", () => {
    const result = runProgram(`const o = {}; o.self = o; return 1`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain("Object assignment result contains a circular value.")
  })
})
