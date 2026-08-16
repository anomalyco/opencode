export const errorConstructors = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
])

export const valueConstructors = new Set(["Date", "RegExp", "Map", "Set", "URL", "URLSearchParams"])

export const compoundOperators = new Set(["+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>="])

const ErrorBrand: unique symbol = Symbol("codemode.error")

export const createErrorValue = (name: string, message: string): SafeObject => {
  const value = Object.assign(Object.create(null) as SafeObject, { name, message })
  Object.defineProperty(value, ErrorBrand, { value: name })
  return value
}

export const errorBrandName = (value: unknown): string | undefined =>
  value !== null && typeof value === "object"
    ? ((value as Record<PropertyKey, unknown>)[ErrorBrand] as string | undefined)
    : undefined

export const boundedData = (value: unknown, label: string): unknown => copyIn(value, label, true)

export const coerceToString = (value: unknown): string => {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (value instanceof SandboxDate)
    return Number.isFinite(value.time) ? new Date(value.time).toISOString() : "Invalid Date"
  if (value instanceof SandboxRegExp) return `/${value.regex.source}/${value.regex.flags}`
  if (value instanceof SandboxMap) return "[object Map]"
  if (value instanceof SandboxSet) return "[object Set]"
  if (value instanceof SandboxURL) return value.url.href
  if (value instanceof SandboxURLSearchParams) return value.params.toString()
  if (typeof value === "object") {
    return Array.isArray(value)
      ? value.map((item) => (item === null || item === undefined ? "" : coerceToString(item))).join(",")
      : "[object Object]"
  }
  return String(value)
}

export const coerceToNumber = (value: unknown): number => {
  if (value instanceof SandboxDate) return value.time
  if (isSandboxValue(value)) return Number.NaN
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Number.NaN : Number(value)
}

export const invokeCoercion = (ref: CoercionFunction, args: Array<unknown>, node: AstNode): unknown => {
  const raw = args[0]
  if (isSandboxValue(raw)) {
    if (ref.name === "Boolean") return true
    if (ref.name === "Number") return coerceToNumber(raw)
    if (ref.name === "String") return coerceToString(raw)
    if (ref.name === "parseInt") return parseInt(coerceToString(raw))
    return parseFloat(coerceToString(raw))
  }
  const value = boundedData(args[0], `${ref.name} input`)
  if (ref.name === "Number") return coerceToNumber(value)
  if (ref.name === "Boolean") return Boolean(value)
  if (ref.name === "parseInt") {
    const radix = args[1]
    if (radix !== undefined && typeof radix !== "number") {
      throw new InterpreterRuntimeError("parseInt expects a numeric radix.", node)
    }
    return parseInt(coerceToString(value), radix)
  }
  if (ref.name === "parseFloat") return parseFloat(coerceToString(value))
  return coerceToString(value)
}
import { type AstNode, CoercionFunction, InterpreterRuntimeError } from "../interpreter/model.js"
import { copyIn, type SafeObject } from "../tool-runtime.js"
import {
  isSandboxValue,
  SandboxDate,
  SandboxMap,
  SandboxRegExp,
  SandboxSet,
  SandboxURL,
  SandboxURLSearchParams,
} from "../values.js"
