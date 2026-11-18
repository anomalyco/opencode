import { Invoke } from "../runtime/signals.js"
import { checkArrayLength, checkStringLength } from "../runtime/limits.js"
import {
  constants,
  constructor,
  type Method,
  methods,
  prototypeFrom,
  receiver,
  requiresNew,
  iteratorMethods,
} from "../runtime/native.js"
import { IteratorSymbol, rangeError, syntaxError, typeError } from "../runtime/model.js"
import {
  ArrayBufferObj,
  DataViewObj,
  define,
  defineAccessor,
  get,
  getOwn,
  hidden,
  Bytes,
  type HostTypedArray,
  isTypedArrayKind,
  Obj,
  TypedArrayObj,
  type TypedArrayKind,
  typedArrayKinds,
  viewedBytes,
  coerceToInteger,
  coerceToNumber,
  coerceToString,
  type Value,
} from "../runtime/objects.js"
import { describeValue } from "../runtime/references.js"
import { requireCallback } from "../runtime/callback.js"
import type { Builtins } from "../runtime/intrinsics.js"
import type { Interpreter } from "../runtime/interpreter.js"
import { sortArray } from "./array.js"

type Kind = TypedArrayKind

/** A typed array over `array`: a `Bytes` when it is a Uint8Array, so the byte built-ins accept it. */
export const makeTyped = (proto: Obj, array: HostTypedArray, buffer?: ArrayBufferObj): TypedArrayObj =>
  array instanceof Uint8Array ? new Bytes(proto, array, buffer) : new TypedArrayObj(proto, array, buffer)

// Lengths are capped by the memory they take, like arrays by their items.
const checkTypedLength = (kind: Kind, length: number) =>
  checkArrayLength(length * typedArrayKinds[kind].BYTES_PER_ELEMENT)

// ToIndex: an integer offset or length in [0, 2^53 - 1]; undefined is 0.
const toIndex = (value: Value, what: string): number => {
  const index = value === undefined ? 0 : coerceToInteger(value)
  if (index < 0 || index > Number.MAX_SAFE_INTEGER) throw rangeError(`Invalid ${what}: ${coerceToString(value)}`)
  return index
}

/**
 * The elements a typed array, array, or other iterable of numbers describes, read in the prelude: a new typed array
 * of `kind` with prototype `into`, or set into the typed array `into` at `offset`. The host array converts each value.
 */
const collectTyped = <R>(
  ctx: Interpreter<R>,
  source: Value,
  name: string,
  kind: Kind,
  into: Obj,
  offset: number,
  mapper?: Value,
  thisArg?: Value,
) => {
  const callback = mapper === undefined ? undefined : requireCallback(mapper, name)
  if (source instanceof TypedArrayObj && callback === undefined) {
    return finishTyped(ctx.builtins, source.array, kind, into, offset)
  }
  return new Invoke(
    ctx.prelude.fn("collectTyped"),
    undefined,
    [source, name, callback, thisArg, kind, into, offset],
    undefined,
  )
}

/** Values as a new typed array like `like` (with prototype `into`, if given), or set into the typed array `into`. */
export const finishTyped = (
  builtins: Builtins,
  values: ArrayLike<number>,
  like: Kind | TypedArrayObj,
  into: Value,
  offset: number,
): Value => {
  if (into instanceof TypedArrayObj) {
    if (!Number.isInteger(offset) || offset < 0 || values.length + offset > into.array.length) {
      throw rangeError(`${into.kind}.set: the source does not fit at that offset.`)
    }
    into.array.set(values, offset)
    return undefined
  }
  const kind = typeof like === "string" ? like : like.kind
  checkTypedLength(kind, values.length)
  const array = new typedArrayKinds[kind](values.length)
  array.set(values)
  return makeTyped(into instanceof Obj ? into : builtins[kind], array)
}

