import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Extension, Tool } from "../src/index.js"

class Bag {
  static made = 0
  static of(...items: Array<string>) {
    return new this(items)
  }
  constructor(readonly items: Array<string> = []) {
    Bag.made++
  }
  get size() {
    return this.items.length
  }
  set size(length: number) {
    this.items.length = length
  }
  add(item: string) {
    this.items.push(item)
    return this
  }
  toArray() {
    return [...this.items]
  }
  pair() {
    return { self: this, list: [this, new Bag()] }
  }
  async later<T>(value: T) {
    return value
  }
  async reject(reason: unknown) {
    throw reason
  }
  fail() {
    throw new RangeError("boom")
  }
  get lazy() {
    return Promise.resolve(1)
  }
  detached() {
    return new Other()
  }
}
class Other {}
class Big extends Bag {
  double() {
    return this.items.length * 2
  }
}
class Vault {
  secrets = new Map<string, string>()
  set(key: string, value: string) {
    this.secrets.set(key, value)
  }
}

const held: Array<unknown> = []
const config = { retries: 3, nested: { deep: true } }
const extension = Extension.make({
  name: "bag",
  globals: {
    Bag,
    Big,
    Vault,
    keep: (value: unknown) => {
      held.push(value)
      return value
    },
    settings: () => config,
    later: async (value: number) => value + 1,
    first: (map: Map<unknown, unknown>) => map.get("k"),
  },
})

const runtime = CodeMode.make({ tools: {}, extensions: [extension] })

