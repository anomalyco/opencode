import { Effect } from "effect"
import { methods } from "../interpreter/native.js"
import { applyCollectionCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { checkStringLength } from "../interpreter/limits.js"
import { syntaxError, typeError } from "../interpreter/model.js"
import { typeofValue } from "../interpreter/references.js"
import { fromData, toData, toProgram } from "../data.js"
import { Callable, get, keys, Arr, Obj, record, remove, set } from "../interpreter/objects.js"

export const jsonGlobal = <R>(ctx: Interpreter<R>) => {
  const json = new Obj(ctx.builtins.Object)
  methods(ctx.builtins, json, [
    ["parse", 2, (_, args) => parse(ctx, args)],
    ["stringify", 3, (_, args) => stringify(ctx, args)],
  ])
  return json
}

const parse = <R>(ctx: Interpreter<R>, args: Array<unknown>): Effect.Effect<unknown, unknown, R> => {
  const text = args[0]
  if (typeof text !== "string") throw typeError("JSON.parse expects a string.")

  const parsed = (() => {
    try {
      return fromData(ctx.builtins, JSON.parse(text), "JSON.parse result")
    } catch (error) {
      throw syntaxError(`JSON.parse received invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
  if (typeofValue(args[1]) !== "function") return Effect.succeed(parsed)

  const apply = applyCollectionCallback(ctx, args[1], "JSON.parse")
  const visit = (holder: Obj, key: string): Effect.Effect<unknown, unknown, R> =>
    Effect.gen(function* () {
      const value = get(holder, key)
      if (value instanceof Obj) {
        for (const name of keys(value)) {
          const revived = yield* visit(value, name)
          if (revived === undefined) remove(value, name)
          else set(value, name, revived)
        }
      }
      return yield* apply([key, value])
    })
  return visit(record(ctx.builtins.Object, { "": parsed }), "")
}

const stringify = <R>(ctx: Interpreter<R>, args: Array<unknown>): Effect.Effect<unknown, unknown, R> => {
  const space = args[2]
  const indent = typeof space === "number" || typeof space === "string" ? space : undefined
  const replacer = args[1]

  if (typeofValue(replacer) !== "function") {
    const properties =
      replacer instanceof Arr
        ? replacer.items
            .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
            .map(String)
        : null
    // Not a host boundary: __proto__ stays and Set/RegExp/URLSearchParams serialize as {}, like JS.
    const text = JSON.stringify(toData(args[0], "JSON.stringify value", "json", false), properties, indent)
    if (text !== undefined) checkStringLength(text.length)
    return Effect.succeed(text)
  }

  // Validate up front; the replacer walk below reads the original value.
  toProgram(ctx.builtins, args[0], "JSON.stringify value")
  const apply = applyCollectionCallback(ctx, replacer, "JSON.stringify")
  const stack = new Set<object>()
  const visit = (holder: Obj, key: string): Effect.Effect<unknown, unknown, R> =>
    Effect.gen(function* () {
      const value = yield* apply([key, yield* toJSONValue(ctx, get(holder, key), key)])
      if (value === undefined || typeofValue(value) === "function") return undefined
      toProgram(ctx.builtins, value, "JSON.stringify replacer result")
      if (typeof value === "number") return Number.isFinite(value) ? value : null
      if (value === null || typeof value === "string" || typeof value === "boolean") return value
      if (!(value instanceof Obj)) return {}
      if (stack.has(value)) throw typeError("Converting circular structure to JSON.")
      stack.add(value)
      if (value instanceof Arr) {
        const result: Array<unknown> = []
        for (let index = 0; index < value.items.length; index += 1) {
          result.push((yield* visit(value, String(index))) ?? null)
        }
        stack.delete(value)
        return result
      }
      const result: Record<string, unknown> = Object.create(null)
      for (const name of keys(value)) {
        const item = yield* visit(value, name)
        if (item !== undefined) result[name] = item
      }
      stack.delete(value)
      return result
    })

  return Effect.map(visit(record(ctx.builtins.Object, { "": args[0] }), ""), (value) =>
    JSON.stringify(value, null, indent),
  )
}

// SerializeJSONProperty step 2: a callable `toJSON` decides the value, as Date and URL define.
const toJSONValue = <R>(ctx: Interpreter<R>, value: unknown, key: string) => {
  if (!(value instanceof Obj)) return Effect.succeed(value)
  const toJSON = get(value, "toJSON")
  return toJSON instanceof Callable ? ctx.call(toJSON, value, [key]) : Effect.succeed(value)
}
