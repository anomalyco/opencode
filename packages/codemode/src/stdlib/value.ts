import { fn } from "../interpreter/native.js"
import { coerceToNumber, coerceToString, type Native, type Value } from "../interpreter/objects.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { withPrimitives } from "../interpreter/callback.js"

export const compoundOperators = new Set(["+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>="])

export type Coercion = "Number" | "String" | "Boolean" | "parseInt" | "parseFloat" | "isFinite" | "isNaN"

export const coerce = <R>(ctx: Interpreter<R>, name: Coercion, args: Array<Value>) => {
  // Native: Number() is 0 and String() is "", unlike their undefined-argument forms; the
  // other coercers match native through the undefined-argument path below.
  if (args.length === 0) {
    if (name === "Number") return 0
    if (name === "String") return ""
  }
  const raw = args[0]
  if (name === "Boolean") return Boolean(raw)
  if (name === "parseInt") {
    return withPrimitives(ctx, ["string", "number"], [raw, args[1]], ([text, radix]) =>
      parseInt(coerceToString(text), coerceToNumber(radix)),
    )
  }
  return withPrimitives(ctx, name === "String" || name === "parseFloat" ? "string" : "number", [raw], ([value]) => {
    if (name === "Number") return coerceToNumber(value)
    if (name === "isFinite") return Number.isFinite(coerceToNumber(value))
    if (name === "isNaN") return Number.isNaN(coerceToNumber(value))
    if (name === "parseFloat") return parseFloat(coerceToString(value))
    return coerceToString(value)
  })
}

/** A global coercion function such as `Number` or `parseInt`. */
export const coercion = <R>(ctx: Interpreter<R>, name: Coercion, length = 1): Native<R> =>
  fn(ctx.builtins, name, length, (_, args) => coerce(ctx, name, args))
