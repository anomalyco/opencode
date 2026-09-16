import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Extension, Tool } from "../src/index.js"

const held: Array<unknown> = []
const config = { retries: 3, nested: { deep: true } }
const requests: Array<unknown> = []
const extension = Extension.make({
  name: "web",
  globals: {
    keep: (value: unknown) => {
      held.push(value)
      return value
    },
    settings: () => config,
    later: async (value: number) => value + 1,
    first: (map: Map<unknown, unknown>) => map.get("k"),
    fetch: async (url: string, init?: { method?: string }) => {
      requests.push([url, init])
      const bytes = new TextEncoder().encode(`{"url":"${url}"}`)
      return {
        status: 200,
        ok: true,
        headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) },
        text: () => new TextDecoder().decode(bytes),
        json: () => JSON.parse(new TextDecoder().decode(bytes)),
        bytes: () => bytes,
        handlers: [(step: number) => step + 1],
      }
    },
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

describe("extension functions", () => {
  test("a global is callable, awaitable, and not constructible", async () => {
    expect(await value(`return await later(1)`)).toBe(2)
    expect(await value(`return [typeof later, later.name, later.length]`)).toEqual(["function", "later", 1])
    expect((await failure(`new later()`)).message).toContain("new later(...) is not supported")
  })

  test("a function inside a result is callable and crosses the same way", async () => {
    requests.length = 0
    expect(
      await value(
        `const res = await fetch("https://a.test/", { method: "GET" }); return [res.status, res.ok, res.headers.get("content-type"), res.text(), res.json(), [...res.bytes()].length, typeof res.json, res.json.name, res.handlers[0](1)]`,
      ),
    ).toEqual([
      200,
      true,
      "application/json",
      '{"url":"https://a.test/"}',
      { url: "https://a.test/" },
      25,
      "function",
      "json",
      2,
    ])
    expect(requests).toEqual([["https://a.test/", { method: "GET" }]])
  })

  test("a function inside a result is named by its path in diagnostics", async () => {
    expect((await failure(`const res = await fetch("https://a.test/"); res.handlers[0](() => 1)`)).message).toContain(
      "Argument 1 to fetch.handlers[0] contains a function",
    )
    const target = CodeMode.make({
      extensions: [Extension.make({ name: "odd", globals: { make: () => ({ sym: () => Symbol("s") }) } })],
    })
    expect((await failure(`make().sym()`, target)).message).toContain("make.sym produced a symbol")
  })

  test("a function is invisible to the data boundary like any program function", async () => {
    expect(await value(`return await fetch("https://a.test/")`)).toEqual({
      status: 200,
      ok: true,
      headers: {},
      handlers: [null],
    })
    expect(await value(`return JSON.stringify((await fetch("https://a.test/")).headers)`)).toBe("{}")
  })

  test("a class global is only a function; calling it throws the host TypeError", async () => {
    const target = CodeMode.make({ extensions: [Extension.make({ name: "cls", globals: { Bag: class Bag {} } })] })
    expect((await failure(`Bag()`, target)).message).toContain("without")
    expect((await failure(`new Bag()`, target)).message).toContain("new Bag(...) is not supported")
  })
})

describe("values are converted at the boundary, never shared", () => {
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

  test("the same host value returned twice is two program values", async () => {
    expect(await value(`return settings() === settings()`)).toBe(false)
    expect(await value(`return keep(settings()) === settings()`)).toBe(false)
  })

  test("Map and Set contents are converted element-wise", async () => {
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

  test("a program Error crosses as a host Error with its name, message, cause, and own data", async () => {
    held.length = 0
    await value(`keep(new TypeError("bad"))`)
    expect(held[0]).toBeInstanceOf(TypeError)
    expect((held[0] as Error).message).toBe("bad")
    expect(Object.keys(held[0] as object)).toEqual([])
    held.length = 0
    await value(`
      const e = new Error("m", { cause: new RangeError("root") })
      e.code = "ENOENT"; e.detail = { path: "x" }
      e.stack = "chosen"; e.toString = 1; e.constructor = 2; e.fn = () => 1
      keep(e)`)
    const crossed = held[0] as Error & Record<string, unknown>
    expect(crossed.cause).toBeInstanceOf(RangeError)
    expect((crossed.cause as Error).message).toBe("root")
    expect(Object.keys(crossed)).toEqual(["code", "detail"])
    expect(crossed.detail).toEqual({ path: "x" })
    expect(crossed.stack).not.toBe("chosen")
    expect(String(crossed)).toBe("Error: m")
    expect(crossed.constructor).toBe(Error)
  })

  test("an Error with an unknown name crosses as a plain Error", async () => {
    held.length = 0
    await value(`const e = new Error("x"); e.name = "constructor"; keep(e); e.name = "__proto__"; keep(e)`)
    expect(held[0]).toBeInstanceOf(Error)
    expect(held[1]).toBeInstanceOf(Error)
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

  test("a value that cannot come out carries a location like any built-in error, sync or async", async () => {
    const target = CodeMode.make({
      extensions: [
        Extension.make({ name: "odd", globals: { sym: () => Symbol("s"), later: async () => Symbol("s") } }),
      ],
    })
    expect((await failure(`sym()`, target)).location).toEqual((await failure(`JSON.parse("{")`, target)).location)
    expect((await failure(`await later()`, target)).location).toBeDefined()
  })

  test("a class instance cannot come out", async () => {
    class Other {}
    const target = CodeMode.make({
      extensions: [Extension.make({ name: "odd", globals: { detached: () => new Other() } })],
    })
    expect((await failure(`detached()`, target)).message).toContain("produced a Other, which the program cannot hold")
  })
})

describe("host errors", () => {
  test("a synchronous throw becomes the matching program error", async () => {
    const target = CodeMode.make({
      extensions: [
        Extension.make({
          name: "odd",
          globals: {
            fail: () => {
              throw new RangeError("boom")
            },
          },
        }),
      ],
    })
    expect(await value(`try { fail() } catch (e) { return [e instanceof RangeError, e.message] }`, target)).toEqual([
      true,
      "boom",
    ])
  })

  test("a host Error arrives with its cause and own data; what cannot cross is left behind", async () => {
    class Handle {}
    const target = CodeMode.make({
      extensions: [
        Extension.make({
          name: "fs",
          globals: {
            open: () => {
              const error = Object.assign(new Error("ENOENT: no such file or directory, open 'x'"), {
                code: "ENOENT",
                errno: -2,
                path: "x",
                detail: { retried: true },
                handle: new Handle(),
                retry: () => 1,
              })
              throw new Error("open failed", { cause: error })
            },
          },
        }),
      ],
    })
    expect(
      await value(
        `try { open() } catch (e) {
          const c = e.cause
          return [e.message, Object.keys(e), c instanceof Error, c.code, c.errno, c.path, c.detail, Object.keys(c), "stack" in c]
        }`,
        target,
      ),
    ).toEqual([
      "open failed",
      [],
      true,
      "ENOENT",
      -2,
      "x",
      { retried: true },
      ["code", "errno", "path", "detail"],
      false,
    ])
  })

  test("a thrown or rejected value crosses like a return, so the program catches what was thrown", async () => {
    const reason = { status: 404, nested: { a: 1 } }
    const target = CodeMode.make({
      extensions: [
        Extension.make({
          name: "api",
          globals: {
            reject: async (reason: unknown) => {
              throw reason
            },
            get: async () => Promise.reject(reason),
            boom: () => {
              throw reason
            },
          },
        }),
      ],
    })
    expect(
      await value(
        `try { await reject(new TypeError("bad")) } catch (e) { return [e instanceof TypeError, e.message] }`,
        target,
      ),
    ).toEqual([true, "bad"])
    expect(await value(`try { await reject("plain") } catch (e) { return e }`, target)).toBe("plain")
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
    const result = await Effect.runPromise(
      limited.execute(`(await fetch("https://a.test/")).json(); return await later(1)`),
    )
    expect(result.ok).toBe(true)
    expect(result.toolCalls).toEqual([])
  })

  test("a result handed to a tool is plain data", async () => {
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
    expect(await value(`return await tools.echo({ v: await fetch("https://a.test/") })`, tools)).toEqual({
      status: 200,
      ok: true,
      headers: {},
      handlers: [null],
    })
  })

  test("a global must be a function", () => {
    expect(() => Extension.make({ name: "bad", globals: { n: 1 as never } })).toThrow(
      'Extension "bad" global "n" must be a function.',
    )
  })

  test("a global may not shadow a built-in or another extension", () => {
    expect(() => CodeMode.make({ extensions: [Extension.make({ name: "web", globals: { URL: () => 1 } })] })).toThrow(
      'Extension "web" global "URL" is already defined.',
    )
    expect(() =>
      CodeMode.make({ extensions: [extension, Extension.make({ name: "again", globals: { fetch: () => 1 } })] }),
    ).toThrow('Extension "again" global "fetch" is already defined.')
  })
})
