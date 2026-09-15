import { Effect } from "effect"
import type { Extension } from "../extension.js"
import { coerceToString } from "../stdlib/value.js"
import type { Interpreter } from "./interpreter.js"
import { createErrorValue, isErrorType } from "./intrinsics.js"
import { MAX_VALUE_DEPTH } from "./limits.js"
import { Throw, typeError } from "./model.js"
import { fn } from "./native.js"
import {
  Callable,
  define,
  entries,
  get,
  type Native,
  Arr,
  Bytes,
  DateObj,
  ErrorObj,
  GeneratorObj,
  MapObj,
  Obj,
  PromiseObj,
  RegExpObj,
  SetObj,
  URLObj,
  URLSearchParamsObj,
} from "./objects.js"
import { describeValue } from "./references.js"

/**
 * The global bindings of one run's extensions. Everything crossing the boundary is converted: plain data and
 * built-in wrappers are copied, a host function becomes a program function whose calls cross the same way, and a
 * host Promise becomes a program promise.
 */
export const extensionGlobals = <R>(
  ctx: Interpreter<R>,
  extensions: ReadonlyArray<Extension>,
): ReadonlyArray<readonly [string, unknown]> => {
  const builtins = ctx.builtins

  const toHost = (value: unknown, label: string, depth = 0, seen = new Set<object>()): unknown => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (value === null || typeof value !== "object") {
      if (isPrimitive(value)) return value
      throw typeError(`${label} contains ${describeValue(value)}, which cannot be passed to an extension.`)
    }
    if (value instanceof Bytes) return new Uint8Array(value.bytes)
    if (value instanceof DateObj) return new Date(value.time)
    if (value instanceof RegExpObj) return new RegExp(value.regex.source, value.regex.flags)
    if (value instanceof URLObj) return new URL(value.url.href)
    if (value instanceof URLSearchParamsObj) return new URLSearchParams(value.params)
    const next = (item: unknown) => toHost(item, label, depth + 1, seen)
    if (value instanceof MapObj) return new Map([...value.map].map(([key, item]) => [next(key), next(item)]))
    if (value instanceof SetObj) return new Set([...value.set].map(next))
    if (
      !(value instanceof Obj) ||
      value instanceof Callable ||
      value instanceof GeneratorObj ||
      value instanceof PromiseObj
    ) {
      throw typeError(`${label} contains ${describeValue(value)}, which cannot be passed to an extension.`)
    }
    if (value instanceof ErrorObj) {
      const name = coerceToString(get(value, "name"))
      const message = get(value, "message")
      const text = message === undefined ? "" : coerceToString(message)
      return name === "AggregateError" ? new AggregateError([], text) : new (hostErrors.get(name) ?? Error)(text)
    }
    if (seen.has(value)) throw typeError(`${label} contains a circular value.`)
    seen.add(value)
    const copied =
      value instanceof Arr
        ? value.items.map(next)
        : Object.fromEntries(
            entries(value)
              .filter(([key]) => key !== "__proto__")
              .map(([key, item]) => [key, next(item)]),
          )
    seen.delete(value)
    return copied
  }

  const fromHost = (value: unknown, label: string, depth = 0, seen = new Set<object>()): unknown => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (isPrimitive(value)) return value
    if (typeof value === "function") return wrap(value, label, (_, run) => run)
    if (value !== null && typeof value === "object") {
      if (value instanceof Date) return new DateObj(builtins.Date, value.getTime())
      if (value instanceof RegExp) return new RegExpObj(builtins.RegExp, value.source, value.flags)
      if (value instanceof Uint8Array) return new Bytes(builtins.Uint8Array, new Uint8Array(value))
      if (value instanceof ArrayBuffer) return new Bytes(builtins.Uint8Array, new Uint8Array(value.slice(0)))
      if (value instanceof Error) {
        return createErrorValue(builtins[isErrorType(value.name) ? value.name : "Error"], value.message)
      }
      if (value instanceof URL) return new URLObj(builtins.URL, builtins.URLSearchParams, new URL(value.href))
      if (value instanceof URLSearchParams) {
        return new URLSearchParamsObj(builtins.URLSearchParams, new URLSearchParams(value))
      }
      const next = (item: unknown, path: string) => fromHost(item, path, depth + 1, seen)
      if (value instanceof Map) {
        const wrapped = new MapObj(builtins.Map)
        for (const [key, item] of value) wrapped.map.set(next(key, label), next(item, label))
        return wrapped
      }
      if (value instanceof Set) {
        const wrapped = new SetObj(builtins.Set)
        for (const item of value) wrapped.set.add(next(item, label))
        return wrapped
      }
      if (seen.has(value)) throw typeError(`${label} produced a circular value.`)
      seen.add(value)
      if (Array.isArray(value)) {
        const copied = new Arr(
          builtins.Array,
          value.map((item, index) => next(item, `${label}[${index}]`)),
        )
        seen.delete(value)
        return copied
      }
      const prototype = Object.getPrototypeOf(value)
      if (prototype === Object.prototype || prototype === null) {
        const copied = new Obj(builtins.Object)
        for (const [key, item] of Object.entries(value)) define(copied, key, next(item, `${label}.${key}`))
        seen.delete(value)
        return copied
      }
    }
    throw typeError(`${label} produced ${describeHost(value)}, which the program cannot hold.`)
  }

  // A host function as a program function. Arguments cross in; the call is observed by the host's `onCall` with the
  // host's own error on failure; then whatever came back, or was thrown, crosses out so the program catches a copy.
  const wrap = (
    value: Function,
    label: string,
    observe: (
      args: ReadonlyArray<unknown>,
      run: Effect.Effect<unknown, unknown, R>,
    ) => Effect.Effect<unknown, unknown, R>,
  ): Native<R> =>
    fn<R>(builtins, value.name, value.length, (_, values) => {
      const args = values.map((item, index) => toHost(item, `Argument ${index + 1} to ${label}`))
      const finish = (run: Effect.Effect<unknown, unknown, R>) =>
        observe(args, run).pipe(
          Effect.mapError((reason) => new Throw(fromHost(reason, label))),
          Effect.flatMap((settled) => Effect.try({ try: () => fromHost(settled, label), catch: (error) => error })),
        )
      let result: unknown
      try {
        result = value.apply(undefined, args)
      } catch (reason) {
        return finish(Effect.fail(reason))
      }
      if (!(result instanceof Promise)) return finish(Effect.succeed(result))
      return ctx.pending.create(finish(Effect.tryPromise({ try: () => result, catch: (reason) => reason })))
    })

  return extensions.flatMap((extension) =>
    Object.entries(extension.globals).map(
      ([name, value]) =>
        [
          name,
          wrap(value, name, (args, run) =>
            ctx.tools.observe({ type: "extension", extension: extension.name, name, args }, run),
          ),
        ] as const,
    ),
  )
}

const hostErrors = new Map<string, ErrorConstructor>([
  ["TypeError", TypeError],
  ["RangeError", RangeError],
  ["SyntaxError", SyntaxError],
  ["ReferenceError", ReferenceError],
  ["EvalError", EvalError],
  ["URIError", URIError],
])

// The primitives the interpreter operates on; symbols and BigInts are not among them.
const isPrimitive = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"

const describeHost = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return `a ${typeof value}`
  const name = (value as { constructor?: { name?: string } }).constructor?.name
  return name === undefined || name === "" ? "an object" : `a ${name}`
}
