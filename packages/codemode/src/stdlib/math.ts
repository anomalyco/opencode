export const mathConstants = new Set(["PI", "E", "LN2", "LN10", "LOG2E", "LOG10E", "SQRT2", "SQRT1_2"])

export const mathMethods = new Set([
  "random",
  "max",
  "min",
  "abs",
  "acos",
  "acosh",
  "asin",
  "asinh",
  "atan",
  "atan2",
  "atanh",
  "floor",
  "ceil",
  "round",
  "trunc",
  "sign",
  "sqrt",
  "cbrt",
  "pow",
  "hypot",
  "cos",
  "cosh",
  "sin",
  "sinh",
  "tan",
  "tanh",
  "log",
  "log2",
  "log10",
  "log1p",
  "exp",
  "expm1",
  "f16round",
  "fround",
  "clz32",
  "imul",
])

export const invokeMathMethod = (name: string, args: Array<unknown>, node: AstNode): number => {
  if (!mathMethods.has(name)) throw new InterpreterRuntimeError(`Math.${name} is not available in CodeMode.`, node)
  if (name === "random") return Math.random()
  // Validate only the arguments the method consumes; like JS, extras are ignored
  // (so built-ins work as callbacks receiving (element, index, array)).
  const num = (index: number): number => {
    if (index >= args.length) return Number.NaN
    const arg = args[index]
    if (typeof arg !== "number") throw new InterpreterRuntimeError(`Math.${name} expects number arguments.`, node)
    return arg
  }
  const nums = () =>
    args.map((arg) => {
      if (typeof arg !== "number") throw new InterpreterRuntimeError(`Math.${name} expects number arguments.`, node)
      return arg
    })
  const a = num(0)
  const b = () => num(1)
  switch (name) {
    case "max":
      return Math.max(...nums())
    case "min":
      return Math.min(...nums())
    case "abs":
      return Math.abs(a)
    case "acos":
      return Math.acos(a)
    case "acosh":
      return Math.acosh(a)
    case "asin":
      return Math.asin(a)
    case "asinh":
      return Math.asinh(a)
    case "atan":
      return Math.atan(a)
    case "atan2":
      return Math.atan2(a, b())
    case "atanh":
      return Math.atanh(a)
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
      return Math.pow(a, b())
    case "hypot":
      return Math.hypot(...nums())
    case "cos":
      return Math.cos(a)
    case "cosh":
      return Math.cosh(a)
    case "sin":
      return Math.sin(a)
    case "sinh":
      return Math.sinh(a)
    case "tan":
      return Math.tan(a)
    case "tanh":
      return Math.tanh(a)
    case "log":
      return Math.log(a)
    case "log2":
      return Math.log2(a)
    case "log10":
      return Math.log10(a)
    case "log1p":
      return Math.log1p(a)
    case "exp":
      return Math.exp(a)
    case "expm1":
      return Math.expm1(a)
    case "f16round":
      return Math.f16round(a)
    case "fround":
      return Math.fround(a)
    case "clz32":
      return Math.clz32(a)
    case "imul":
      return Math.imul(a, b())
  }
  throw new InterpreterRuntimeError(`Math.${name} is not available in CodeMode.`, node)
}
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