const constructTyped = <R>(ctx: Interpreter<R>, kind: Kind, args: Array<Value>, proto: Obj) => {
  const source = args[0]
  if (source instanceof ArrayBufferObj) return viewOver(kind, source, args[1], args[2], proto)
  if (source !== null && typeof source === "object")
    return collectTyped(ctx, source, `new ${kind}(...)`, kind, proto, 0)
  const length = source === undefined ? 0 : coerceToNumber(source)
  if (!Number.isInteger(length) || length < 0) throw rangeError(`Invalid typed array length: ${coerceToString(source)}`)
  checkTypedLength(kind, length)
  return makeTyped(proto, new typedArrayKinds[kind](length))
}

// `new Kind(buffer, byteOffset, length)`: a view sharing the buffer's memory, checked as JS checks it.
const viewOver = (kind: Kind, buffer: ArrayBufferObj, offsetArg: Value, lengthArg: Value, proto: Obj) => {
  const size = typedArrayKinds[kind].BYTES_PER_ELEMENT
  const offset = toIndex(offsetArg, "typed array byte offset")
  if (offset % size !== 0) throw rangeError(`Start offset of ${kind} should be a multiple of ${size}.`)
  const total = buffer.buffer.byteLength
  if (lengthArg === undefined) {
    if (total % size !== 0) throw rangeError(`Byte length of ${kind} should be a multiple of ${size}.`)
    if (offset > total) throw rangeError(`Start offset ${offset} is outside the bounds of the buffer.`)
    return makeTyped(proto, new typedArrayKinds[kind](buffer.buffer, offset), buffer)
  }
  const length = toIndex(lengthArg, "typed array length")
  if (offset + length * size > total) throw rangeError(`Invalid typed array length: ${length}`)
  return makeTyped(proto, new typedArrayKinds[kind](buffer.buffer, offset, length), buffer)
}

