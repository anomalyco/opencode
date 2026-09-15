import { fn } from "../interpreter/native.js"
import { typeError } from "../interpreter/model.js"
import {
  get,
  isWrapper,
  type Native,
  Arr,
  Bytes,
  DateObj,
  ErrorObj,
  MapObj,
  RegExpObj,
  SetObj,
  URLObj,
  URLSearchParamsObj,
} from "../interpreter/objects.js"
import type { Interpreter } from "../interpreter/interpreter.js"

export const compoundOperators = new Set(["+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>="])

/** The built-in string form of a value, without consulting program-defined `toString` methods. */
export const coerceToString = (value: unknown): string => {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (value instanceof DateObj) return Number.isFinite(value.time) ? new Date(value.time).toISOString() : "Invalid Date"
  if (value instanceof RegExpObj) return `/${value.regex.source}/${value.regex.flags}`
  if (value instanceof MapObj) return "[object Map]"
  if (value instanceof SetObj) return "[object Set]"
  if (value instanceof URLObj) return value.url.href
  if (value instanceof URLSearchParamsObj) return value.params.toString()
  if (value instanceof Bytes) return value.bytes.join(",")
  if (value instanceof ErrorObj) {
    // Match Error.prototype.toString: "name: message", or just one when the other is empty.
    const name = get(value, "name")
    const message = get(value, "message")
    const shownName = typeof name === "string" ? name : "Error"
    const shownMessage = typeof message === "string" ? message : ""
    if (shownMessage === "") return shownName
    if (shownName === "") return shownMessage
    return `${shownName}: ${shownMessage}`
  }
  if (value instanceof Arr) {
    return value.items.map((item) => (item === null || item === undefined ? "" : coerceToString(item))).join(",")
  }
  if (typeof value === "object") return "[object Object]"
  return String(value)
}

export const coerceToNumber = (value: unknown): number => {
  if (value instanceof DateObj) return value.time
  if (value instanceof Bytes) return Number(coerceToString(value))
  if (isWrapper(value)) return Number.NaN
  if (value instanceof Arr) return Number(coerceToString(value))
  return value !== null && typeof value === "object" ? Number.NaN : Number(value)
}

export type Coercion = "Number" | "String" | "Boolean" | "parseInt" | "parseFloat" | "isFinite" | "isNaN"

const coerce = <R>(ctx: Interpreter<R>, name: Coercion, args: Array<unknown>): unknown => {
  // Native: Number() is 0 and String() is "", unlike their undefined-argument forms; the
  // other coercers match native through the undefined-argument path below.
  if (args.length === 0) {
    if (name === "Number") return 0
    if (name === "String") return ""
  }
  const raw = args[0]
  if (isWrapper(raw)) {
    if (name === "Boolean") return true
    if (name === "Number") return coerceToNumber(raw)
    if (name === "String") return coerceToString(raw)
    if (name === "isFinite") return Number.isFinite(coerceToNumber(raw))
    if (name === "isNaN") return Number.isNaN(coerceToNumber(raw))
    if (name === "parseInt") return parseInt(coerceToString(raw))
    return parseFloat(coerceToString(raw))
  }
  if (name === "Number") return coerceToNumber(raw)
  if (name === "Boolean") return Boolean(raw)
  if (name === "isFinite") return Number.isFinite(coerceToNumber(raw))
  if (name === "isNaN") return Number.isNaN(coerceToNumber(raw))
  if (name === "parseInt") {
    const radix = args[1]
    if (radix !== undefined && typeof radix !== "number") {
      throw typeError("parseInt expects a numeric radix.")
    }
    return parseInt(coerceToString(raw), radix)
  }
  if (name === "parseFloat") return parseFloat(coerceToString(raw))
  return coerceToString(raw)
}

/** A global coercion function such as `Number` or `parseInt`. */
export const coercion = <R>(ctx: Interpreter<R>, name: Coercion, length = 1): Native<R> =>
  fn(ctx.builtins, name, length, (_, args) => coerce(ctx, name, args))
