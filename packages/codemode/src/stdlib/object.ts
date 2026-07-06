import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
import { isBlockedMember } from "../tool-runtime.js"
import { isSandboxValue, SandboxMap, SandboxURLSearchParams } from "../values.js"
import { boundedData, coerceToString } from "./value.js"

export const objectStatics = new Set(["keys", "values", "entries", "hasOwn", "assign", "fromEntries"])

export const invokeObjectMethod = (name: string, args: Array<unknown>, node: AstNode): unknown => {
  if (!objectStatics.has(name)) throw new InterpreterRuntimeError(`Object.${name} is not available in CodeMode.`, node)
  const requireObject = (): Record<string, unknown> => {
    const value = boundedData(args[0], `Object.${name} input`)
    if (isSandboxValue(value)) return {}
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new InterpreterRuntimeError(`Object.${name} expects a data object.`, node)
    }
    return value as Record<string, unknown>
  }
  const guardedSet = (out: Record<string, unknown>, key: string, item: unknown): void => {
    if (isBlockedMember(key)) throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, node)
    out[key] = item
  }
  switch (name) {
    case "keys": {
      const value = boundedData(args[0], "Object.keys input")
      if (isSandboxValue(value)) return []
      if (Array.isArray(value)) return Object.keys(value)
      if (value === null || typeof value !== "object") {
        throw new InterpreterRuntimeError("Object.keys expects a data object or array.", node)
      }
      return Object.keys(value)
    }
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
        for (const [key, item] of args[0].map.entries()) guardedSet(out, coerceToString(key), item)
        return out
      }
      if (args[0] instanceof SandboxURLSearchParams) {
        const out: Record<string, unknown> = Object.create(null)
        for (const [key, value] of args[0].params.entries()) guardedSet(out, key, value)
        return out
      }
      const pairs = boundedData(args[0], "Object.fromEntries input")
      if (!Array.isArray(pairs)) {
        throw new InterpreterRuntimeError("Object.fromEntries expects an array of [key, value] pairs.", node)
      }
      const out: Record<string, unknown> = Object.create(null)
      for (const pair of pairs) {
        if (!Array.isArray(pair)) {
          throw new InterpreterRuntimeError("Object.fromEntries expects [key, value] pairs.", node)
        }
        guardedSet(out, String(pair[0]), pair[1])
      }
      return out
    }
  }
  throw new InterpreterRuntimeError(`Object.${name} is not available in CodeMode.`, node)
}
