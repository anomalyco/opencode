import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
import { isBlockedMember } from "../tool-runtime.js"
import { isSandboxValue, SandboxMap, SandboxPromise, SandboxSet, SandboxURLSearchParams } from "../values.js"
import { boundedData, coerceToString } from "./value.js"

export const objectStatics = new Set(["keys", "values", "entries", "hasOwn", "assign", "fromEntries"])
export const objectMethodsPreservingIdentity = new Set(["assign", "values", "entries", "fromEntries"])

export const invokeObjectMethod = (name: string, args: Array<unknown>, node: AstNode): unknown => {
  if (!objectStatics.has(name)) throw new InterpreterRuntimeError(`Object.${name} is not available in CodeMode.`, node)
  const requireObject = (): Record<string, unknown> => {
    const input = args[0]
    if (Array.isArray(input)) return input as unknown as Record<string, unknown>
    if (isSandboxValue(input)) return {}
    if (input instanceof SandboxPromise) {
      throw new InterpreterRuntimeError(
        `Object.${name} received an un-awaited Promise; await it before inspecting the result.`,
        node,
        "InvalidDataValue",
      )
    }
    if (input === null || typeof input !== "object") {
      throw new InterpreterRuntimeError(`Object.${name} expects a data object or array.`, node, "InvalidDataValue")
    }
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== null && prototype !== Object.prototype) {
      throw new InterpreterRuntimeError(`Object.${name} expects a data object or array.`, node, "InvalidDataValue")
    }
    return input as Record<string, unknown>
  }
  const guardedSet = (out: Record<string, unknown>, key: string, item: unknown): void => {
    if (isBlockedMember(key)) throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, node)
    out[key] = item
  }
  const addEntry = (out: Record<string, unknown>, key: unknown, item: unknown): void => {
    boundedData(key, "Object.fromEntries key")
    boundedData(item, "Object.fromEntries value")
    guardedSet(out, coerceToString(key), item)
  }
  switch (name) {
    case "keys":
      return Object.keys(requireObject())
    case "values":
      return Object.values(requireObject())
    case "entries":
      return Object.entries(requireObject()).map(([key, item]) => [key, item])
    case "hasOwn":
      return Object.hasOwn(requireObject(), String(args[1]))
    case "assign": {
      const target = args[0]
      if (target === null || typeof target !== "object" || Array.isArray(target) || isSandboxValue(target)) {
        throw new InterpreterRuntimeError("Object.assign expects a data object target.", node)
      }
      const out = target as Record<string, unknown>
      for (const source of args.slice(1)) {
        if (source === null || source === undefined) continue
        const value = source
        if (isSandboxValue(value)) continue
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw new InterpreterRuntimeError("Object.assign expects data objects.", node)
        }
        for (const [key, item] of Object.entries(value)) guardedSet(out, key, item)
      }
      return out
    }
    case "fromEntries": {
      if (args[0] instanceof SandboxMap) {
        const out: Record<string, unknown> = Object.create(null)
        for (const [key, item] of args[0].map.entries()) addEntry(out, key, item)
        return out
      }
      if (args[0] instanceof SandboxURLSearchParams) {
        const out: Record<string, unknown> = Object.create(null)
        for (const [key, value] of args[0].params.entries()) guardedSet(out, key, value)
        return out
      }
      const pairs = args[0] instanceof SandboxSet ? Array.from(args[0].set.values()) : args[0]
      if (!Array.isArray(pairs)) {
        boundedData(args[0], "Object.fromEntries input")
        throw new InterpreterRuntimeError("Object.fromEntries expects an array of [key, value] pairs.", node)
      }
      const out: Record<string, unknown> = Object.create(null)
      for (const pair of pairs) {
        const validated = boundedData(pair, "Object.fromEntries entry")
        if (validated === null || typeof validated !== "object" || isSandboxValue(validated))
          throw new InterpreterRuntimeError("Object.fromEntries expects [key, value] entry objects.", node)
        const entry = pair as Record<string, unknown>
        addEntry(out, entry[0], entry[1])
      }
      return out
    }
  }
  throw new InterpreterRuntimeError(`Object.${name} is not available in CodeMode.`, node)
}
