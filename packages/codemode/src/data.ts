export * as Data from "./data.js"

import { Effect, type Schema } from "effect"
import type { Interpreter } from "./interpreter/interpreter.js"
import { MAX_VALUE_DEPTH } from "./interpreter/limits.js"
import { invalidData, rangeError, typeError } from "./interpreter/model.js"
import {
  Arr,
  Bytes,
  Callable,
  define,
  ErrorObj,
  get,
  keys,
  Obj,
  PromiseObj,
  record,
  type Value,
  SetObj,
  URLSearchParamsObj,
  HeadersObj,
} from "./interpreter/objects.js"
import { typeofValue } from "./interpreter/references.js"

export type Json = Schema.Json

type Replacer<R> = (args: Array<Value>, holder: Obj) => Effect.Effect<Value, unknown, R>

/**
 * What `JSON.stringify` would serialize for a program value, as host JSON: `toJSON` is honored, functions and
 * `undefined` vanish, non-finite numbers become null, and everything else is copied. Two departures from JS
 * so a mistake is not a silent `{}`: an Error serializes as `{ name, message, ...own }`, and a promise throws.
 */
export const toJson = <R>(ctx: Interpreter<R>, value: Value, replacer?: Replacer<R>) =>
  walk(ctx, value, replacer, false)

/**
 * The host boundary: `toJson`, plus what a program most likely meant when a value cannot be JSON. A promise is
 * awaited, a Set crosses as an array, a URLSearchParams as its query string, a Uint8Array asks to be encoded as
 * text first, and a `__proto__` key is dropped so host code can never receive one.
 */
export const toBoundary = <R>(ctx: Interpreter<R>, value: Value) => walk(ctx, value, undefined, true)

const walk = <R>(
  ctx: Interpreter<R>,
  value: Value,
  replacer: Replacer<R> | undefined,
  boundary: boolean,
): Effect.Effect<Json | undefined, unknown, R> => {
  const stack = new Set<object>()
  const visit = (holder: Obj, key: string, depth: number): Effect.Effect<Json | undefined, unknown, R> =>
    Effect.gen(function* () {
      if (depth > MAX_VALUE_DEPTH) throw rangeError(`Value exceeds the maximum depth of ${MAX_VALUE_DEPTH}.`)
      const raw = get(holder, key)
      if (raw instanceof PromiseObj && !boundary) {
        throw invalidData(
          "JSON.stringify received an un-awaited Promise; await it first - e.g. `const result = await tools.ns.tool(...)`.",
        )
      }
      const settled = raw instanceof PromiseObj ? yield* ctx.await(raw) : raw
      const toJSON = settled instanceof Obj ? get(settled, "toJSON") : undefined
      const own = toJSON instanceof Callable ? yield* ctx.call(toJSON, settled, [key]) : settled
      const value = replacer === undefined ? own : yield* replacer([key, own], holder)
      if (value === undefined || typeofValue(value) === "function") return undefined
      if (typeof value === "number") return Number.isFinite(value) ? value : null
      if (value === null || typeof value === "string" || typeof value === "boolean") return value
      if (!(value instanceof Obj)) return {}
      if (boundary && value instanceof Bytes) {
        throw invalidData(
          "A Uint8Array cannot cross to the host; pass text instead, e.g. `new TextDecoder().decode(bytes)` or `bytes.toBase64()`.",
        )
      }
      if (boundary && value instanceof URLSearchParamsObj) return value.params.toString()
      if (value instanceof HeadersObj) return Object.fromEntries(value.headers)
      const target = boundary && value instanceof SetObj ? new Arr(ctx.builtins.Array, [...value.set]) : value
      if (stack.has(target)) throw typeError("Converting circular structure to JSON.")
      stack.add(target)
      if (target instanceof Arr) {
        const items: Array<Json> = []
        for (let index = 0; index < target.items.length; index += 1) {
          items.push((yield* visit(target, String(index), depth + 1)) ?? null)
        }
        stack.delete(target)
        return items
      }
      const copied: Record<string, Json> = {}
      // Own data property regardless of the key, so "__proto__" never reaches the Object.prototype setter.
      const put = (name: string, item: Json | undefined) => {
        if (item !== undefined)
          Object.defineProperty(copied, name, { value: item, enumerable: true, writable: true, configurable: true })
      }
      // Errors serialize as { name, message, ...own }: both may be inherited, and neither is enumerable in JS.
      if (target instanceof ErrorObj) {
        put("name", yield* visit(target, "name", depth + 1))
        put("message", yield* visit(target, "message", depth + 1))
      }
      for (const name of keys(target)) {
        if (boundary && name === "__proto__") continue
        put(name, yield* visit(target, name, depth + 1))
      }
      stack.delete(target)
      return copied
    })
  return visit(record(ctx.builtins.Object, { "": value }), "", 0)
}

/** Host JSON as program values: objects and arrays are copied, primitives pass through. */
export const fromJson = <R>(ctx: Interpreter<R>, value: Json | undefined): Value => {
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
