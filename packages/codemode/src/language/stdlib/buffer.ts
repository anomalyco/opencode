import { type Builtins, createErrorValue } from "../runtime/intrinsics.js"
import { readsPending, withReads } from "../runtime/callback.js"
import type { Interpreter } from "../runtime/interpreter.js"
import { Throw, typeError } from "../runtime/model.js"
import { constructor, type Method, methods, prototypeFrom, receiver } from "../runtime/native.js"
import {
  Arr,
  Bytes,
  define,
  frozen,
  get,
  hidden,
  Obj,
  coerceToNumber,
  coerceToString,
  record,
  type Value,
} from "../runtime/objects.js"
import { describeValue } from "../runtime/references.js"

/** A Node Buffer: a Uint8Array whose text conversions default to UTF-8. */
export class BufferObj extends Bytes {
  override toString() {
    return host(this.bytes).toString("utf8")
  }
  override toHost() {
    return Buffer.from(this.bytes)
  }
  override derive(builtins: Builtins, bytes: Uint8Array) {
    return new BufferObj(builtins.Buffer, bytes)
  }
  override inspect() {
    const shown = Array.from(this.bytes.subarray(0, 50), (byte) => byte.toString(16).padStart(2, "0")).join(" ")
    const more = this.bytes.length > 50 ? ` ... ${this.bytes.length - 50} more bytes` : ""
    return `<Buffer${shown === "" ? "" : ` ${shown}`}${more}>`
  }
}

// The host Buffer over the same memory, so reads and writes through it are the program's bytes.
const host = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

const encodings = new Set([
  "utf8",
  "utf-8",
  "hex",
  "base64",
  "base64url",
  "latin1",
  "binary",
  "ascii",
  "ucs2",
  "ucs-2",
  "utf16le",
  "utf-16le",
])

const isEncoding = (value: Value) => typeof value === "string" && encodings.has(value.toLowerCase())

// Read and write methods that take only numbers, delegated to the host Buffer as is.
const numeric = [
  "readUInt8",
  "readUint8",
  "readInt8",
  "readUInt16LE",
  "readUint16LE",
  "readUInt16BE",
  "readUint16BE",
  "readInt16LE",
  "readInt16BE",
  "readUInt32LE",
  "readUint32LE",
  "readUInt32BE",
  "readUint32BE",
  "readInt32LE",
  "readInt32BE",
  "readFloatLE",
  "readFloatBE",
  "readDoubleLE",
  "readDoubleBE",
  "readUIntLE",
  "readUIntBE",
  "readIntLE",
  "readIntBE",
  "writeUInt8",
  "writeUint8",
  "writeInt8",
  "writeUInt16LE",
  "writeUint16LE",
  "writeUInt16BE",
  "writeUint16BE",
  "writeInt16LE",
  "writeInt16BE",
  "writeUInt32LE",
  "writeUint32LE",
  "writeUInt32BE",
  "writeUint32BE",
  "writeInt32LE",
  "writeInt32BE",
  "writeFloatLE",
  "writeFloatBE",
  "writeDoubleLE",
  "writeDoubleBE",
  "writeUIntLE",
  "writeUIntBE",
  "writeIntLE",
  "writeIntBE",
  "swap16",
  "swap32",
  "swap64",
] as const

