import { define, type SafeObject } from "../data.js"
import { HostNamespace, sync } from "../interpreter/host.js"
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
import { describeValue, isRuntimeReference } from "../interpreter/references.js"
import { Values } from "../values.js"
import { coerceToString, createErrorValue, errorBrandName } from "./value.js"

// WebIDL DOMString conversion: a missing argument is a TypeError, anything else stringifies.
const base64 = (name: "atob" | "btoa") =>
  sync(name, (args, node) => {
    if (args.length === 0) {
      throw new InterpreterRuntimeError(`${name} requires 1 argument, but only 0 were provided.`, node).as("TypeError")
    }
    const input = coerceToString(args[0])
    try {
      return name === "atob" ? atob(input) : btoa(input)
    } catch {
      throw new InterpreterRuntimeError("The string contains invalid characters.", node).as("InvalidCharacterError")
    }
  })

export const atobGlobal = base64("atob")
export const btoaGlobal = base64("btoa")

export const cryptoGlobal = new HostNamespace("crypto", {
  randomUUID: sync("crypto.randomUUID", () => crypto.randomUUID()),
})

// HTML structured clone over the data model: wrappers are copied, shared references stay shared within
// one clone, Errors keep only name, message, and cause, and RegExp lastIndex resets like the spec.
const cloneValue = (value: unknown, seen: Map<object, unknown>, node: AstNode): unknown => {
  if (value === null || typeof value !== "object") return value
  if (value instanceof Values.Promise || (isRuntimeReference(value) && !Values.isValue(value))) {
    throw new InterpreterRuntimeError(`${describeValue(value)} could not be cloned.`, node).as("DataCloneError")
  }
  const existing = seen.get(value)
  if (existing !== undefined) return existing
  const remember = <T extends object>(copied: T): T => {
    seen.set(value, copied)
    return copied
  }
  if (value instanceof Values.Date) return remember(new Values.Date(value.time))
  if (value instanceof Values.RegExp) return remember(new Values.RegExp(value.regex.source, value.regex.flags))
  if (value instanceof Values.URL) return remember(new Values.URL(new URL(value.url.href)))
  if (value instanceof Values.URLSearchParams) {
    return remember(new Values.URLSearchParams(new URLSearchParams(value.params)))
  }
  if (value instanceof Values.Map) {
    const copied = remember(new Values.Map())
    for (const [key, item] of value.map) copied.map.set(cloneValue(key, seen, node), cloneValue(item, seen, node))
    return copied
  }
  if (value instanceof Values.Set) {
    const copied = remember(new Values.Set())
    for (const item of value.set) copied.set.add(cloneValue(item, seen, node))
    return copied
  }
  if (Array.isArray(value)) {
    const copied = remember(new Array<unknown>(value.length))
    for (const [key, item] of Object.entries(value)) define(copied, key, cloneValue(item, seen, node))
    return copied
  }
  const brand = errorBrandName(value)
  if (brand !== undefined) {
    const error = value as { name?: unknown; message?: unknown; cause?: unknown }
    const copied = remember(createErrorValue(brand, coerceToString(error.message)))
    if (Object.hasOwn(value, "cause")) copied.cause = cloneValue(error.cause, seen, node)
    return copied
  }
  const copied = remember(Object.create(null) as SafeObject)
  for (const [key, item] of Object.entries(value)) define(copied, key, cloneValue(item, seen, node))
  return copied
}

export const structuredCloneGlobal = sync("structuredClone", (args, node) => {
  if (args.length === 0) {
    throw new InterpreterRuntimeError("structuredClone requires a value to clone.", node).as("TypeError")
  }
  return cloneValue(args[0], new Map(), node)
})