/** `%TypedArray%`, its prototype's methods, and `from` and `of`, which every typed array constructor inherits. */
const typedArrayIntrinsic = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.TypedArray
  const existing = getOwn(proto, "constructor")
  if (existing instanceof Obj) return existing
  const abstract = () => {
    throw typeError("Abstract class TypedArray not directly constructable.")
  }
  const typedArray = constructor(builtins, proto, { name: "TypedArray", call: abstract, construct: abstract })
  // Which constructor `from` and `of` were called on.
  const kindOf = (thisValue: Value, method: string): Kind => {
    const name = thisValue instanceof Obj ? getOwn(thisValue, "name") : undefined
    if (isTypedArrayKind(name) && getOwn(thisValue as Obj, "prototype") === builtins[name]) return name
    throw typeError(`TypedArray.${method}: ${describeValue(thisValue)} is not a typed array constructor.`)
  }
  methods(builtins, typedArray, [
    [
      "from",
      1,
      (thisValue, args) => {
        const kind = kindOf(thisValue, "from")
        return collectTyped(ctx, args[0], `${kind}.from`, kind, builtins[kind], 0, args[1], args[2])
      },
    ],
    [
      "of",
      0,
      (thisValue, args) => finishTyped(builtins, args.map(coerceToNumber), kindOf(thisValue, "of"), undefined, 0),
    ],
  ])

  const self = (thisValue: Value, name: string) => receiver(TypedArrayObj, thisValue, `TypedArray.prototype.${name}`)
  const optNumber = (value: Value): number | undefined => (value === undefined ? undefined : coerceToInteger(value))
  // Search values are not coerced: a non-number never matches (`bytes.includes("1")` is false).
  const search = <A>(thisValue: Value, name: string, value: Value, missing: A, find: (array: HostTypedArray) => A) => {
    const array = self(thisValue, name).array
    return typeof value === "number" ? find(array) : missing
  }
  defineAccessor(proto, "length", (thisValue) => self(thisValue, "length").array.length)
  defineAccessor(proto, "byteLength", (thisValue) => self(thisValue, "byteLength").array.byteLength)
  defineAccessor(proto, "byteOffset", (thisValue) => self(thisValue, "byteOffset").array.byteOffset)
  defineAccessor(proto, "buffer", (thisValue) => self(thisValue, "buffer").bufferObj(builtins.ArrayBuffer))
  methods(builtins, proto, [
    ["at", 1, (thisValue, args) => self(thisValue, "at").array.at(optNumber(args[0]) ?? 0)],
    [
      "slice",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "slice")
        return makeTyped(builtins[target.kind], target.array.slice(optNumber(args[0]), optNumber(args[1])))
      },
    ],
    // A view on the same memory, as in JS: writes through one are visible through the other.
    [
      "subarray",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "subarray")
        return makeTyped(
          builtins[target.kind],
          target.array.subarray(optNumber(args[0]), optNumber(args[1])),
          target.bufferObj(builtins.ArrayBuffer),
        )
      },
    ],
    [
      "set",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "set")
        const offset = toIndex(args[1], "offset")
        return collectTyped(ctx, args[0], `${target.kind}.set`, target.kind, target, offset)
      },
    ],
    [
      "fill",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "fill")
        target.array.fill(coerceToNumber(args[0]), optNumber(args[1]), optNumber(args[2]))
        return target
      },
    ],
    [
      "copyWithin",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "copyWithin")
        target.array.copyWithin(optNumber(args[0]) ?? 0, optNumber(args[1]) ?? 0, optNumber(args[2]))
        return target
      },
    ],
    [
      "reverse",
      0,
      (thisValue) => {
        const target = self(thisValue, "reverse")
        target.array.reverse()
        return target
      },
    ],
    [
      "toReversed",
      0,
      (thisValue) => {
        const target = self(thisValue, "toReversed")
        return makeTyped(builtins[target.kind], target.array.slice().reverse())
      },
    ],
    [
      "with",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "with")
        const length = target.array.length
        const relative = coerceToInteger(args[0])
        const at = relative < 0 ? length + relative : relative
        const value = coerceToNumber(args[1])
        if (at < 0 || at >= length) throw rangeError(`Invalid typed array index: ${relative}`)
        const copy = target.array.slice()
        copy[at] = value
        return makeTyped(builtins[target.kind], copy)
      },
    ],
    [
      "sort",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "sort")
        // Without a comparator, typed arrays sort numerically rather than by string.
        if (args[0] === undefined) {
          target.array.sort()
          return target
        }
        return sortArray(ctx, target, args[0], `${target.kind}.sort`)
      },
    ],
    [
      "indexOf",
      1,
      (thisValue, args) =>
        search(thisValue, "indexOf", args[0], -1, (array) => array.indexOf(args[0] as number, optNumber(args[1]))),
    ],
    [
      "lastIndexOf",
      1,
      (thisValue, args) =>
        search(thisValue, "lastIndexOf", args[0], -1, (array) =>
          args.length < 2
            ? array.lastIndexOf(args[0] as number)
            : array.lastIndexOf(args[0] as number, optNumber(args[1])),
        ),
    ],
    [
      "includes",
      1,
      (thisValue, args) =>
        search(thisValue, "includes", args[0], false, (array) => array.includes(args[0] as number, optNumber(args[1]))),
    ],
    [
      "join",
      1,
      (thisValue, args) => {
        const joined = self(thisValue, "join").array.join(args[0] === undefined ? "," : coerceToString(args[0]))
        checkStringLength(joined.length)
        return joined
      },
    ],
    ["toString", 0, (thisValue) => self(thisValue, "toString").array.join(",")],
    ...iteratorMethods(builtins, self),
    // The callback methods are the prelude's.
  ])
  define(proto, IteratorSymbol, get(proto, "values"), hidden)
  return typedArray
}

