export * as Data from "./data.js"

import { Effect, type Schema } from "effect"
import type { Interpreter } from "./interpreter/interpreter.js"
import { MAX_VALUE_DEPTH } from "./interpreter/limits.js"
import { rangeError, typeError } from "./interpreter/model.js"
import { Arr, Callable, define, get, keys, Obj, record } from "./interpreter/objects.js"
import { typeofValue } from "./interpreter/references.js"

export type Json = Schema.Json

/**
 * What `JSON.stringify` would serialize for a program value, as host JSON: `toJSON` is honored, functions and
 * `undefined` vanish, non-finite numbers become null, and everything else is copied. Tool arguments and the
 * execution result cross the boundary this way, and it is the walk behind the program's own `JSON.stringify`.
 */
export const toJson = <R>(
  ctx: Interpreter<R>,
  value: unknown,
  replacer?: (args: Array<unknown>) => Effect.Effect<unknown, unknown, R>,
): Effect.Effect<Json | undefined, unknown, R> => {
  const stack = new Set<object>()
  const visit = (holder: Obj, key: string, depth: number): Effect.Effect<Json | undefined, unknown, R> =>
    Effect.gen(function* () {
      if (depth > MAX_VALUE_DEPTH) throw rangeError(`Value exceeds the maximum depth of ${MAX_VALUE_DEPTH}.`)
      const raw = get(holder, key)
      const toJSON = raw instanceof Obj ? get(raw, "toJSON") : undefined
      const own = toJSON instanceof Callable ? yield* ctx.call(toJSON, raw, [key]) : raw
      const value = replacer === undefined ? own : yield* replacer([key, own])
      if (value === undefined || typeofValue(value) === "function") return undefined
      if (typeof value === "number") return Number.isFinite(value) ? value : null
      if (value === null || typeof value === "string" || typeof value === "boolean") return value
      if (!(value instanceof Obj)) return {}
      if (stack.has(value)) throw typeError("Converting circular structure to JSON.")
      stack.add(value)
      if (value instanceof Arr) {
        const items: Array<Json> = []
        for (let index = 0; index < value.items.length; index += 1) {
          items.push((yield* visit(value, String(index), depth + 1)) ?? null)
        }
        stack.delete(value)
        return items
      }
      const copied: Record<string, Json> = {}
      for (const name of keys(value)) {
        const item = yield* visit(value, name, depth + 1)
        // Own data property regardless of the key, so "__proto__" never reaches the Object.prototype setter.
        if (item !== undefined)
          Object.defineProperty(copied, name, { value: item, enumerable: true, writable: true, configurable: true })
      }
      stack.delete(value)
      return copied
    })
  return visit(record(ctx.builtins.Object, { "": value }), "", 0)
}

/** The replacer every host boundary applies: a "__proto__" key must never reach host code. */
export const hostSafe = ([key, value]: Array<unknown>) => Effect.succeed(key === "__proto__" ? undefined : value)

/** Host JSON as program values: objects and arrays are copied, primitives pass through. */
export const fromJson = <R>(ctx: Interpreter<R>, value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value))
    return new Arr(
      ctx.builtins.Array,
      value.map((item) => fromJson(ctx, item)),
    )
  const copied = new Obj(ctx.builtins.Object)
  for (const [key, item] of Object.entries(value)) define(copied, key, fromJson(ctx, item))
  return copied
}
