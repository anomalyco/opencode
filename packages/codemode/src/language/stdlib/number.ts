import { constructor, constants, type Method, methods } from "../runtime/native.js"
import { coerceToInteger, coerceToNumber, get, type NativeResult, Obj, type Value } from "../runtime/objects.js"
import { typeError } from "../runtime/model.js"
import type { Interpreter } from "../runtime/interpreter.js"
import { withPrimitives, withReads } from "../runtime/callback.js"
import { checkArrayLength } from "../runtime/limits.js"
import { coerce } from "./value.js"

// Intl.NumberFormat's options, each with the hint its value converts by.
const numberFormatOptions = [
  ...[
    "localeMatcher",
    "numberingSystem",
    "style",
    "currency",
    "currencyDisplay",
    "currencySign",
    "unit",
    "unitDisplay",
    "notation",
    "compactDisplay",
    "useGrouping",
    "signDisplay",
    "roundingMode",
    "roundingPriority",
    "trailingZeroDisplay",
  ].map((name) => [name, "string"] as const),
  ...[
    "minimumIntegerDigits",
    "minimumFractionDigits",
    "maximumFractionDigits",
    "minimumSignificantDigits",
    "maximumSignificantDigits",
    "roundingIncrement",
  ].map((name) => [name, "number"] as const),
]

// The host's Intl.NumberFormat formats; with no locales it stays en-US so output does not depend on the host.
const toLocaleString = (value: number, locales: Value, options: Value): NativeResult => {
  // The host's own message for null quotes host source, so this one is thrown here.
  if (locales === null || options === null) throw typeError("Cannot convert undefined or null to object.")
  return withReads(() => {
    const length = locales instanceof Obj ? Math.max(0, coerceToInteger(get(locales, "length"))) : 0
    checkArrayLength(length)
    const list = Array.from({ length }, (_, index) => get(locales as Obj, index))
    const read = options instanceof Obj ? numberFormatOptions : []
    return withPrimitives(
      [...list.map(() => "string" as const), ...read.map(([, hint]) => hint)],
      [...list, ...read.map(([name]) => get(options as Obj, name))],
      (primitives) => {
        // Intl reads a primitive other than a string as an empty list. The host canonicalizes the tags itself; doing it
        // here too would canonicalize twice, which breaks some valid tags.
        const tags = locales instanceof Obj ? primitives.slice(0, length) : typeof locales === "string" ? [locales] : []
        return value.toLocaleString(
          (tags.length === 0 ? "en-US" : tags) as string | Array<string>,
          (options instanceof Obj
            ? Object.fromEntries(read.map(([name], index) => [name, primitives[length + index]]))
            : options) as Intl.NumberFormatOptions,
        )
      },
    )
  })
}

export const numberGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const number = constructor(builtins, builtins.Number, {
    name: "Number",
    length: 1,
    call: (_, args) => coerce(ctx, "Number", args),
  })
  constants(number, {
    MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
    MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
    MAX_VALUE: Number.MAX_VALUE,
    MIN_VALUE: Number.MIN_VALUE,
    EPSILON: Number.EPSILON,
    NaN: Number.NaN,
    POSITIVE_INFINITY: Number.POSITIVE_INFINITY,
    NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY,
  })
  methods(builtins, number, [
    ["isInteger", 1, (_, args) => Number.isInteger(args[0])],
    ["isFinite", 1, (_, args) => Number.isFinite(args[0])],
    ["isNaN", 1, (_, args) => Number.isNaN(args[0])],
    ["isSafeInteger", 1, (_, args) => Number.isSafeInteger(args[0])],
    ["parseInt", 2, (_, args) => coerce(ctx, "parseInt", args)],
    ["parseFloat", 1, (_, args) => coerce(ctx, "parseFloat", args)],
  ])

  const self = (thisValue: Value, name: string): number => {
    if (typeof thisValue === "number") return thisValue
    throw typeError(`Number.prototype.${name} requires that 'this' be a Number.`)
  }
  // The receiver is checked first, then the one argument converts through ToPrimitive with the number hint.
  const formatting = (name: string, op: (value: number, digits: number | undefined) => string): Method => [
    name,
    1,
    (thisValue, args) => {
      const value = self(thisValue, name)
      return withPrimitives("number", [args[0]], ([digits]) =>
        op(value, digits === undefined ? undefined : coerceToNumber(digits)),
      )
    },
  ]
  methods(builtins, builtins.Number, [
    formatting("toFixed", (value, digits) => value.toFixed(digits)),
    ["toLocaleString", 0, (thisValue, args) => toLocaleString(self(thisValue, "toLocaleString"), args[0], args[1])],
    formatting("toExponential", (value, digits) => value.toExponential(digits)),
    formatting("toPrecision", (value, digits) => (digits === undefined ? value.toString() : value.toPrecision(digits))),
    formatting("toString", (value, radix) => value.toString(radix)),
    ["valueOf", 0, (thisValue) => self(thisValue, "valueOf")],
  ])
  return number
}

export const booleanGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const boolean = constructor(builtins, builtins.Boolean, {
    name: "Boolean",
    length: 1,
    call: (_, args) => coerce(ctx, "Boolean", args),
  })
  const self = (thisValue: Value, name: string): boolean => {
    if (typeof thisValue === "boolean") return thisValue
    throw typeError(`Boolean.prototype.${name} requires that 'this' be a Boolean.`)
  }
  methods(builtins, builtins.Boolean, [
    ["toString", 0, (thisValue) => String(self(thisValue, "toString"))],
    ["valueOf", 0, (thisValue) => self(thisValue, "valueOf")],
  ])
  return boolean
}
