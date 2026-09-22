import { constructor, constants, methods } from "../interpreter/native.js"
import { coerceToString, type Value } from "../interpreter/objects.js"
import { rangeError, typeError } from "../interpreter/model.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { coercion } from "./value.js"

export const numberGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const number = constructor<R>(builtins, builtins.Number, {
    name: "Number",
    length: 1,
    call: coercion(ctx, "Number").call,
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
    [
      "parseInt",
      2,
      (_, args) => {
        const radix = args[1]
        if (radix !== undefined && typeof radix !== "number") {
          throw typeError("Number.parseInt expects a numeric radix.")
        }
        return parseInt(coerceToString(args[0]), radix)
      },
    ],
    ["parseFloat", 1, (_, args) => parseFloat(coerceToString(args[0]))],
  ])

  const self = (thisValue: Value, name: string): number => {
    if (typeof thisValue === "number") return thisValue
    throw typeError(`Number.prototype.${name} requires that 'this' be a Number.`)
  }
  const optNum = (name: string, arg: Value): number | undefined => {
    if (arg === undefined) return undefined
    if (typeof arg !== "number") throw typeError(`Number.${name} expects a number argument.`)
    return arg
  }
  methods(builtins, builtins.Number, [
    ["toFixed", 1, (thisValue, args) => self(thisValue, "toFixed").toFixed(optNum("toFixed", args[0]))],
    ["toLocaleString", 0, (thisValue) => self(thisValue, "toLocaleString").toLocaleString("en-US")],
    [
      "toExponential",
      1,
      (thisValue, args) => self(thisValue, "toExponential").toExponential(optNum("toExponential", args[0])),
    ],
    [
      "toPrecision",
      1,
      (thisValue, args) => {
        const value = self(thisValue, "toPrecision")
        const digits = optNum("toPrecision", args[0])
        return digits === undefined ? value.toString() : value.toPrecision(digits)
      },
    ],
    [
      "toString",
      1,
      (thisValue, args) => {
        const value = self(thisValue, "toString")
        const radix = optNum("toString", args[0])
        if (radix !== undefined && (radix < 2 || radix > 36)) {
          throw rangeError("Number.toString radix must be between 2 and 36.")
        }
        return value.toString(radix)
      },
    ],
    ["valueOf", 0, (thisValue) => self(thisValue, "valueOf")],
  ])
  return number
}

export const booleanGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const boolean = constructor<R>(builtins, builtins.Boolean, {
    name: "Boolean",
    length: 1,
    call: coercion(ctx, "Boolean").call,
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
