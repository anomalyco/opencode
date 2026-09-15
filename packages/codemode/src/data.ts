export * as Data from "./data.js"

import type { DiagnosticKind } from "./codemode.js"
import type { Builtins } from "./interpreter/intrinsics.js"
import {
  Callable,
  define,
  entries,
  get,
  isWrapper,
  parseArrayIndex,
  Arr,
  Bytes,
  DateObj,
  ErrorObj,
  GeneratorObj,
  Handle,
  MapObj,
  Obj,
  PromiseObj,
  RegExpObj,
  SetObj,
  URLObj,
  URLSearchParamsObj,
} from "./interpreter/objects.js"

export const MAX_VALUE_DEPTH = 32

export class ToolRuntimeError extends Error {
  constructor(
    readonly kind: Extract<
      DiagnosticKind,
      "UnknownTool" | "InvalidToolInput" | "InvalidToolOutput" | "InvalidDataValue" | "ToolCallLimitExceeded"
    >,
    message: string,
    readonly suggestions: ReadonlyArray<string> = [],
  ) {
    super(message)
    this.name = "ToolRuntimeError"
  }
}

/**
 * Brings a host-produced value into the program: program values pass through, host Date, RegExp,
 * Map, Set, URL, and URLSearchParams become their built-in wrappers, and host objects and arrays
 * are copied.
 */
export const toProgram = (builtins: Builtins, value: unknown, label: string): unknown =>
  copy(value, label, "program", 0, new Set(), builtins)

/**
 * Brings host data into the program: Date and URL become strings, other host collections become
 * empty objects, and objects become program copies. Used for tool results and parsed JSON.
 */
export const fromData = (builtins: Builtins, value: unknown, label: string): unknown =>
  copy(value, label, "data", 0, new Set(), builtins)

/**
 * Takes a program value out as plain JSON: runtime values serialize like `JSON.stringify` would,
 * non-finite numbers become null, and array holes become null. `undefined` object properties are
 * dropped ("json") or become null ("result", for program results where the consumer must never see
 * undefined); a bare `undefined` follows the same rule.
 *
 * At the host boundary (tool arguments and program results) `__proto__` keys are dropped and values
 * `JSON.stringify` would flatten to `{}` cross in a useful form instead: a Set as an array, a RegExp
 * and URLSearchParams as their strings. `JSON.stringify` itself passes `boundary: false` to keep JS
 * behavior.
 */
export const toData = (
  value: unknown,
  label: string,
  undefinedAs: "json" | "result" = "json",
  boundary = true,
): unknown => copy(value, label, undefinedAs, 0, new Set(), undefined, boundary)

// "program" and "data" build program objects; "json" and "result" build ordinary objects for the ctx.
type Mode = "program" | "data" | "json" | "result"

