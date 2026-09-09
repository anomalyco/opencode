export * as Data from "./data.js"

import type { DiagnosticKind } from "./codemode.js"
import { Values } from "./values.js"

/** A null-prototype object owned by the program. */
export type SafeObject = Record<string, unknown>

const MAX_VALUE_DEPTH = 32

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
 * Brings a host-produced runtime value into the program: runtime values pass through, their host
 * counterparts (Date, RegExp, Map, Set, URL, URLSearchParams) are wrapped, and objects become
 * null-prototype copies. Arrays keep extra enumerable properties such as `index` and `groups`.
 */
export const toProgram = (value: unknown, label: string): unknown => copy(value, label, "program", 0, new Set())

/**
 * Brings host data into the program: Date and URL become strings, other host collections become
 * empty objects, and objects become null-prototype copies. Used for tool results and parsed JSON.
 */
export const fromData = (value: unknown, label: string): unknown => copy(value, label, "data", 0, new Set())

/**
 * Takes a program value out as plain JSON: runtime values serialize like `JSON.stringify` would,
 * non-finite numbers become null, and array holes become null. `undefined` object properties are
 * dropped ("json") or become null ("result", for program results where the consumer must never see
 * undefined); a bare `undefined` follows the same rule.
 */
export const toData = (value: unknown, label: string, undefinedAs: "json" | "result" = "json"): unknown =>
  copy(value, label, undefinedAs, 0, new Set())

// "program" and "data" build program-owned null-prototype objects; "json" and "result" build
// ordinary objects for the host.
type Mode = "program" | "data" | "json" | "result"

const copy = (value: unknown, label: string, mode: Mode, depth: number, seen: Set<object>): unknown => {
  if (depth > MAX_VALUE_DEPTH) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
  }
  if (value === undefined) return mode === "result" ? null : undefined
  if (typeof value === "number") return (mode === "json" || mode === "result") && !Number.isFinite(value) ? null : value
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value !== "object") {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain data only.`)
  }
  if (value instanceof Values.Promise) {
    throw new ToolRuntimeError(
      "InvalidDataValue",
      `${label} contains an un-awaited Promise; await tool calls (e.g. \`const result = await tools.ns.tool(...)\`) before using their results.`,
    )
  }

  if (mode === "program") {
    if (Values.isValue(value)) return value
    if (value instanceof Date) return new Values.Date(value.getTime())
    if (value instanceof RegExp) return new Values.RegExp(value.source, value.flags)
    if (value instanceof Map) {
      const wrapped = new Values.Map()
      for (const [key, item] of value.entries()) {
        wrapped.map.set(copy(key, label, mode, depth + 1, seen), copy(item, label, mode, depth + 1, seen))
      }
      return wrapped
    }
    if (value instanceof Set) {
      const wrapped = new Values.Set()
      for (const item of value.values()) wrapped.set.add(copy(item, label, mode, depth + 1, seen))
      return wrapped
    }
    if (value instanceof URL) return new Values.URL(new URL(value.href))
    if (value instanceof URLSearchParams) return new Values.URLSearchParams(new URLSearchParams(value))
  }

  const plain = mode === "program" || mode === "data"
  if (value instanceof Values.Date) return Number.isFinite(value.time) ? new Date(value.time).toISOString() : null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
  if (value instanceof Values.URL) return value.url.href
  if (value instanceof URL) return value.href
  // Remaining runtime values and their host counterparts serialize as empty objects, like JSON.stringify.
  if (
    Values.isValue(value) ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof URLSearchParams
  ) {
    return plain ? (Object.create(null) as SafeObject) : {}
  }

  if (seen.has(value)) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} contains a circular value.`)
  }
  seen.add(value)

  if (Array.isArray(value)) {
    // Host output densifies holes to null like JSON; program copies keep them.
    const copied = plain
      ? value.map((item) => copy(item, label, mode, depth + 1, seen))
      : Array.from(value, (item) => copy(item, label, mode, depth + 1, seen) ?? null)
    if (mode === "program") {
      for (const [key, item] of Object.entries(value)) {
        if (Object.hasOwn(copied, key)) continue
        define(copied, key, copy(item, label, mode, depth + 1, seen))
      }
    }
    seen.delete(value)
    return copied
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain plain objects only.`)
  }

  const copied: SafeObject = plain ? (Object.create(null) as SafeObject) : {}
  for (const [key, item] of Object.entries(value)) {
    const next = copy(item, label, mode, depth + 1, seen)
    if (next === undefined && mode === "json") continue
    define(copied, key, next)
  }
  seen.delete(value)
  return copied
}

// Own data property regardless of the target's prototype, so a "__proto__" key on a host object or
// array never reaches the Object.prototype setter.
const define = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}
