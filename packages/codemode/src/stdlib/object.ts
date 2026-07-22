import { Effect } from "effect"
import {
  type AstNode,
  AsyncIteratorSymbol,
  InterpreterRuntimeError,
  IteratorSymbol,
  IteratorSymbols,
} from "../interpreter/model.js"
import { containsOpaqueReference } from "../interpreter/references.js"
import { isBlockedMember } from "../tool-runtime.js"
import { isCodeModeValue, CodeModePromise } from "../values.js"
import { boundedData, coerceToString } from "./value.js"
import { preserveConsumerError, type SyncIteratorRunner } from "../interpreter/iterator.js"

export const objectMethodsPreservingIdentity = new Set(["assign", "values", "entries", "fromEntries"])

export const objectStatics = new Set(["keys", "values", "entries", "hasOwn", "is", "assign", "fromEntries", "groupBy"])

export const invokeObjectMethod = (name: string, args: Array<unknown>, node: AstNode): unknown => {
  const requireObject = (): Record<string, unknown> => {
    const input = args[0]
    if (Array.isArray(input)) return input as unknown as Record<string, unknown>
    if (isCodeModeValue(input)) return {}
    if (input instanceof CodeModePromise) {
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
    if (isBlockedMember(key)) throw new InterpreterRuntimeError(`Property '${key}' is not available.`, node)
    out[key] = item
  }
  switch (name) {
    case "keys":
      return Object.keys(requireObject())
    case "values":
      return Object.values(requireObject())
    case "entries":
      return Object.entries(requireObject()).map(([key, item]) => [key, item])
    case "hasOwn":
      return Object.hasOwn(
        requireObject(),
        args[1] === AsyncIteratorSymbol || args[1] === IteratorSymbol ? args[1] : String(args[1]),
      )
    case "is":
      if (containsOpaqueReference(args[0]) || containsOpaqueReference(args[1])) {
        throw new InterpreterRuntimeError("Object.is requires data values.", node, "InvalidDataValue")
      }
      return Object.is(args[0], args[1])
    case "assign": {
      const target = args[0]
      if (target === null || typeof target !== "object" || Array.isArray(target) || isCodeModeValue(target)) {
        throw new InterpreterRuntimeError("Object.assign expects a data object target.", node)
      }
      const out = target as Record<string, unknown>
      for (const source of args.slice(1)) {
        if (source === null || source === undefined || isCodeModeValue(source)) continue
        if (typeof source !== "object" || Array.isArray(source)) {
          throw new InterpreterRuntimeError("Object.assign expects data objects.", node)
        }
        for (const [key, item] of Object.entries(source)) guardedSet(out, key, item)
        for (const symbol of IteratorSymbols) {
          if (Object.hasOwn(source, symbol)) Reflect.set(out, symbol, Reflect.get(source, symbol))
        }
      }
      return out
    }
  }
  throw new InterpreterRuntimeError(`Object.${name} is not available.`, node)
}

export const invokeObjectFromEntries = <R>(
  runner: SyncIteratorRunner<R>,
  source: unknown,
  node: AstNode,
): Effect.Effect<Record<string, unknown>, unknown, R> => {
  const out: Record<string, unknown> = Object.create(null)
  return Effect.gen(function* () {
    const cursor = yield* runner.syncIterator(source, node)
    if (cursor === undefined) {
      throw new InterpreterRuntimeError("Object.fromEntries expects a synchronous iterable of entries.", node).as(
        "TypeError",
      )
    }
    while (true) {
      const step = yield* cursor.next
      if (step.done) return out
      yield* preserveConsumerError(
        cursor,
        Effect.sync(() => {
          if (
            step.value === null ||
            typeof step.value !== "object" ||
            isCodeModeValue(step.value) ||
            containsOpaqueReference(step.value)
          ) {
            throw new InterpreterRuntimeError("Object.fromEntries expects [key, value] entry objects.", node).as(
              "TypeError",
            )
          }
          const entry = step.value as Record<string, unknown>
          boundedData(entry[0], "Object.fromEntries key")
          boundedData(entry[1], "Object.fromEntries value")
          const key = coerceToString(entry[0])
          if (isBlockedMember(key)) throw new InterpreterRuntimeError(`Property '${key}' is not available.`, node)
          out[key] = entry[1]
        }),
      )
    }
  })
}