const value = async (code: string, target = runtime) => {
  const result = await Effect.runPromise(target.execute(code))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const failure = async (code: string, target = runtime) => {
  const result = await Effect.runPromise(target.execute(code))
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("extension classes behave like JS", () => {
  test("construct, call methods, read and write accessors", async () => {
    expect(await value(`const b = new Bag(["a"]); b.add("b"); return [b.size, b.toArray()]`)).toEqual([2, ["a", "b"]])
    expect(await value(`const b = new Bag(["a", "b"]); b.size = 1; return b.toArray()`)).toEqual(["a"])
  })

  test("instanceof, constructor, typeof, and prototype identity", async () => {
    expect(
      await value(
        `const b = new Bag(); return [b instanceof Bag, b.constructor === Bag, typeof Bag, Bag.prototype.constructor === Bag]`,
      ),
    ).toEqual([true, true, "function", true])
  })

  test("statics, including `new this()` through an exposed subclass", async () => {
    expect(await value(`return [Bag.of("x", "y").toArray(), Big.of("q") instanceof Big, Big.of === Bag.of]`)).toEqual([
      ["x", "y"],
      true,
      true,
    ])
  })

  test("data properties are invisible, so a program write never reaches the host class", async () => {
    Bag.made = 0
    expect(await value(`Bag.made = 999; return Bag.made`)).toBe(999)
    expect(Bag.made).toBe(0)
    expect(await value(`return [Bag.made, new Bag(["a"]).items]`)).toEqual([null, null])
  })

  test("inheritance chains to the exposed ancestor", async () => {
    expect(
      await value(`const b = new Big(["a"]); return [b.double(), b.add("b").size, b instanceof Bag, b instanceof Big]`),
    ).toEqual([2, 2, true, true])
  })

  test("calling a class without new throws the host TypeError", async () => {
    const error = await failure(`Bag()`)
    expect(error.message).toStartWith("TypeError: ")
    expect(error.message).toContain("new")
  })

  test("a function global is callable, awaitable, and not constructible", async () => {
    expect(await value(`return await later(1)`)).toBe(2)
    expect((await failure(`new later()`)).message).toContain("new later(...) is not supported")
  })

  test("a program can patch a prototype for its own run only", async () => {
    expect(await value(`Bag.prototype.add = () => "patched"; return new Bag().add("x")`)).toBe("patched")
    expect(await value(`return new Bag().add("x").toArray()`)).toEqual(["x"])
  })
})

describe("values are converted at the boundary, never shared", () => {
  test("the same host instance is the same handle", async () => {
    expect(
      await value(`const b = new Bag(); const p = b.pair(); return [p.self === b, p.list[0] === b, keep(b) === b]`),
    ).toEqual([true, true, true])
    expect(await value(`const p = new Bag().pair(); return p.list[1] instanceof Bag`)).toBe(true)
  })

  test("plain data passed in is a copy the program cannot change afterwards", async () => {
    held.length = 0
    await value(
      `const o = { n: 1, list: [1], d: new Date(0), u: new URL("https://a.test/") }; keep(o); o.n = 2; o.list.push(2)`,
    )
    expect(held[0]).toEqual({ n: 1, list: [1], d: new Date(0), u: new URL("https://a.test/") })
  })

  test("plain data returned is a copy; program writes never reach the host", async () => {
    expect(await value(`const s = settings(); s.retries = 0; s.nested.deep = false; return s`)).toEqual({
      retries: 0,
      nested: { deep: false },
    })
    expect(config).toEqual({ retries: 3, nested: { deep: true } })
  })

  test("Map and Set contents are converted element-wise, so handles unwrap inside them", async () => {
    expect(await value(`const b = new Bag(); return first(new Map([["k", b]])) === b`)).toBe(true)
    expect(await value(`return first(new Map([["k", { z: 1 }]]))`)).toEqual({ z: 1 })
    held.length = 0
    await value(`const inner = { z: 1 }; keep(new Set([inner])); inner.z = 2`)
    expect([...(held[0] as Set<{ z: number }>)][0]).toEqual({ z: 1 })
  })

  test("bytes cross as copies in both directions; ArrayBuffer comes in as Uint8Array", async () => {
    const stored = new Uint8Array([1, 2, 3])
    const target = CodeMode.make({
      extensions: [
        Extension.make({
          name: "bin",
          globals: {
            stored: () => stored,
            buffer: () => stored.buffer,
            wide: () => new Uint16Array(1),
            first: (bytes: Uint8Array) => {
              bytes[0] = 99
              return bytes.constructor.name
            },
          },
        }),
      ],
    })
    expect(
      await value(
        `const b = stored(); b[0] = 42; const mine = new Uint8Array([5]); const name = first(mine); return [[...b], [...stored()], [...buffer()], b instanceof Uint8Array, name, mine[0]]`,
        target,
      ),
    ).toEqual([[42, 2, 3], [1, 2, 3], [1, 2, 3], true, "Uint8Array", 5])
    expect([...stored]).toEqual([1, 2, 3])
    expect((await failure(`wide()`, target)).message).toContain("produced a Uint16Array, which the program cannot hold")
  })

  test("a __proto__ key never reaches the host object", async () => {
    held.length = 0
    await value(`keep({ __proto__: { polluted: true }, a: 1 })`)
    expect(Object.assign({}, held[0] as object)).not.toHaveProperty("polluted")
    expect(held[0]).toEqual({ a: 1 })
  })

  test("a program Error crosses as a host Error with its name and message", async () => {
    held.length = 0
    await value(`keep(new TypeError("bad"))`)
    expect(held[0]).toBeInstanceOf(TypeError)
    expect((held[0] as Error).message).toBe("bad")
    expect(Object.keys(held[0] as object)).toEqual([])
  })

  test("functions, promises, and symbols cannot be passed in", async () => {
    expect((await failure(`keep(() => 1)`)).message).toContain("Argument 1 to keep contains a function")
    expect((await failure(`keep(later(1))`)).message).toContain("un-awaited Promise")
    expect((await failure(`keep(Symbol.iterator)`)).message).toContain("Argument 1 to keep contains a symbol")
  })

  test("only interpreter primitives come out", async () => {
    const target = CodeMode.make({
      extensions: [Extension.make({ name: "odd", globals: { sym: () => Symbol("s"), big: () => 10n } })],
    })
    expect((await failure(`sym()`, target)).message).toContain("sym produced a symbol")
    expect((await failure(`big()`, target)).message).toContain("big produced a bigint")
  })

  test("an instance of an unexposed class cannot come out", async () => {
    expect((await failure(`new Bag().detached()`)).message).toContain("produced a Other, which the program cannot hold")
  })

  test("a getter must be synchronous", async () => {
    expect((await failure(`new Bag().lazy`)).message).toContain("Bag.prototype.lazy returned a Promise")
  })
})

describe("the host object behind a handle is unreachable", () => {
  test("enumeration, spread, and JSON see no own properties", async () => {
    expect(
      await value(`const b = new Bag(["a"]); return [Object.keys(b), Object.entries({ ...b }), String(b)]`),
    ).toEqual([[], [], "[object Object]"])
  })

  test("a handle serializes as {} when returned, stringified, or handed to a tool", async () => {
    expect(await value(`return new Bag()`)).toEqual({})
    expect(await value(`return JSON.stringify(new Bag())`)).toBe("{}")
    const tools = CodeMode.make({
      extensions: [extension],
      tools: {
        echo: Tool.make({
          description: "Echo",
          input: Schema.Struct({ v: Schema.Unknown }),
          output: Schema.Unknown,
          execute: (input) => Effect.succeed(input.v),
        }),
      },
    })
    expect(await value(`return await tools.echo({ v: new Bag() })`, tools)).toEqual({})
  })

  test("a method only runs on a handle of its own class", async () => {
    expect((await failure(`const add = new Bag().add; add("x")`)).message).toContain(
      "Illegal invocation: Bag.prototype.add called on undefined",
    )
    expect((await failure(`const o = { add: Bag.prototype.add }; o.add("x")`)).message).toContain(
      "called on a data object",
    )
    const vault = new Vault()
    const target = CodeMode.make({
      extensions: [Extension.make({ name: "vault", globals: { Bag, Vault, vault: () => vault } })],
    })
    expect((await failure(`const v = vault(); v.add = Bag.prototype.add; v.add("x")`, target)).message).toContain(
      "Illegal invocation: Bag.prototype.add called on a Vault",
    )
    expect(vault.secrets.size).toBe(0)
  })

  test("reading an accessor off the prototype itself is an illegal invocation", async () => {
    expect((await failure(`Bag.prototype.size`)).message).toContain("Illegal invocation")
  })
})

describe("host errors", () => {
  test("a synchronous throw becomes the matching program error", async () => {
    expect(await value(`try { new Bag().fail() } catch (e) { return [e instanceof RangeError, e.message] }`)).toEqual([
      true,
      "boom",
    ])
  })

  test("a thrown or rejected value crosses like a return, so the program catches what was thrown", async () => {
    expect(
      await value(
        `try { await new Bag().reject(new TypeError("bad")) } catch (e) { return [e instanceof TypeError, e.message] }`,
      ),
    ).toEqual([true, "bad"])
    expect(await value(`try { await new Bag().reject("plain") } catch (e) { return e }`)).toBe("plain")
    const reason = { status: 404, nested: { a: 1 } }
    const target = CodeMode.make({
      extensions: [
        Extension.make({
          name: "api",
          globals: {
            get: async () => Promise.reject(reason),
            boom: () => {
              throw reason
            },
          },
        }),
      ],
    })
    expect(await value(`try { await get() } catch (e) { e.status = 0; return e }`, target)).toEqual({
      status: 0,
      nested: { a: 1 },
    })
    expect(await value(`try { boom() } catch (e) { return e.status }`, target)).toBe(404)
    expect(reason.status).toBe(404)
    expect((await failure(`await get()`, target)).message).toBe('Uncaught: {"status":404,"nested":{"a":1}}')
  })
})

describe("configuration", () => {
  test("extension calls are not tool calls", async () => {
    const limited = CodeMode.make({ extensions: [extension], limits: { maxToolCalls: 0 } })
    const result = await Effect.runPromise(limited.execute(`new Bag().add("x"); return await later(1)`))
    expect(result.ok).toBe(true)
    expect(result.toolCalls).toEqual([])
  })

  test("a global must be a class or a function", () => {
    expect(() => Extension.make({ name: "bad", globals: { n: 1 as never } })).toThrow(
      'Extension "bad" global "n" must be a class or a function.',
    )
  })

  test("a global may not shadow a built-in or another extension", () => {
    expect(() => CodeMode.make({ extensions: [Extension.make({ name: "web", globals: { URL: class {} } })] })).toThrow(
      'Extension "web" global "URL" is already defined.',
    )
    expect(() =>
      CodeMode.make({ extensions: [extension, Extension.make({ name: "again", globals: { Bag: class {} } })] }),
    ).toThrow('Extension "again" global "Bag" is already defined.')
  })
})
