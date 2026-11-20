import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CodeMode, Extension } from "../src/index.js"

const value = async (code: string, extensions: ReadonlyArray<Extension.Extension> = []) => {
  const result = await Effect.runPromise(CodeMode.make({ extensions }).execute(code))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

describe("Buffer", () => {
  test("converts text in each encoding, defaulting to UTF-8", async () => {
    expect(
      await value(`const b = Buffer.from("héllo")
        return [b.length, b.toString(), String(b), \`\${b}\`, b.toString("hex"), b.toString("base64"),
          Buffer.from("aGk=", "base64").toString(), Buffer.from("6869", "hex").toString(), Buffer.byteLength("é")]`),
    ).toEqual([6, "héllo", "héllo", "héllo", "68c3a96c6c6f", "aMOpbGxv", "hi", "hi", 2])
  })

  test("is a Uint8Array, and Buffer.isBuffer tells the two apart", async () => {
    expect(
      await value(`const b = Buffer.from([1, 2, 3])
        return [b instanceof Uint8Array, Buffer.isBuffer(b), Buffer.isBuffer(new Uint8Array(1)), [...b], b[1],
          Object.prototype.toString.call(b)]`),
    ).toEqual([true, true, false, [1, 2, 3], 2, "[object Uint8Array]"])
  })

  test("concatenates, slices over the same memory, compares and searches like Node", async () => {
    expect(
      await value(`const b = Buffer.concat([Buffer.from("ab"), Buffer.from("cd")])
        const view = b.subarray(1, 3)
        view[0] = 120
        return [b.toString(), view.toString(), b.equals(Buffer.from("axcd")), Buffer.compare(Buffer.from("a"), Buffer.from("b")),
          b.includes("cd"), b.indexOf("c"), Buffer.alloc(3, 1).toString("hex"), Buffer.alloc(4, "ab").toString()]`),
    ).toEqual(["axcd", "xc", true, -1, true, 2, "010101", "abab"])
  })

  test("makes a Buffer from a Buffer through the inherited Uint8Array methods, like Bun", async () => {
    expect(
      await value(`const b = Buffer.from("abc")
        const made = [b.map((x) => x + 1), b.filter((x) => x > 97), Uint8Array.prototype.slice.call(b, 1),
          Uint8Array.prototype.subarray.call(b, 2)]
        return [...made.map((x) => [Buffer.isBuffer(x), x.toString()]), Buffer.isBuffer(new Uint8Array(1).map((x) => x)),
          String(new Uint8Array([1, 2]).slice(1))]`),
    ).toEqual([[true, "bcd"], [true, "bc"], [true, "bc"], [true, "c"], false, "2"])
  })

  test("reads and writes numbers", async () => {
    expect(
      await value(`const b = Buffer.alloc(4)
        b.writeUInt16BE(0x1234, 0)
        b.writeInt8(-1, 2)
        return [b.readUInt16BE(0), b.readUInt16LE(0), b.readInt8(2), b.toString("hex")]`),
    ).toEqual([0x1234, 0x3412, -1, "1234ff00"])
  })

  test("serializes like Node and rejects unknown encodings with Node's code", async () => {
    expect(
      await value(`let code
        try { Buffer.from("x", "nope") } catch (e) { code = [e.name, e.code] }
        return [JSON.stringify(Buffer.from("hi")), code]`),
    ).toEqual(['{"type":"Buffer","data":[104,105]}', ["TypeError", "ERR_UNKNOWN_ENCODING"]])
  })

  test("crosses extensions as a Buffer in both directions", async () => {
    const seen: Array<boolean> = []
    const bytes = Extension.make({
      name: "bytes",
      globals: {
        read: () => Buffer.from("from host"),
        write: (value: unknown) => void seen.push(Buffer.isBuffer(value)),
      },
    })
    expect(
      await value(`const b = read()
        write(Buffer.from("x"))
        return [Buffer.isBuffer(b), b.toString()]`, [bytes]),
    ).toEqual([true, "from host"])
    expect(seen).toEqual([true])
  })

  test("is importable from the buffer module", async () => {
    expect(await value(`const { Buffer: B } = await import("node:buffer"); return B.from("ok").toString()`)).toBe("ok")
  })
})
