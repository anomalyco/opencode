import { Effect } from "effect"
import { checkArrayLength, checkStringLength } from "../interpreter/limits.js"
import { constructor, methods, prototypeFrom, receiver, requiresNew } from "../interpreter/native.js"
import { IteratorSymbol, rangeError, syntaxError, typeError } from "../interpreter/model.js"
import {
  define,
  defineAccessor,
  get,
  hidden,
  Arr,
  Bytes,
  hostIterator,
  Obj,
  coerceToInteger,
  coerceToNumber,
  coerceToString,
  type Value,
} from "../interpreter/objects.js"
import { describeValue } from "../interpreter/references.js"
import type { Interpreter } from "../interpreter/interpreter.js"

/** The bytes a Uint8Array, array, or other iterable of numbers describes; the host array clamps each value. */
const collectBytes = <R>(ctx: Interpreter<R>, source: Value, name: string): Effect.Effect<Uint8Array, unknown, R> => {
  if (source instanceof Bytes) return Effect.succeed(new Uint8Array(source.bytes))
  return Effect.gen(function* () {
    const cursor = yield* ctx.iterate(source)
    if (cursor === undefined) {
      throw typeError(
        `${name} expects a Uint8Array, an array, or an iterable of numbers, received ${describeValue(source)}.`,
      )
    }
    const values: Array<number> = []
    while (true) {
      const step = yield* cursor.next
      if (step.done) return Uint8Array.from(values)
      values.push(coerceToNumber(step.value))
      checkArrayLength(values.length)
    }
  })
}

const constructBytes = <R>(ctx: Interpreter<R>, args: Array<Value>, proto: Obj) => {
  const source = args[0]
  if (source !== null && typeof source === "object") {
    return Effect.map(collectBytes(ctx, source, "new Uint8Array(...)"), (bytes) => new Bytes(proto, bytes))
  }
  const length = source === undefined ? 0 : coerceToNumber(source)
  if (!Number.isInteger(length) || length < 0) throw rangeError(`Invalid typed array length: ${coerceToString(source)}`)
  checkArrayLength(length)
  return Effect.succeed(new Bytes(proto, new Uint8Array(length)))
}

export const uint8ArrayGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Uint8Array
  const wrap = (bytes: Uint8Array) => new Bytes(proto, bytes)
  const uint8Array = constructor<R>(builtins, proto, {
    name: "Uint8Array",
    length: 3,
    call: requiresNew("Uint8Array"),
    construct: (args, newTarget) => constructBytes(ctx, args, prototypeFrom(newTarget, proto)),
  })
  const decode = (name: string, args: Array<Value>, from: (text: string) => Uint8Array) => {
    if (typeof args[0] !== "string") throw typeError(`Uint8Array.${name} expects a string.`)
    try {
      return wrap(from(args[0]))
    } catch {
      throw syntaxError(`Uint8Array.${name}: the string is not valid ${name === "fromHex" ? "hex" : "base64"}.`)
    }
  }
  methods(builtins, uint8Array, [
    ["from", 1, (_, args) => Effect.map(collectBytes(ctx, args[0], "Uint8Array.from"), wrap)],
    ["of", 0, (_, args) => wrap(Uint8Array.from(args, coerceToNumber))],
    ["fromBase64", 1, (_, args) => decode("fromBase64", args, (text) => Uint8Array.fromBase64(text))],
    ["fromHex", 1, (_, args) => decode("fromHex", args, (text) => Uint8Array.fromHex(text))],
  ])

  const self = (thisValue: Value, name: string) => receiver(Bytes, thisValue, `Uint8Array.prototype.${name}`)
  const optNumber = (value: Value): number | undefined => (value === undefined ? undefined : coerceToInteger(value))
  const wrapAll = (items: Array<Value>) => new Arr(builtins.Array, items)
  defineAccessor(proto, "length", (thisValue) => self(thisValue, "length").bytes.length)
  methods(builtins, proto, [
    ["at", 1, (thisValue, args) => self(thisValue, "at").bytes.at(optNumber(args[0]) ?? 0)],
    [
      "slice",
      2,
      (thisValue, args) => wrap(self(thisValue, "slice").bytes.slice(optNumber(args[0]), optNumber(args[1]))),
    ],
    // A view on the same bytes, as in JS: writes through one are visible through the other.
    [
      "subarray",
      2,
      (thisValue, args) => wrap(self(thisValue, "subarray").bytes.subarray(optNumber(args[0]), optNumber(args[1]))),
    ],
    [
      "set",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "set")
        const offset = optNumber(args[1]) ?? 0
        return Effect.map(collectBytes(ctx, args[0], "Uint8Array.set"), (source) => {
          if (!Number.isInteger(offset) || offset < 0 || source.length + offset > target.bytes.length) {
            throw rangeError("Uint8Array.set: the source does not fit at that offset.")
          }
          target.bytes.set(source, offset)
          return undefined
        })
      },
    ],
    [
      "fill",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "fill")
        target.bytes.fill(coerceToNumber(args[0]), optNumber(args[1]), optNumber(args[2]))
        return target
      },
    ],
    [
      "reverse",
      0,
      (thisValue) => {
        const target = self(thisValue, "reverse")
        target.bytes.reverse()
        return target
      },
    ],
    [
      "indexOf",
      1,
      (thisValue, args) => self(thisValue, "indexOf").bytes.indexOf(coerceToNumber(args[0]), optNumber(args[1])),
    ],
    [
      "lastIndexOf",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "lastIndexOf").bytes
        return args[1] === undefined
          ? target.lastIndexOf(coerceToNumber(args[0]))
          : target.lastIndexOf(coerceToNumber(args[0]), optNumber(args[1]))
      },
    ],
    [
      "includes",
      1,
      (thisValue, args) => self(thisValue, "includes").bytes.includes(coerceToNumber(args[0]), optNumber(args[1])),
    ],
    [
      "join",
      1,
      (thisValue, args) => {
        const joined = self(thisValue, "join").bytes.join(args[0] === undefined ? "," : coerceToString(args[0]))
        checkStringLength(joined.length)
        return joined
      },
    ],
    ["toString", 0, (thisValue) => self(thisValue, "toString").bytes.join(",")],
    ["toBase64", 0, (thisValue) => self(thisValue, "toBase64").bytes.toBase64()],
    ["toHex", 0, (thisValue) => self(thisValue, "toHex").bytes.toHex()],
    ["keys", 0, (thisValue) => hostIterator(builtins, self(thisValue, "keys").bytes.keys())],
    ["values", 0, (thisValue) => hostIterator(builtins, self(thisValue, "values").bytes.values())],
    [
      "entries",
      0,
      (thisValue) =>
        hostIterator(
          builtins,
          self(thisValue, "entries")
            .bytes.entries()
            .map(([index, byte]) => wrapAll([index, byte])),
        ),
    ],
  ])
  define(proto, IteratorSymbol, get(proto, "values"), hidden)
  return uint8Array
}

