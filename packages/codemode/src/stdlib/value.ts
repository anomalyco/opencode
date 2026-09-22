import { fn } from "../interpreter/native.js"
import { coerceToNumber, coerceToString, type Native, type Value } from "../interpreter/objects.js"
import type { Interpreter } from "../interpreter/interpreter.js"

export const compoundOperators = new Set(["+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>="])

export type Coercion = "Number" | "String" | "Boolean" | "parseInt" | "parseFloat" | "isFinite" | "isNaN"

const coerce = <R>(ctx: Interpreter<R>, name: Coercion, args: Array<Value>): Value => {
  // Native: Number() is 0 and String() is "", unlike their undefined-argument forms; the
  // other coercers match native through the undefined-argument path below.
  if (args.length === 0) {
    if (name === "Number") return 0
    if (name === "String") return ""
  }
  const raw = args[0]
  if (name === "Number") return coerceToNumber(raw)
  if (name === "Boolean") return Boolean(raw)
  if (name === "isFinite") return Number.isFinite(coerceToNumber(raw))
  if (name === "isNaN") return Number.isNaN(coerceToNumber(raw))
  if (name === "parseInt") {
    return parseInt(coerceToString(raw), coerceToNumber(args[1]))
  }
  if (name === "parseFloat") return parseFloat(coerceToString(raw))
  return coerceToString(raw)
}

/** A global coercion function such as `Number` or `parseInt`. */
export const coercion = <R>(ctx: Interpreter<R>, name: Coercion, length = 1): Native<R> =>
  fn(ctx.builtins, name, length, (_, args) => coerce(ctx, name, args))