const copy = (
  value: unknown,
  label: string,
  mode: Mode,
  depth: number,
  seen: Set<object>,
  builtins?: Builtins,
  boundary = true,
): unknown => {
  const next = (item: unknown) => copy(item, label, mode, depth + 1, seen, builtins, boundary)
  if (depth > MAX_VALUE_DEPTH) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
  }
  if (value === undefined) return mode === "result" ? null : undefined
  if (typeof value === "number") return (mode === "json" || mode === "result") && !Number.isFinite(value) ? null : value
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value !== "object") {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain data only.`)
  }
  if (value instanceof PromiseObj) {
    throw new ToolRuntimeError(
      "InvalidDataValue",
      `${label} contains an un-awaited Promise; await tool calls (e.g. \`const result = await tools.ns.tool(...)\`) before using their results.`,
    )
  }
  if ((value instanceof Callable || value instanceof GeneratorObj) && mode !== "program") {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain data only.`)
  }
  if (value instanceof Handle && mode !== "program") {
    throw new ToolRuntimeError(
      "InvalidDataValue",
      `${label} contains a ${value.instance.constructor.name}, which only extension functions accept.`,
    )
  }
  // Host-produced input never holds program objects; one arriving here would come back as a host object.
  if (value instanceof Obj && mode === "data") {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must be host data, not a program value.`)
  }

  if (builtins !== undefined && mode === "program") {
    if (value instanceof Obj) return value
    if (value instanceof Date) return new DateObj(builtins.Date, value.getTime())
    if (value instanceof RegExp) return new RegExpObj(builtins.RegExp, value.source, value.flags)
    if (value instanceof Map) {
      const wrapped = new MapObj(builtins.Map)
      for (const [key, item] of value.entries()) wrapped.map.set(next(key), next(item))
      return wrapped
    }
    if (value instanceof Set) {
      const wrapped = new SetObj(builtins.Set)
      for (const item of value.values()) wrapped.set.add(next(item))
      return wrapped
    }
    if (value instanceof URL) return new URLObj(builtins.URL, builtins.URLSearchParams, new URL(value.href))
    if (value instanceof URLSearchParams)
      return new URLSearchParamsObj(builtins.URLSearchParams, new URLSearchParams(value))
  }

  if (value instanceof DateObj) return Number.isFinite(value.time) ? new Date(value.time).toISOString() : null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
  if (value instanceof URLObj) return value.url.href
  if (value instanceof URL) return value.href
  if (value instanceof Bytes) {
    if (boundary) {
      throw new ToolRuntimeError(
        "InvalidDataValue",
        `${label} contains a Uint8Array; pass text instead, e.g. \`new TextDecoder().decode(bytes)\` or \`bytes.toBase64()\`.`,
      )
    }
    return Object.fromEntries(value.bytes.entries())
  }
  if (boundary && builtins === undefined) {
    if (value instanceof RegExpObj) return String(value.regex)
    if (value instanceof URLSearchParamsObj) return value.params.toString()
    if (value instanceof SetObj) {
      if (seen.has(value)) throw new ToolRuntimeError("InvalidDataValue", `${label} contains a circular value.`)
      seen.add(value)
      const copied = Array.from(value.set, (item) => next(item) ?? null)
      seen.delete(value)
      return copied
    }
  }
  // Remaining wrappers and their host counterparts serialize as empty objects, like JSON.stringify.
  if (
    isWrapper(value) ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof URLSearchParams
  ) {
    return builtins !== undefined ? new Obj(builtins.Object) : {}
  }

  if (seen.has(value)) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} contains a circular value.`)
  }
  seen.add(value)

  if (value instanceof Arr) {
    const copied = Array.from(value.items, (item) => next(item) ?? null)
    seen.delete(value)
    return copied
  }
  if (value instanceof Obj) {
    const copied: Record<string, unknown> = {}
    // Errors serialize as { name, message, ...own }: both may be inherited, and neither is enumerable in JS.
    if (value instanceof ErrorObj) {
      defineHost(copied, "name", next(get(value, "name")))
      defineHost(copied, "message", next(get(value, "message")))
    }
    for (const [key, item] of entries(value)) {
      if (boundary && key === "__proto__") continue
      const copiedItem = next(item)
      if (copiedItem === undefined && mode === "json") continue
      defineHost(copied, key, copiedItem)
    }
    seen.delete(value)
    return copied
  }

  if (Array.isArray(value)) {
    if (builtins !== undefined) {
      const copied = new Arr(builtins.Array, value.map(next))
      for (const [key, item] of Object.entries(value)) {
        if (parseArrayIndex(key) === undefined) define(copied, key, next(item))
      }
      seen.delete(value)
      return copied
    }
    const copied = Array.from(value, (item) => next(item) ?? null)
    seen.delete(value)
    return copied
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain plain objects only.`)
  }

  if (builtins !== undefined) {
    const copied = new Obj(builtins.Object)
    for (const [key, item] of Object.entries(value)) define(copied, key, next(item))
    seen.delete(value)
    return copied
  }
  const copied: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (boundary && key === "__proto__") continue
    const copiedItem = next(item)
    if (copiedItem === undefined && mode === "json") continue
    defineHost(copied, key, copiedItem)
  }
  seen.delete(value)
  return copied
}

// Own data property regardless of the target's prototype, so a "__proto__" key on a host object
// never reaches the Object.prototype setter.
const defineHost = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}
