import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Extension, Tool } from "../src/index.js"

const run = (code: string, options: Parameters<typeof CodeMode.make>[0] = {}) =>
  Effect.runPromise(CodeMode.make(options).execute(code) as Effect.Effect<CodeMode.Result>)

const value = async (code: string, options?: Parameters<typeof CodeMode.make>[0]) => {
  const result = await run(code, options)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const failure = async (code: string, options?: Parameters<typeof CodeMode.make>[0]) => {
  const result = await run(code, options)
  if (result.ok) throw new Error(`expected failure, got ${JSON.stringify(result.value)}`)
  return result.error.message
}

// The program's own [name, message] for what `code` throws.
const thrown = async (code: string) =>
  (await value(`try { ${code}; return ["no error", ""] } catch (e) { return [e.name, e.message] }`)) as [string, string]

describe("ArrayBuffer and views", () => {
  test("a typed array's buffer holds its bytes", async () => {
    expect(await value(`const a = new Uint8Array([66]); return Array.from(new Uint8Array(a.buffer))`)).toEqual([66])
    expect(
      await value(`const a = new Uint8Array([1, 2, 3, 4]); return Array.from(new Uint8Array(a.buffer, 1, 2))`),
    ).toEqual([2, 3])
  })

  test("views over one buffer share memory both ways, with DataView and subarray", async () => {
    expect(
      await value(`const buffer = new ArrayBuffer(8)
        const bytes = new Uint8Array(buffer)
        const words = new Uint16Array(buffer, 2, 2)
        const view = new DataView(buffer, 4, 4)
        const tail = bytes.subarray(6)
        words[0] = 0x0102
        view.setUint16(0, 0x0304)
        tail[1] = 7
        bytes[2] = 0xff
        return [[...bytes], words[0], view.getUint8(3), [words.buffer === buffer, view.buffer === buffer,
          tail.buffer === bytes.buffer, bytes.buffer === bytes.buffer], [words.byteOffset, words.byteLength, tail.byteOffset]]`),
    ).toEqual([[0, 0, 0xff, 1, 3, 4, 0, 7], 0x01ff, 7, [true, true, true, true], [2, 4, 6]])
  })

  test("subarray shares memory and slice copies", async () => {
    expect(
      await value(`const a = new Int16Array([1, 2, 3, 4])
        const view = a.subarray(1, 3)
        const copy = a.slice(1, 3)
        view[0] = 20
        copy[1] = 30
        return [[...a], [...view], [...copy], view.buffer === a.buffer, copy.buffer === a.buffer, a.buffer.slice(2, 4).byteLength]`),
    ).toEqual([[1, 20, 3, 4], [20, 3], [2, 30], true, false, 2])
  })

  test("DataView reads and writes each type in either byte order", async () => {
    expect(
      await value(`const view = new DataView(new ArrayBuffer(8))
        view.setUint32(0, 0x01020304)
        const big = [view.getUint8(0), view.getUint16(0), view.getUint32(0, true)]
        view.setInt16(0, -2, true)
        view.setFloat32(4, 1.5)
        const rest = [view.getInt16(0, true), view.getUint16(0, true), view.getInt8(0), view.getFloat32(4)]
        view.setFloat64(0, Math.PI, true)
        return [big, rest, view.getFloat64(0, true), new Float64Array(view.buffer)[0], view.getInt32(0, false) === view.getInt32(0, true)]`),
    ).toEqual([[1, 0x0102, 0x04030201], [-2, 0xfffe, -2, 1.5], Math.PI, Math.PI, false])
  })

  test("ArrayBuffer has its byte length, slices, and tells views apart", async () => {
    expect(
      await value(`const buffer = new ArrayBuffer(4)
        new Uint8Array(buffer).set([1, 2, 3, 4])
        const part = buffer.slice(-2)
        new Uint8Array(part)[0] = 9
        return [buffer.byteLength, part.byteLength, [...new Uint8Array(part)], [...new Uint8Array(buffer)],
          ArrayBuffer.isView(new Int8Array(1)), ArrayBuffer.isView(new DataView(buffer)), ArrayBuffer.isView(buffer),
          buffer.resizable, Object.prototype.toString.call(buffer), Object.prototype.toString.call(new DataView(buffer))]`),
    ).toEqual([4, 2, [9, 4], [1, 2, 3, 4], true, true, false, false, "[object ArrayBuffer]", "[object DataView]"])
  })

  test("out-of-range offsets and lengths are RangeErrors, as in JS", async () => {
    expect(await thrown(`new Int32Array(new ArrayBuffer(6))`)).toEqual([
      "RangeError",
      "Byte length of Int32Array should be a multiple of 4.",
    ])
    expect(await thrown(`new Uint16Array(new ArrayBuffer(4), 1)`)).toEqual([
      "RangeError",
      "Start offset of Uint16Array should be a multiple of 2.",
    ])
    expect(await thrown(`new Uint8Array(new ArrayBuffer(4), 2, 3)`)).toEqual([
      "RangeError",
      "Invalid typed array length: 3",
    ])
    expect(await thrown(`new Uint8Array(new ArrayBuffer(4), 5)`)).toEqual([
      "RangeError",
      "Start offset 5 is outside the bounds of the buffer.",
    ])
    expect(await thrown(`new DataView(new ArrayBuffer(2)).getInt32(0)`)).toEqual([
      "RangeError",
      "Offset is outside the bounds of the DataView.",
    ])
    expect(await thrown(`new DataView(new ArrayBuffer(4)).setUint8(-1, 0)`)).toEqual([
      "RangeError",
      "Invalid DataView offset: -1",
    ])
    expect(await thrown(`new DataView(new ArrayBuffer(4), 2, 3)`)).toEqual(["RangeError", "Invalid DataView length 3"])
    expect(await thrown(`new Int8Array(2).with(2, 1)`)).toEqual(["RangeError", "Invalid typed array index: 2"])
    expect(await thrown(`new Int8Array(2).set([1, 2], 1)`)).toEqual([
      "RangeError",
      "Int8Array.set: the source does not fit at that offset.",
    ])
    expect((await thrown(`new DataView(new Uint8Array(4))`))[0]).toBe("TypeError")
    expect((await thrown(`new ArrayBuffer(4, { maxByteLength: 8 })`))[1]).toContain("Resizable ArrayBuffers")
  })
})

describe("the typed array family", () => {
  test("each kind converts its elements like JS", async () => {
    expect(
      await value(`return [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
        Float32Array, Float64Array].map((Kind) => [Kind.name, Kind.BYTES_PER_ELEMENT, [...Kind.of(300, -1.5, 2.5)],
          new Kind(2).byteLength, Object.prototype.toString.call(new Kind(0))])`),
    ).toEqual([
      ["Int8Array", 1, [44, -1, 2], 2, "[object Int8Array]"],
      ["Uint8Array", 1, [44, 255, 2], 2, "[object Uint8Array]"],
      ["Uint8ClampedArray", 1, [255, 0, 2], 2, "[object Uint8ClampedArray]"],
      ["Int16Array", 2, [300, -1, 2], 4, "[object Int16Array]"],
      ["Uint16Array", 2, [300, 65535, 2], 4, "[object Uint16Array]"],
      ["Int32Array", 4, [300, -1, 2], 8, "[object Int32Array]"],
      ["Uint32Array", 4, [300, 4294967295, 2], 8, "[object Uint32Array]"],
      ["Float32Array", 4, [300, -1.5, 2.5], 8, "[object Float32Array]"],
      ["Float64Array", 8, [300, -1.5, 2.5], 16, "[object Float64Array]"],
    ])
  })

  test("share %TypedArray% and its methods", async () => {
    expect(
      await value(`const TypedArray = Object.getPrototypeOf(Int16Array)
        const a = Int16Array.from([3, 1, 2], (x) => x * 10)
        return [TypedArray === Object.getPrototypeOf(Float64Array), Object.getPrototypeOf(Int16Array.prototype) === TypedArray.prototype,
          a.map((x) => x + 1) instanceof Int16Array, [...a.filter((x) => x > 10)], a.reduce((s, x) => s + x, 0), a.indexOf(10),
          a.includes("10"), [...a.toReversed()], [...a.with(0, 5)], [...new Int16Array([1, 2, 3, 4]).copyWithin(0, 2)],
          [...a.sort()], [...a.entries()].length, a.join("-"), String(new Float32Array([0.5])), a.at(-1), Array.isArray(a)]`),
    ).toEqual([
      true,
      true,
      true,
      [30, 20],
      60,
      1,
      false,
      [20, 10, 30],
      [5, 10, 20],
      [3, 4, 3, 4],
      [10, 20, 30],
      3,
      "10-20-30",
      "0.5",
      30,
      false,
    ])
  })

  test("set converts across kinds and handles overlapping views", async () => {
    expect(
      await value(`const bytes = new Uint8Array([1, 2, 3, 4, 5])
        bytes.set(bytes.subarray(0, 3), 2)
        const floats = new Float32Array(2)
        floats.set(new Int8Array([-1, 7]))
        return [[...bytes], [...floats], [...new Uint8Array(new Int16Array([256, -1]))]]`),
    ).toEqual([
      [1, 2, 1, 2, 3],
      [-1, 7],
      [0, 255],
    ])
  })

  test("NaN is found by includes only in float arrays", async () => {
    expect(
      await value(`const f = new Float64Array([NaN, 1])
        return [f.includes(NaN), f.indexOf(NaN), new Uint8Array([0]).includes(NaN), f.includes("x")]`),
    ).toEqual([true, -1, false, false])
  })

  test("BigInt arrays are not available", async () => {
    expect(await failure(`new BigInt64Array(1)`)).toContain("Unknown identifier 'BigInt64Array'")
  })

  test("a TypedArray cannot be constructed directly, and from needs a typed array constructor", async () => {
    expect(
      await value(`const TypedArray = Object.getPrototypeOf(Int8Array)
        const out = []
        try { new TypedArray(1) } catch (e) { out.push(e.name) }
        try { TypedArray.from.call(Array, [1]) } catch (e) { out.push(e.name) }
        return out`),
    ).toEqual(["TypeError", "TypeError"])
  })
})

describe("byte built-ins over buffers and views", () => {
  test("TextDecoder decodes a view's own bytes, an ArrayBuffer, and a DataView", async () => {
    expect(
      await value(`const bytes = new TextEncoder().encode("xhiy")
        const decoder = new TextDecoder()
        return [decoder.decode(bytes.subarray(1, 3)), decoder.decode(bytes.buffer),
          decoder.decode(new DataView(bytes.buffer, 1, 2)), decoder.decode(new Uint8Array(bytes.buffer, 2))]`),
    ).toEqual(["hi", "xhiy", "hi", "iy"])
  })

  test("Buffer.from(arrayBuffer, offset, length) shares the memory, as in Node", async () => {
    expect(
      await value(`const buffer = new ArrayBuffer(4)
        const shared = Buffer.from(buffer, 1, 2)
        shared[0] = 65
        const bytes = new Uint8Array(buffer)
        bytes[2] = 66
        return [shared.toString(), [...bytes], shared.buffer === buffer, shared.byteOffset, Buffer.byteLength(buffer),
          Buffer.from(new Uint16Array([0x4241])).toString("hex"), Buffer.from("hi").subarray(1).buffer.byteLength]`),
    ).toEqual(["AB", [0, 65, 66, 0], true, 1, 4, "41", 2])
    expect(await thrown(`Buffer.from(new ArrayBuffer(2), 3)`)).toEqual([
      "RangeError",
      '"offset" is outside of buffer bounds',
    ])
  })

  test("structuredClone copies the whole buffer and keeps views sharing it", async () => {
    expect(
      await value(`const bytes = new Uint8Array([1, 2, 3, 4])
        const clone = structuredClone({ bytes, tail: bytes.subarray(2), view: new DataView(bytes.buffer, 1) })
        clone.tail[0] = 9
        return [[...clone.bytes], clone.tail.byteOffset, clone.view.getUint8(1), clone.bytes.buffer === clone.tail.buffer,
          clone.view.buffer === clone.bytes.buffer, [...bytes]]`),
    ).toEqual([[1, 2, 9, 4], 2, 9, true, true, [1, 2, 3, 4]])
  })

  test("crypto.getRandomValues fills integer typed arrays only", async () => {
    expect(await value(`return crypto.getRandomValues(new Uint32Array(4)).length`)).toBe(4)
    expect((await thrown(`crypto.getRandomValues(new Float64Array(1))`))[0]).toBe("TypeError")
  })
})

describe("crossing the host boundary", () => {
  test("each binary kind crosses extensions as a copy of its own kind, in both directions", async () => {
    const seen: Array<unknown> = []
    const bin = Extension.make({
      name: "bin",
      globals: {
        give: () => ({
          words: new Int16Array([-1, 2]),
          buffer: new Uint8Array([7, 8]).buffer,
          view: new DataView(new ArrayBuffer(2)),
        }),
        take: (value: unknown) => void seen.push(value),
        bigints: () => new BigInt64Array(1),
      },
    })
    expect(
      await value(
        `const got = give()
        const buffer = new ArrayBuffer(4)
        const words = new Uint16Array(buffer, 2, 1)
        words[0] = 0x0102
        take([words, buffer, new DataView(buffer, 2)])
        words[0] = 0
        return [got.words instanceof Int16Array, [...got.words], got.buffer instanceof ArrayBuffer,
          [...new Uint8Array(got.buffer)], got.view.byteLength]`,
        { extensions: [bin] },
      ),
    ).toEqual([true, [-1, 2], true, [7, 8], 2])
    const [words, buffer, view] = seen[0] as [Uint16Array, ArrayBuffer, DataView]
    expect(words).toBeInstanceOf(Uint16Array)
    expect([...words, words.byteOffset, words.buffer === buffer]).toEqual([0x0102, 0, false])
    expect([...new Uint8Array(buffer)]).toEqual([0, 0, 2, 1])
    expect([view.byteLength, view.getUint16(0, true)]).toEqual([2, 0x0102])
    expect(await failure(`bigints()`, { extensions: [bin] })).toContain("which the program cannot hold")
  })

  test("binary data asks to be encoded as text at tools and in results", async () => {
    const echo = Tool.make({
      description: "Echo",
      input: Schema.Struct({ data: Schema.Unknown }),
      execute: () => Effect.void,
    })
    const options = { tools: { echo } }
    expect(await failure(`await tools.echo({ data: new Int16Array(1) })`, options)).toContain(
      "An Int16Array cannot cross",
    )
    expect(await failure(`await tools.echo({ data: new ArrayBuffer(1) })`, options)).toContain(
      "An ArrayBuffer cannot cross",
    )
    expect(await failure(`return new DataView(new ArrayBuffer(1))`)).toContain("A DataView cannot cross")
    expect(await failure(`return new Uint8Array(1)`)).toContain("A Uint8Array cannot cross")
    expect(await value(`return JSON.stringify([new Int16Array([1, 2]), new ArrayBuffer(2)])`)).toBe(
      '[{"0":1,"1":2},{}]',
    )
  })
})