/** One typed array constructor, such as `Int16Array`, inheriting from `%TypedArray%`. */
export const typedArrayGlobal = <R>(ctx: Interpreter<R>, kind: Kind) => {
  const builtins = ctx.builtins
  const proto = builtins[kind]
  const ctor = constructor(builtins, proto, {
    name: kind,
    length: 3,
    call: requiresNew(kind),
    construct: (args, newTarget) => constructTyped(ctx, kind, args, prototypeFrom(newTarget, proto)),
  })
  ctor.proto = typedArrayIntrinsic(ctx)
  const size = typedArrayKinds[kind].BYTES_PER_ELEMENT
  constants(ctor, { BYTES_PER_ELEMENT: size })
  constants(proto, { BYTES_PER_ELEMENT: size })
  if (kind === "Uint8Array") uint8ArrayMethods(builtins, ctor)
  return ctor
}

// What only Uint8Array has: base64 and hex.
const uint8ArrayMethods = (builtins: Builtins, uint8Array: Obj) => {
  const wrap = (bytes: Uint8Array) => new Bytes(builtins.Uint8Array, bytes)
  const decode = (name: string, args: Array<Value>, from: (text: string) => Uint8Array) => {
    if (typeof args[0] !== "string") throw typeError(`Uint8Array.${name} expects a string.`)
    try {
      return wrap(from(args[0]))
    } catch {
      throw syntaxError(`Uint8Array.${name}: the string is not valid ${name === "fromHex" ? "hex" : "base64"}.`)
    }
  }
  methods(builtins, uint8Array, [
    ["fromBase64", 1, (_, args) => decode("fromBase64", args, (text) => Uint8Array.fromBase64(text))],
    ["fromHex", 1, (_, args) => decode("fromHex", args, (text) => Uint8Array.fromHex(text))],
  ])
  const self = (thisValue: Value, name: string) => receiver(Bytes, thisValue, `Uint8Array.prototype.${name}`)
  methods(builtins, builtins.Uint8Array, [
    ["toBase64", 0, (thisValue) => self(thisValue, "toBase64").bytes.toBase64()],
    ["toHex", 0, (thisValue) => self(thisValue, "toHex").bytes.toHex()],
  ])
}

export const arrayBufferGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.ArrayBuffer
  const self = (thisValue: Value, name: string) => receiver(ArrayBufferObj, thisValue, `ArrayBuffer.prototype.${name}`)
  const arrayBuffer = constructor(builtins, proto, {
    name: "ArrayBuffer",
    length: 1,
    call: requiresNew("ArrayBuffer"),
    construct: (args, newTarget) => {
      const length = toIndex(args[0], "array buffer length")
      if (args[1] instanceof Obj && get(args[1], "maxByteLength") !== undefined) {
        throw typeError("Resizable ArrayBuffers are not supported; allocate the largest size up front.")
      }
      checkArrayLength(length)
      return new ArrayBufferObj(prototypeFrom(newTarget, proto), new ArrayBuffer(length))
    },
  })
  methods(builtins, arrayBuffer, [
    ["isView", 1, (_, args) => args[0] instanceof TypedArrayObj || args[0] instanceof DataViewObj],
  ])
  defineAccessor(proto, "byteLength", (thisValue) => self(thisValue, "byteLength").buffer.byteLength)
  defineAccessor(proto, "maxByteLength", (thisValue) => self(thisValue, "maxByteLength").buffer.byteLength)
  defineAccessor(proto, "resizable", (thisValue) => (self(thisValue, "resizable"), false))
  defineAccessor(proto, "detached", (thisValue) => (self(thisValue, "detached"), false))
  methods(builtins, proto, [
    [
      "slice",
      2,
      (thisValue, args) => {
        const optNumber = (value: Value) => (value === undefined ? undefined : coerceToInteger(value))
        const copy = self(thisValue, "slice").buffer.slice(optNumber(args[0]) ?? 0, optNumber(args[1]))
        return new ArrayBufferObj(proto, copy)
      },
    ],
  ])
  return arrayBuffer
}

