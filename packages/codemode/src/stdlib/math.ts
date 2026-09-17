export const mathConstants = new Set(["PI", "E", "LN2", "LN10", "LOG2E", "LOG10E", "SQRT2", "SQRT1_2"])

export const mathMethods = new Set([
  "max",
  "min",
  "abs",
  "floor",
  "ceil",
  "round",
  "trunc",
  "sign",
  "sqrt",
  "cbrt",
  "pow",
  "hypot",
  "log",
  "log2",
  "log10",
  "exp",
])

export const invokeMathMethod = (name: string, args: Array<unknown>, node: AstNode): number => {
  if (!mathMethods.has(name)) throw new InterpreterRuntimeError(`Math.${name} is not available in CodeMode.`, node)
  const nums = args.map((arg) => {
    if (typeof arg !== "number") throw new InterpreterRuntimeError(`Math.${name} expects number arguments.`, node)
    return arg
  })
  const [a = Number.NaN, b = Number.NaN] = nums
  switch (name) {
    case "max":
      return Math.max(...nums)
    case "min":
      return Math.min(...nums)
    case "abs":
      return Math.abs(a)
    case "floor":
      return Math.floor(a)
    case "ceil":
      return Math.ceil(a)
    case "round":
      return Math.round(a)
    case "trunc":
      return Math.trunc(a)
    case "sign":
      return Math.sign(a)
    case "sqrt":
      return Math.sqrt(a)
    case "cbrt":
      return Math.cbrt(a)
    case "pow":
      return Math.pow(a, b)
    case "hypot":
      return Math.hypot(...nums)
    case "log":
      return Math.log(a)
    case "log2":
      return Math.log2(a)
    case "log10":
      return Math.log10(a)
    case "exp":
      return Math.exp(a)
  }
  throw new InterpreterRuntimeError(`Math.${name} is not available in CodeMode.`, node)
}
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
