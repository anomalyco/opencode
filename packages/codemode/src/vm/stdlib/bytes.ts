import { Invoke } from "../runtime/signals.js"
import { checkArrayLength, checkStringLength } from "../runtime/limits.js"
import { constructor, methods, prototypeFrom, receiver, requiresNew, iteratorMethods } from "../runtime/native.js"
import { IteratorSymbol, rangeError, syntaxError, typeError } from "../runtime/model.js"
import {
  define,
  defineAccessor,
  get,
  hidden,
  Bytes,
  Obj,
  coerceToInteger,
  coerceToNumber,
  coerceToString,
  type Value,
} from "../runtime/objects.js"
import { describeValue } from "../runtime/references.js"
import { requireCallback } from "../runtime/callback.js"
import type { Interpreter } from "../runtime/interpreter.js"
import { sortArray } from "./array.js"

/**
 * The bytes a Uint8Array, array, or other iterable of numbers describes, read in the prelude: a new Uint8Array with
 * prototype `into`, or set into the Uint8Array `into` at `offset`. The host array clamps each value.
 */
const collectBytes = <R>(
  ctx: Interpreter<R>,
  source: Value,
  name: string,
  into: Obj,
  offset: number,
  mapper?: Value,
  thisArg?: Value,
) => {
  const callback = mapper === undefined ? undefined : requireCallback(mapper, name)
  if (source instanceof Bytes && callback === undefined) return finishBytes(new Uint8Array(source.bytes), into, offset)
  return new Invoke(
    ctx.prelude.fn("collectBytes"),
    undefined,
    [source, name, callback, thisArg, into, offset],
    undefined,
  )
}

export const finishBytes = (bytes: Uint8Array, into: Obj, offset: number): Value => {
  if (!(into instanceof Bytes)) return new Bytes(into, bytes)
  if (!Number.isInteger(offset) || offset < 0 || bytes.length + offset > into.bytes.length) {
    throw rangeError("Uint8Array.set: the source does not fit at that offset.")
  }
  into.bytes.set(bytes, offset)
  return undefined
}

const constructBytes = <R>(ctx: Interpreter<R>, args: Array<Value>, proto: Obj) => {
  const source = args[0]
  if (source !== null && typeof source === "object") return collectBytes(ctx, source, "new Uint8Array(...)", proto, 0)
  const length = source === undefined ? 0 : coerceToNumber(source)
  if (!Number.isInteger(length) || length < 0) throw rangeError(`Invalid typed array length: ${coerceToString(source)}`)
  checkArrayLength(length)
  return new Bytes(proto, new Uint8Array(length))
}

export const uint8ArrayGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Uint8Array
  const wrap = (bytes: Uint8Array) => new Bytes(proto, bytes)
  const uint8Array = constructor(builtins, proto, {
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
    ["from", 1, (_, args) => collectBytes(ctx, args[0], "Uint8Array.from", proto, 0, args[1], args[2])],
    ["of", 0, (_, args) => wrap(Uint8Array.from(args, coerceToNumber))],
    ["fromBase64", 1, (_, args) => decode("fromBase64", args, (text) => Uint8Array.fromBase64(text))],
    ["fromHex", 1, (_, args) => decode("fromHex", args, (text) => Uint8Array.fromHex(text))],
  ])

  const self = (thisValue: Value, name: string) => receiver(Bytes, thisValue, `Uint8Array.prototype.${name}`)
  const optNumber = (value: Value): number | undefined => (value === undefined ? undefined : coerceToInteger(value))
  // Uint8Array cannot contain NaN, so non-number search values never match a byte.
  const search = (value: Value) => (typeof value === "number" ? value : NaN)
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
        return collectBytes(ctx, args[0], "Uint8Array.set", target, optNumber(args[1]) ?? 0)
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
      "sort",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "sort")
        // Without a comparator, typed arrays sort numerically rather than by string.
        if (args[0] === undefined) {
          target.bytes.sort()
          return target
        }
        return sortArray(ctx, target, args[0], "Uint8Array.sort")
      },
    ],
    ["indexOf", 1, (thisValue, args) => self(thisValue, "indexOf").bytes.indexOf(search(args[0]), optNumber(args[1]))],
    [
      "lastIndexOf",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "lastIndexOf").bytes
        return args.length < 2
          ? target.lastIndexOf(search(args[0]))
          : target.lastIndexOf(search(args[0]), optNumber(args[1]))
      },
    ],
    [
      "includes",
      1,
      (thisValue, args) => self(thisValue, "includes").bytes.includes(search(args[0]), optNumber(args[1])),
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
    ...iteratorMethods(builtins, self),
    // The callback methods are the prelude's.
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
        new TextDecoder("utf-8", { fatal: flag("fatal"), ignoreBOM: flag("ignoreBOM") }),
      )
    },
  })
}
