import { type HostFunction, sync, type SyncOptions } from "../interpreter/host.js"
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
import { type SafeObject, toProgram } from "../data.js"
import { Values } from "../values.js"

export const errorConstructors = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
])

export const compoundOperators = new Set(["+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>="])

const ErrorBrand: unique symbol = Symbol("codemode.error")

export const createErrorValue = (name: string, message: string): SafeObject => {
  const value = Object.assign(Object.create(null) as SafeObject, { name, message })
  Object.defineProperty(value, ErrorBrand, { value: name })
  return value
}

export const createAggregateErrorValue = (errors: Array<unknown>, message: string): SafeObject =>
  Object.assign(createErrorValue("AggregateError", message), { errors })

export const errorBrandName = (value: unknown): string | undefined =>
  value !== null && typeof value === "object"
    ? ((value as Record<PropertyKey, unknown>)[ErrorBrand] as string | undefined)
    : undefined

export const coerceToString = (value: unknown): string => {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (value instanceof Values.Date)
    return Number.isFinite(value.time) ? new Date(value.time).toISOString() : "Invalid Date"
  if (value instanceof Values.RegExp) return `/${value.regex.source}/${value.regex.flags}`
  if (value instanceof Values.Map) return "[object Map]"
  if (value instanceof Values.Set) return "[object Set]"
  if (value instanceof Values.URL) return value.url.href
  if (value instanceof Values.URLSearchParams) return value.params.toString()
  if (errorBrandName(value) !== undefined) {
    // Match Error.prototype.toString: "name: message", or just one when the other is empty.
    const error = value as { name?: unknown; message?: unknown }
    const name = typeof error.name === "string" ? error.name : "Error"
    const message = typeof error.message === "string" ? error.message : ""
    if (message === "") return name
    if (name === "") return message
    return `${name}: ${message}`
  }
  if (typeof value === "object") {
    return Array.isArray(value)
      ? value.map((item) => (item === null || item === undefined ? "" : coerceToString(item))).join(",")
      : "[object Object]"
  }
  return String(value)
}

export const coerceToNumber = (value: unknown): number => {
  if (value instanceof Values.Date) return value.time
  if (Values.isValue(value)) return Number.NaN
  // Arrays coerce through our own string coercion: host Number(array) joins with host
  // ToPrimitive, which throws on the null-prototype objects the interpreter produces.
  if (Array.isArray(value)) return Number(coerceToString(value))
  return value !== null && typeof value === "object" ? Number.NaN : Number(value)
}

type Coercion = "Number" | "String" | "Boolean" | "parseInt" | "parseFloat" | "isFinite" | "isNaN"

const coerce = (name: Coercion, args: Array<unknown>, node: AstNode): unknown => {
  // Native: Number() is 0 and String() is "", unlike their undefined-argument forms; the
  // other coercers match native through the undefined-argument path below.
  if (args.length === 0) {
    if (name === "Number") return 0
    if (name === "String") return ""
  }
  const raw = args[0]
  // Error values are plain SafeObjects; the toProgram path below would strip their brand.
  if (name === "String" && errorBrandName(raw) !== undefined) return coerceToString(raw)
  if (Values.isValue(raw)) {
    if (name === "Boolean") return true
    if (name === "Number") return coerceToNumber(raw)
    if (name === "String") return coerceToString(raw)
    if (name === "isFinite") return Number.isFinite(coerceToNumber(raw))
    if (name === "isNaN") return Number.isNaN(coerceToNumber(raw))
    if (name === "parseInt") return parseInt(coerceToString(raw))
    return parseFloat(coerceToString(raw))
  }
  const value = toProgram(raw, `${name} input`)
  if (name === "Number") return coerceToNumber(value)
  if (name === "Boolean") return Boolean(value)
  if (name === "isFinite") return Number.isFinite(coerceToNumber(value))
  if (name === "isNaN") return Number.isNaN(coerceToNumber(value))
  if (name === "parseInt") {
    const radix = args[1]
    if (radix !== undefined && typeof radix !== "number") {
      throw new InterpreterRuntimeError("parseInt expects a numeric radix.", node)
    }
    return parseInt(coerceToString(value), radix)
  }
  if (name === "parseFloat") return parseFloat(coerceToString(value))
  return coerceToString(value)
}

/** A global coercion function such as `Number` or `parseInt`. */
export const coercion = (name: Coercion, options: SyncOptions = {}): HostFunction =>
  sync(name, (args, node) => toProgram(coerce(name, args, node), `${name} result`), options)
