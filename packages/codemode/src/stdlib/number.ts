import { toProgram } from "../data.js"
import { sync } from "../interpreter/host.js"
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
import { coercion, coerceToString } from "./value.js"

export const numberMethods = new Set(["toFixed", "toPrecision", "toExponential", "toString", "valueOf"])

export const invokeNumberMethod = (value: number, name: string, args: Array<unknown>, node: AstNode): unknown => {
  const optNum = (index: number): number | undefined => {
    const arg = args[index]
    if (arg === undefined) return undefined
    if (typeof arg !== "number") throw new InterpreterRuntimeError(`Number.${name} expects a number argument.`, node)
    return arg
  }
  let result: unknown
  switch (name) {
    case "toFixed":
      result = value.toFixed(optNum(0))
      break
    case "toExponential":
      result = value.toExponential(optNum(0))
      break
    case "toPrecision": {
      const digits = optNum(0)
      result = digits === undefined ? value.toString() : value.toPrecision(digits)
      break
    }
    case "toString": {
      const radix = optNum(0)
      if (radix !== undefined && (radix < 2 || radix > 36)) {
        throw new InterpreterRuntimeError("Number.toString radix must be between 2 and 36.", node)
      }
      result = value.toString(radix)
      break
    }
    case "valueOf":
      result = value
      break
    default:
      throw new InterpreterRuntimeError(`Number method '${name}' is not available.`, node)
  }
  return toProgram(result, `Number.${name} result`)
}

const parseIntStatic = sync("Number.parseInt", (args, node) => {
  const radix = args[1]
  if (radix !== undefined && typeof radix !== "number") {
    throw new InterpreterRuntimeError("Number.parseInt expects a numeric radix.", node)
  }
  return parseInt(coerceToString(args[0]), radix)
})

export const numberGlobal = coercion("Number", {
  instanceOf: () => false,
  members: {
    MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
    MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
    MAX_VALUE: Number.MAX_VALUE,
    MIN_VALUE: Number.MIN_VALUE,
    EPSILON: Number.EPSILON,
    NaN: Number.NaN,
    POSITIVE_INFINITY: Number.POSITIVE_INFINITY,
    NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY,
    isInteger: sync("Number.isInteger", (args) => Number.isInteger(args[0])),
    isFinite: sync("Number.isFinite", (args) => Number.isFinite(args[0])),
    isNaN: sync("Number.isNaN", (args) => Number.isNaN(args[0])),
    isSafeInteger: sync("Number.isSafeInteger", (args) => Number.isSafeInteger(args[0])),
    parseInt: parseIntStatic,
    parseFloat: sync("Number.parseFloat", (args) => parseFloat(coerceToString(args[0]))),
  },
})