export const bufferGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Buffer
  const wrap = (bytes: Uint8Array) => new BufferObj(proto, bytes)
  const self = (thisValue: Value, name: string) => receiver(Bytes, thisValue, `Buffer.prototype.${name}`)

  const fail = (type: "Error" | "TypeError" | "RangeError", message: string, code?: string) => {
    const value = createErrorValue(builtins[type], message)
    if (code !== undefined) define(value, "code", code)
    return new Throw(value)
  }
  // Host Buffer errors carry Node's `code`; they cross as the program error of the same type.
  const attempt = <A>(run: () => A): A => {
    try {
      return run()
    } catch (error) {
      if (!(error instanceof Error)) throw error
      const code = (error as { code?: unknown }).code
      throw fail(
        error.name === "RangeError" || error.name === "TypeError" ? error.name : "Error",
        error.message,
        typeof code === "string" ? code : undefined,
      )
    }
  }
  const encoding = (value: Value): BufferEncoding | undefined => {
    if (value === undefined) return undefined
    if (isEncoding(value)) return coerceToString(value).toLowerCase() as BufferEncoding
    throw fail("TypeError", `Unknown encoding: ${coerceToString(value)}`, "ERR_UNKNOWN_ENCODING")
  }
  const argument = (value: Value): unknown => {
    if (value instanceof Bytes) return host(value.bytes)
    if (value === null || value === undefined || typeof value !== "object") return value
    return coerceToNumber(value)
  }
  const bytesFrom = (value: Value, second: Value, third: Value): Uint8Array => {
    if (typeof value === "string") return new Uint8Array(Buffer.from(value, encoding(second) ?? "utf8"))
    if (value instanceof Bytes) {
      const offset = second === undefined ? 0 : coerceToNumber(second)
      const length = third === undefined ? undefined : coerceToNumber(third)
      return value.bytes.slice(offset, length === undefined ? undefined : offset + length)
    }
    if (value instanceof Arr) return Uint8Array.from(value.items, coerceToNumber)
    if (value instanceof Obj) {
      const data = get(value, "data")
      const type = get(value, "type")
      // `type` and `data` decide the path, so a getter among them is read before `length` could be.
      if (readsPending()) return new Uint8Array()
      if (type === "Buffer" && data instanceof Arr) return Uint8Array.from(data.items, coerceToNumber)
      const length = get(value, "length")
      if (typeof length === "number")
        return Uint8Array.from({ length }, (_, index) => coerceToNumber(get(value, String(index))))
    }
    throw fail(
      "TypeError",
      `The first argument must be of type string or an instance of Buffer, Uint8Array, or Array or an Array-like Object. Received ${describeValue(value)}`,
      "ERR_INVALID_ARG_TYPE",
    )
  }
  const size = (value: Value) => {
    const length = coerceToNumber(value)
    if (!Number.isInteger(length) || length < 0) {
      throw fail("RangeError", `The argument 'size' is invalid. Received ${coerceToString(value)}`, "ERR_OUT_OF_RANGE")
    }
    return length
  }

  const buffer = constructor(builtins, proto, {
    name: "Buffer",
    length: 2,
    call: (_, args) => withReads(() => wrap(bytesFrom(args[0], args[1], args[2]))),
    construct: (args, newTarget) =>
      withReads(() => new BufferObj(prototypeFrom(newTarget, proto), bytesFrom(args[0], args[1], args[2]))),
  })
  // Bun inherits this from Uint8Array; Buffer's constructor here does not.
  define(buffer, "BYTES_PER_ELEMENT", 1, frozen)
  methods(builtins, buffer, [
    ["from", 3, (_, args) => withReads(() => wrap(bytesFrom(args[0], args[1], args[2])))],
    [
      "alloc",
      3,
      (_, args) => {
        const bytes = new Uint8Array(size(args[0]))
        const fill = args[1] === undefined ? undefined : argument(args[1])
        // Node reads an encoding only after a string fill; after a number it would be an offset.
        if (typeof fill === "string") attempt(() => host(bytes).fill(fill, encoding(args[2]) ?? "utf8"))
        else if (fill !== undefined) attempt(() => host(bytes).fill(fill as number))
        return wrap(bytes)
      },
    ],
    ["allocUnsafe", 1, (_, args) => wrap(new Uint8Array(size(args[0])))],
    ["allocUnsafeSlow", 1, (_, args) => wrap(new Uint8Array(size(args[0])))],
    [
      "byteLength",
      2,
      (_, args) =>
        args[0] instanceof Bytes
          ? args[0].bytes.byteLength
          : Buffer.byteLength(coerceToString(args[0]), encoding(args[1])),
    ],
    [
      "concat",
      2,
      (_, args) => {
        const list = args[0]
        if (!(list instanceof Arr))
          throw typeError(`Buffer.concat expects an array of Buffers, received ${describeValue(list)}.`)
        const parts = list.items.map((item) => {
          if (item instanceof Bytes) return item.bytes
          throw typeError(`Buffer.concat expects an array of Buffers, received ${describeValue(item)} in it.`)
        })
        const total = args[1] === undefined ? parts.reduce((sum, part) => sum + part.length, 0) : size(args[1])
        const joined = new Uint8Array(total)
        parts.reduce((offset, part) => {
          if (offset < total) joined.set(part.subarray(0, total - offset), offset)
          return offset + part.length
        }, 0)
        return wrap(joined)
      },
    ],
    ["isBuffer", 1, (_, args) => args[0] instanceof BufferObj],
    ["isEncoding", 1, (_, args) => isEncoding(args[0])],
    [
      "compare",
      2,
      (_, args) => {
        if (!(args[0] instanceof Bytes) || !(args[1] instanceof Bytes))
          throw typeError("Buffer.compare expects two Buffers or Uint8Arrays.")
        return Buffer.compare(args[0].bytes, args[1].bytes)
      },
    ],
  ])
  define(buffer, "poolSize", 8192, hidden)

  const view = (thisValue: Value, name: string, args: Array<Value>) => {
    const bytes = self(thisValue, name).bytes
    const length = bytes.length
    const clamp = (value: Value, fallback: number) => {
      if (value === undefined) return fallback
      const index = Math.trunc(coerceToNumber(value)) || 0
      return index < 0 ? Math.max(0, length + index) : Math.min(index, length)
    }
    return wrap(bytes.subarray(clamp(args[0], 0), clamp(args[1], length)))
  }
  const delegate = (name: string, length: number): Method => [
    name,
    length,
    (thisValue, args) => {
      const target = host(self(thisValue, name).bytes)
      const method = (target as unknown as Record<string, (...items: Array<unknown>) => unknown>)[name]!
      const result = attempt(() => method.apply(target, args.map(argument)))
      if (result === target) return thisValue
      if (typeof result === "number" || typeof result === "boolean" || typeof result === "string") return result
      return undefined
    },
  ]
  methods(builtins, proto, [
    [
      "toString",
      3,
      (thisValue, args) => {
        const bytes = self(thisValue, "toString").bytes
        const start = args[1] === undefined ? 0 : Math.max(0, coerceToNumber(args[1]))
        const end = args[2] === undefined ? bytes.length : Math.min(bytes.length, coerceToNumber(args[2]))
        return host(bytes).toString(encoding(args[0]) ?? "utf8", start, end)
      },
    ],
    [
      "toJSON",
      0,
      (thisValue) =>
        record(builtins.Object, {
          type: "Buffer",
          data: new Arr(builtins.Array, [...self(thisValue, "toJSON").bytes]),
        }),
    ],
    ["slice", 2, (thisValue, args) => view(thisValue, "slice", args)],
    ["subarray", 2, (thisValue, args) => view(thisValue, "subarray", args)],
    [
      "equals",
      1,
      (thisValue, args) => {
        const other = args[0]
        if (!(other instanceof Bytes))
          throw typeError(
            `The "otherBuffer" argument must be an instance of Buffer or Uint8Array. Received ${describeValue(other)}`,
          )
        return Buffer.compare(self(thisValue, "equals").bytes, other.bytes) === 0
      },
    ],
    delegate("compare", 5),
    delegate("indexOf", 3),
    delegate("lastIndexOf", 3),
    delegate("includes", 3),
    delegate("write", 4),
    delegate("fill", 4),
    delegate("copy", 4),
    ...numeric.map((name) => delegate(name, 2)),
  ])
  return buffer
}
