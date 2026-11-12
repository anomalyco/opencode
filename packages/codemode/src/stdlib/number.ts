import { constructor, constants, type Method, methods } from "../runtime/native.js"
import { coerceToNumber, type Value } from "../runtime/objects.js"
import { typeError } from "../runtime/model.js"
import type { Interpreter } from "../runtime/interpreter.js"
import { withPrimitives } from "../runtime/callback.js"
import { coerce } from "./value.js"

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
    ["toLocaleString", 0, (thisValue) => self(thisValue, "toLocaleString").toLocaleString("en-US")],
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
