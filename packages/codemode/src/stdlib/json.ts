import { Effect } from "effect"
import { methods } from "../interpreter/native.js"
import { applyCollectionCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { checkStringLength } from "../interpreter/limits.js"
import { syntaxError, typeError } from "../interpreter/model.js"
import { typeofValue } from "../interpreter/references.js"
import { fromJson, toJson } from "../data.js"
import { get, keys, Arr, Obj, record, remove, set } from "../interpreter/objects.js"

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
      return fromJson(ctx, JSON.parse(text))
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
  const properties =
    replacer instanceof Arr
      ? replacer.items
          .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
          .map(String)
      : null
  const callback =
    typeofValue(replacer) === "function" ? applyCollectionCallback(ctx, replacer, "JSON.stringify") : undefined
  return Effect.map(toJson(ctx, args[0], callback), (value) => {
    const text = JSON.stringify(value, properties, indent)
    if (text !== undefined) checkStringLength(text.length)
    return text
  })
}