export const textEncoderGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.TextEncoder
  const encoder = new TextEncoder()
  defineAccessor(proto, "encoding", () => "utf-8")
  methods(builtins, proto, [
    ["encode", 0, (_, args) => new Bytes(builtins.Uint8Array, encoder.encode(coerceToString(args[0] ?? "")))],
  ])
  return constructor<R>(builtins, proto, {
    name: "TextEncoder",
    call: requiresNew("TextEncoder"),
    construct: (_, newTarget) => Effect.succeed(new Obj(prototypeFrom(newTarget, proto))),
  })
}

/** A `TextDecoder` holding the host decoder its label and options configured. */
export class TextDecoderObj extends Obj {
  constructor(
    proto: Obj,
    readonly decoder: TextDecoder,
  ) {
    super(proto)
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
  defineAccessor(proto, "ignoreBOM", (thisValue) => self(thisValue, "ignoreBOM").decoder.ignoreBOM)
  methods(builtins, proto, [
    [
      "decode",
      0,
      (thisValue, args) => {
        const decoder = self(thisValue, "decode").decoder
        if (args[0] === undefined) return ""
        if (!(args[0] instanceof Bytes)) {
          throw typeError(`TextDecoder.decode expects a Uint8Array, received ${describeValue(args[0])}.`)
        }
        try {
          return decoder.decode(args[0].bytes)
        } catch {
          throw typeError(`TextDecoder.decode: the input is not valid ${decoder.encoding}.`)
        }
      },
    ],
  ])
  return constructor<R>(builtins, proto, {
    name: "TextDecoder",
    call: requiresNew("TextDecoder"),
    construct: (args, newTarget) =>
      Effect.sync(() => {
        const label = args[0] === undefined ? "utf-8" : coerceToString(args[0]).trim().toLowerCase()
        if (!utf8Labels.has(label)) throw rangeError(`The "${label}" encoding is not supported; only UTF-8 is.`)
        const options = args[1] instanceof Obj ? args[1] : undefined
        const flag = (name: string) => options !== undefined && Boolean(get(options, name))
        return new TextDecoderObj(
          prototypeFrom(newTarget, proto),
          new TextDecoder("utf-8", { fatal: flag("fatal"), ignoreBOM: flag("ignoreBOM") }),
        )
      }),
  })
}
