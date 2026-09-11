import { Effect } from "effect"
import { HostFunction, HostNamespace } from "../interpreter/host.js"
import { applyCollectionCallback, type Runner } from "../interpreter/runner.js"
import { type AstNode, InterpreterRuntimeError, syntaxError } from "../interpreter/model.js"
import { typeofValue } from "../interpreter/references.js"
import { fromData, toData, toProgram } from "../data.js"
import { get, ownKeys, ProgramArray, ProgramObject, record, remove, set } from "../interpreter/objects.js"
import { Values } from "../values.js"

export const jsonGlobal = <R>(runner: Runner<R>) =>
  new HostNamespace("JSON", {
    parse: new HostFunction<R>({ name: "JSON.parse", call: (args, node) => parse(runner, args, node) }),
    stringify: new HostFunction<R>({ name: "JSON.stringify", call: (args, node) => stringify(runner, args, node) }),
  })

const parse = <R>(runner: Runner<R>, args: Array<unknown>, node: AstNode): Effect.Effect<unknown, unknown, R> => {
  const text = args[0]
  if (typeof text !== "string") throw new InterpreterRuntimeError("JSON.parse expects a string.", node)

  const parsed = (() => {
    try {
      return fromData(JSON.parse(text), "JSON.parse result")
    } catch (error) {
      throw syntaxError(
        `JSON.parse received invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        node,
      )
    }
  })()
  if (typeofValue(args[1]) !== "function") return Effect.succeed(parsed)

  const apply = applyCollectionCallback(runner, args[1], "JSON.parse", node)
  const visit = (holder: ProgramObject, key: string): Effect.Effect<unknown, unknown, R> =>
    Effect.gen(function* () {
      const value = get(holder, key)
      if (value instanceof ProgramObject) {
        for (const name of ownKeys(value)) {
          const revived = yield* visit(value, name as string)
          if (revived === undefined) remove(value, name)
          else set(value, name, revived)
        }
      }
      return yield* apply([key, value])
    })
  return visit(record({ "": parsed }), "")
}

const stringify = <R>(runner: Runner<R>, args: Array<unknown>, node: AstNode): Effect.Effect<unknown, unknown, R> => {
  const space = args[2]
  const indent = typeof space === "number" || typeof space === "string" ? space : undefined
  const replacer = args[1]

  if (typeofValue(replacer) !== "function") {
    const properties =
      replacer instanceof ProgramArray
        ? replacer.items
            .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
            .map(String)
        : null
    return Effect.succeed(JSON.stringify(toData(args[0], "JSON.stringify value"), properties, indent))
  }

  // Validate up front; the replacer walk below reads the original value.
  toProgram(args[0], "JSON.stringify value")
  const apply = applyCollectionCallback(runner, replacer, "JSON.stringify", node)
  const stack = new Set<object>()
  const visit = (holder: ProgramObject, key: string): Effect.Effect<unknown, unknown, R> =>
    Effect.gen(function* () {
      const value = yield* apply([key, toJSONValue(get(holder, key))])
      if (value === undefined || typeofValue(value) === "function") return undefined
      toProgram(value, "JSON.stringify replacer result")
      if (typeof value === "number") return Number.isFinite(value) ? value : null
      if (value === null || typeof value === "string" || typeof value === "boolean") return value
      if (!(value instanceof ProgramObject)) return {}
      if (stack.has(value)) throw new InterpreterRuntimeError("Converting circular structure to JSON.", node)
      stack.add(value)
      if (value instanceof ProgramArray) {
        const result: Array<unknown> = []
        for (let index = 0; index < value.items.length; index += 1) {
          result.push((yield* visit(value, String(index))) ?? null)
        }
        stack.delete(value)
        return result
      }
      const result: Record<string, unknown> = Object.create(null)
      for (const name of ownKeys(value)) {
        if (typeof name !== "string") continue
        const item = yield* visit(value, name)
        if (item !== undefined) result[name] = item
      }
      stack.delete(value)
      return result
    })

  return Effect.map(visit(record({ "": args[0] }), ""), (value) => JSON.stringify(value, null, indent))
}

const toJSONValue = (value: unknown): unknown => {
  if (value instanceof Values.Date) {
    return Number.isFinite(value.time) ? new Date(value.time).toISOString() : null
  }
  if (value instanceof Values.URL) return value.url.href
  return value
}