// DataView's element types and their sizes; the 64-bit BigInt ones need BigInt, which programs lack.
const dataViewTypes = [
  ["Int8", 1],
  ["Uint8", 1],
  ["Int16", 2],
  ["Uint16", 2],
  ["Int32", 4],
  ["Uint32", 4],
  ["Float32", 4],
  ["Float64", 8],
] as const

export const dataViewGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.DataView
  const self = (thisValue: Value, name: string) => receiver(DataViewObj, thisValue, `DataView.prototype.${name}`)
  const dataView = constructor(builtins, proto, {
    name: "DataView",
    length: 1,
    call: requiresNew("DataView"),
    construct: (args, newTarget) => {
      const buffer = args[0]
      if (!(buffer instanceof ArrayBufferObj)) {
        throw typeError(
          `First argument to DataView constructor must be an ArrayBuffer, received ${describeValue(buffer)}.`,
        )
      }
      const offset = toIndex(args[1], "DataView byte offset")
      const total = buffer.buffer.byteLength
      if (offset > total) throw rangeError(`Start offset ${offset} is outside the bounds of the buffer.`)
      const length = args[2] === undefined ? total - offset : toIndex(args[2], "DataView length")
      if (offset + length > total) throw rangeError(`Invalid DataView length ${length}`)
      return new DataViewObj(prototypeFrom(newTarget, proto), new DataView(buffer.buffer, offset, length), buffer)
    },
  })
  defineAccessor(proto, "buffer", (thisValue) => self(thisValue, "buffer").buffer)
  defineAccessor(proto, "byteLength", (thisValue) => self(thisValue, "byteLength").view.byteLength)
  defineAccessor(proto, "byteOffset", (thisValue) => self(thisValue, "byteOffset").view.byteOffset)
  // The byte index of an access, checked against the view before the host reads or writes.
  const at = (view: DataView, value: Value, size: number) => {
    const index = toIndex(value, "DataView offset")
    if (index + size > view.byteLength) throw rangeError("Offset is outside the bounds of the DataView.")
    return index
  }
  methods(
    builtins,
    proto,
    dataViewTypes.flatMap(
      ([type, size]): Array<Method> => [
        [
          `get${type}`,
          1,
          (thisValue, args) => {
            const view = self(thisValue, `get${type}`).view
            return view[`get${type}`](at(view, args[0], size), Boolean(args[1]))
          },
        ],
        [
          `set${type}`,
          2,
          (thisValue, args) => {
            const view = self(thisValue, `set${type}`).view
            const index = at(view, args[0], size)
            view[`set${type}`](index, coerceToNumber(args[1]), Boolean(args[2]))
            return undefined
          },
        ],
      ],
    ),
  )
  return dataView
}

export const textEncoderGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.TextEncoder
  const encoder = new TextEncoder()
  defineAccessor(proto, "encoding", () => "utf-8")
  methods(builtins, proto, [
    [
      "encode",
      0,
      (_, args) => new Bytes(builtins.Uint8Array, encoder.encode(coerceToString(args[0] === undefined ? "" : args[0]))),
    ],
  ])
  return constructor(builtins, proto, {
    name: "TextEncoder",
    call: requiresNew("TextEncoder"),
    construct: (_, newTarget) => new Obj(prototypeFrom(newTarget, proto)),
  })
}

// Replacement mode only needs to identify an incomplete suffix (at most three bytes).
// Fatal mode also needs the queue position after the first error, which the host doesn't expose.
const streamBoundary = (bytes: Uint8Array, fatal: boolean) => {
  let next = fatal ? 0 : Math.max(0, bytes.length - 3)
  while (next < bytes.length) {
    const start = next
    const lead = bytes[next++]!
    if (lead < 0x80) continue
    if (lead < 0xc2 || lead > 0xf4) {
      if (fatal) return { end: next, error: true }
      continue
    }
    const width = lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
    let lower = lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80
    let upper = lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf
    while (next < start + width) {
      if (next === bytes.length) return { end: start, error: false }
      const byte = bytes[next]!
      // A bad continuation is reprocessed as a leading byte, even after a fatal error.
      if (byte < lower || byte > upper) {
        if (fatal) return { end: next, error: true }
        break
      }
      next++
      lower = 0x80
      upper = 0xbf
    }
  }
  return { end: next, error: false }
}

