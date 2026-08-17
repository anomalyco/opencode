import { Effect } from "effect"
import type { CallbackRunner } from "../interpreter/methods.js"
import { applyCollectionCallback } from "../interpreter/methods.js"
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"
import { typeofValue } from "../interpreter/references.js"
import { copyIn, copyOut, type SafeObject } from "../tool-runtime.js"
import {
  CodeModeDate,
  CodeModeMap,
  CodeModeRegExp,
  CodeModeSet,
  CodeModeURL,
  CodeModeURLSearchParams,
} from "../values.js"

export const jsonStatics = new Set(["parse", "stringify"])
export type JsonMethodName = "parse" | "stringify"

export const invokeJsonMethod = <R>(
  runner: CallbackRunner<R>,
  name: JsonMethodName,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  return name === "parse" ? parse(runner, args, node) : stringify(runner, args, node)
}

const parse = <R>(
  runner: CallbackRunner<R>,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  const text = args[0]
  if (typeof text !== "string") throw new InterpreterRuntimeError("JSON.parse expects a string.", node)

  const parsed = (() => {
    try {
      return copyIn(JSON.parse(text), "JSON.parse result")
    } catch (error) {
      throw new InterpreterRuntimeError(
        `JSON.parse received invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        node,
      ).as("SyntaxError")
    }
  })()
  if (typeofValue(args[1]) !== "function") return Effect.succeed(parsed)

  const apply = applyCollectionCallback(runner, args[1], "JSON.parse", node)
  const root: SafeObject = Object.create(null) as SafeObject
  root[""] = parsed
  const visit = (holder: SafeObject | Array<unknown>, key: string): Effect.Effect<unknown, unknown, R> =>
    Effect.gen(function* () {
      const value = holder[key as keyof typeof holder]
      if (Array.isArray(value)) {
        const length = value.length
        for (let index = 0; index < length; index += 1) {
          const revived = yield* visit(value, String(index))
          if (revived === undefined) Reflect.deleteProperty(value, index)
          else value[index] = revived
        }
      } else if (isPlainObject(value)) {
        for (const name of Object.keys(value)) {
          const revived = yield* visit(value, name)
          if (revived === undefined) Reflect.deleteProperty(value, name)
          else value[name] = revived
        }
      }
      return yield* apply([key, value])
    })
  return visit(root, "")
}

const stringify = <R>(
  runner: CallbackRunner<R>,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  const space = args[2]
  const indent = typeof space === "number" || typeof space === "string" ? space : undefined
  const replacer = args[1]
  const callable = typeofValue(replacer) === "function"
  const checked = copyIn(args[0], "JSON.stringify value", callable)
  const input = callable ? args[0] : checked

  if (Array.isArray(replacer)) {
    const properties = replacer
      .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
      .map(String)
    return Effect.succeed(JSON.stringify(copyOut(input, "json"), properties, indent))
  }
  if (!callable) {
    return Effect.succeed(JSON.stringify(copyOut(input, "json"), null, indent))
  }

  const apply = applyCollectionCallback(runner, replacer, "JSON.stringify", node)
  const root: SafeObject = Object.create(null) as SafeObject
  root[""] = input
  const stack = new Set<object>()
  const visit = (holder: SafeObject | Array<unknown>, key: string): Effect.Effect<unknown, unknown, R> =>
    Effect.gen(function* () {
      const value = yield* apply([key, toJSONValue(holder[key as keyof typeof holder])])
      if (value === undefined || typeofValue(value) === "function") return undefined
      copyIn(value, "JSON.stringify replacer result", true)
      if (typeof value === "number") return Number.isFinite(value) ? value : null
      if (value === null || typeof value === "string" || typeof value === "boolean") return value
      if (Array.isArray(value)) {
        if (stack.has(value))
          throw new InterpreterRuntimeError("Converting circular structure to JSON.", node).as("TypeError")
        stack.add(value)
        const result: Array<unknown> = []
        for (let index = 0; index < value.length; index += 1) {
          result.push((yield* visit(value, String(index))) ?? null)
        }
        stack.delete(value)
        return result
      }
      if (!isPlainObject(value)) return {}
      if (stack.has(value))
        throw new InterpreterRuntimeError("Converting circular structure to JSON.", node).as("TypeError")
      stack.add(value)
      const result: SafeObject = Object.create(null) as SafeObject
      for (const name of Object.keys(value)) {
        const item = yield* visit(value, name)
        if (item !== undefined) result[name] = item
      }
      stack.delete(value)
      return result
    })

  return Effect.map(visit(root, ""), (value) => JSON.stringify(value, null, indent))
}

const toJSONValue = (value: unknown): unknown => {
  if (value instanceof CodeModeDate) {
    return Number.isFinite(value.time) ? new Date(value.time).toISOString() : null
  }
  if (value instanceof CodeModeURL) return value.url.href
  return value
}

const isPlainObject = (value: unknown): value is SafeObject =>
  value !== null &&
  typeof value === "object" &&
  !(value instanceof CodeModeDate) &&
  !(value instanceof CodeModeRegExp) &&
  !(value instanceof CodeModeMap) &&
  !(value instanceof CodeModeSet) &&
  !(value instanceof CodeModeURL) &&
  !(value instanceof CodeModeURLSearchParams)