const empty = new Uint8Array()

export class TextDecoderObj extends Obj {
  queued: Uint8Array = empty
  seen = false

  constructor(
    proto: Obj,
    readonly decoder: TextDecoder,
    readonly ignoreBOM: boolean,
  ) {
    super(proto)
  }

  decode(bytes: Uint8Array, stream: boolean) {
    if (this.queued.length && bytes.length) {
      checkArrayLength(this.queued.length + bytes.length)
      const joined = new Uint8Array(this.queued.length + bytes.length)
      joined.set(this.queued)
      joined.set(bytes, this.queued.length)
      bytes = joined
    }
    if (!bytes.length) bytes = this.queued
    const { end, error } = stream ? streamBoundary(bytes, this.decoder.fatal) : { end: bytes.length, error: false }
    this.queued = end < bytes.length ? bytes.slice(end) : empty
    if (error) throw typeError("TextDecoder.decode: the input is not valid utf-8.")
    const stripBOM = !this.ignoreBOM && !this.seen
    if (!stream) this.seen = false
    try {
      // Keep the host decoder stateless: snapshots own the pending bytes and BOM decision.
      const text = this.decoder.decode(end === bytes.length ? bytes : bytes.subarray(0, end))
      if (stream && text.length) this.seen = true
      return stripBOM && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
    } catch {
      throw typeError("TextDecoder.decode: the input is not valid utf-8.")
    }
  }
}

// The WHATWG labels for UTF-8, the only encoding CodeMode decodes.
const utf8Labels = new Set(["unicode-1-1-utf-8", "unicode11utf8", "unicode20utf8", "utf-8", "utf8", "x-unicode20utf8"])

export const textDecoderGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.TextDecoder
  const self = (thisValue: Value, name: string) => receiver(TextDecoderObj, thisValue, `TextDecoder.prototype.${name}`)
  defineAccessor(proto, "encoding", (thisValue) => self(thisValue, "encoding").decoder.encoding)
  defineAccessor(proto, "fatal", (thisValue) => self(thisValue, "fatal").decoder.fatal)
  defineAccessor(proto, "ignoreBOM", (thisValue) => self(thisValue, "ignoreBOM").ignoreBOM)
  methods(builtins, proto, [
    [
      "decode",
      0,
      (thisValue, args) => {
        const decoder = self(thisValue, "decode")
        const bytes = viewedBytes(args[0])
        if (args[0] !== undefined && bytes === undefined) {
          throw typeError(
            `TextDecoder.decode expects an ArrayBuffer, a typed array, or a DataView, received ${describeValue(args[0])}.`,
          )
        }
        const options = args[1]
        if (options !== undefined && typeof options !== "object") {
          throw typeError("TextDecoder.decode expects an options object.")
        }
        const stream = options instanceof Obj && Boolean(get(options, "stream"))
        return decoder.decode(bytes ?? empty, stream)
      },
    ],
  ])
  return constructor(builtins, proto, {
    name: "TextDecoder",
    call: requiresNew("TextDecoder"),
    construct: (args, newTarget) => {
      const label = args[0] === undefined ? "utf-8" : coerceToString(args[0]).trim().toLowerCase()
      if (!utf8Labels.has(label)) throw rangeError(`The "${label}" encoding is not supported; only UTF-8 is.`)
      const options = args[1] instanceof Obj ? args[1] : undefined
      const flag = (name: string) => options !== undefined && Boolean(get(options, name))
      return new TextDecoderObj(
        prototypeFrom(newTarget, proto),
        new TextDecoder("utf-8", { fatal: flag("fatal"), ignoreBOM: true }),
        flag("ignoreBOM"),
      )
    },
  })
}
