import { Effect } from "effect"
import { type Extension, isAsync } from "../extension.js"
import { type ExtensionInvocation, hooked } from "../tool-runtime.js"
import type { Interpreter } from "./interpreter.js"
import { createErrorValue, isErrorType } from "./intrinsics.js"
import { MAX_VALUE_DEPTH } from "./limits.js"
import { type AstNode, PendingThrow, Throw, typeError } from "./model.js"
import { fn } from "./native.js"
import {
  define,
  get,
  has,
  hidden,
  keys,
  Arr,
  Bytes,
  DateObj,
  ErrorObj,
  HeadersObj,
  MapObj,
  Obj,
  RegExpObj,
  SetObj,
  URLObj,
  URLSearchParamsObj,
  coerceToString,
  type Value,
} from "./objects.js"
import { describeValue, isOpaque } from "./references.js"

/**
 * The global bindings of one run's extensions. Everything crossing the boundary is converted: plain data and
 * built-in wrappers are copied, a host function becomes a program function whose calls cross the same way, and a
 * host Promise or Effect becomes a program promise.
 */
export const extensionGlobals = <R>(
  ctx: Interpreter<R>,
  extensions: ReadonlyArray<Extension>,
): ReadonlyArray<readonly [string, Value]> => {
  const builtins = ctx.builtins

  const toHost = (value: Value, label: string, depth = 0, seen = new Set<object>()): unknown => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (isPrimitive(value)) return value
    if (!(value instanceof Obj) || isOpaque(value)) {
      throw typeError(`${label} contains ${describeValue(value)}, which cannot be passed to an extension.`)
    }
    if (seen.has(value)) throw typeError(`${label} contains a circular value.`)
    seen.add(value)
    const next = (item: Value) => toHost(item, label, depth + 1, seen)
    if (value instanceof ErrorObj) {
      const name = coerceToString(get(value, "name"))
      const message = get(value, "message")
      const text = message === undefined ? "" : coerceToString(message)
      const copied =
        name === "AggregateError" ? new AggregateError([], text) : new (hostErrors.get(name) ?? Error)(text)
      for (const key of new Set(["cause", ...keys(value)])) {
        if (uncrossed.has(key) || !has(value, key)) continue
        const item = crossing(() => next(get(value, key)))
        if (item === left) continue
        Object.defineProperty(copied, key, {
          value: item,
          writable: true,
          configurable: true,
          enumerable: key !== "cause",
        })
      }
      seen.delete(value)
      return copied
    }
    const copied = value.toHost(next)
    seen.delete(value)
    return copied
  }

  const fromHost = (value: unknown, label: string, depth = 0, seen = new Set<object>()): Value => {
    if (depth > MAX_VALUE_DEPTH) throw typeError(`${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
    if (isPrimitive(value)) return value
    if (typeof value === "function") return wrap(value, label)
    if (value !== null && typeof value === "object") {
      const next = (item: unknown, path: string) => fromHost(item, path, depth + 1, seen)
      if (value instanceof Date) return new DateObj(builtins.Date, value.getTime())
      if (value instanceof RegExp) return new RegExpObj(builtins.RegExp, value.source, value.flags)
      if (value instanceof Uint8Array) return new Bytes(builtins.Uint8Array, new Uint8Array(value))
      if (value instanceof ArrayBuffer) return new Bytes(builtins.Uint8Array, new Uint8Array(value.slice(0)))
      if (value instanceof Error) {
        if (seen.has(value)) throw typeError(`${label} produced a circular value.`)
        seen.add(value)
        const copied = createErrorValue(builtins[isErrorType(value.name) ? value.name : "Error"], value.message)
        const fields = value as unknown as Record<string, unknown>
        for (const key of new Set(["cause", ...Object.keys(value)])) {
          if (uncrossed.has(key) || !(key in value) || typeof fields[key] === "function") continue
          const item = crossing(() => next(fields[key], `${label}.${key}`))
          if (item === left) continue
          define(copied, key, item, key === "cause" ? hidden : undefined)
        }
        seen.delete(value)
        return copied
      }
      if (value instanceof URL) return new URLObj(builtins.URL, builtins.URLSearchParams, new URL(value.href))
      if (value instanceof URLSearchParams) {
        return new URLSearchParamsObj(builtins.URLSearchParams, new URLSearchParams(value))
      }
      if (value instanceof Headers) return new HeadersObj(builtins.Headers, new Headers(value))
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

  // A host function as a program function. Arguments cross in; for a global, the `extension.before` hook runs before
  // the host function is called, so a call it denies never reaches the host. The host's result, or what it threw,
  // crosses out so the program catches a copy, and `extension.after` sees how the call ended. Functions inside
  // results are part of a value's API and skip the hooks.
  const wrap = (value: Function, label: string, describe?: (args: ReadonlyArray<unknown>) => ExtensionInvocation) =>
    fn(builtins, value.name, value.length, function* (_, values, site) {
      const args = values.map((item, index) => toHost(item, `Argument ${index + 1} to ${label}`))
      const cross = (reason: unknown) => new Throw(fromHost(reason, label))
      const call = describe?.(args)
      const hooks = ctx.tools.hooks
      const before = call && hooks["extension.before"]?.(call).pipe(Effect.mapError(cross))
      const after = call && hooks["extension.after"]
      const settle = (effect: Effect.Effect<unknown, unknown, R>) =>
        (after ? hooked(call, undefined, after, effect) : effect).pipe(
          Effect.mapBoth({ onFailure: cross, onSuccess: (result) => fromHost(result, label) }),
        )
      // A denied call fails the way the global would: an async global rejects its promise, a sync one throws.
      if (isAsync(value))
        return pending(
          Effect.andThen(before ?? Effect.void, settle(Effect.suspend(() => callHost<R>(value, args).effect))),
          site,
        )
      if (before) yield ctx.runner.blocking(before)
      const host = callHost<R>(value, args)
      if (host.async) return pending(settle(host.effect), site)
      return (yield ctx.runner.blocking(settle(host.effect))) as Value
    })

  // An asynchronous host call: the program holds a promise that settles when the host's work does.
  const pending = (work: Effect.Effect<Value, Throw, R>, site: AstNode | undefined) => {
    const promise = ctx.runner.newPromise()
    const resolving = ctx.runner.resolving(promise, site)
    ctx.runner.host(
      work,
      (settled) => (settled.ok ? resolving.resolve(settled.value as Value) : resolving.reject(settled.error)),
      site,
    )
    return promise
  }

  return extensions.flatMap((extension) =>
    Object.entries(extension.globals).map(
      ([name, value]) => [name, wrap(value, name, (args) => ({ extension: extension.name, name, args }))] as const,
    ),
  )
}

/**
 * Calls a host function and describes what the program waits on. A returned Effect or Promise settles later; a
 * returned value or a throw settles now.
 */
const callHost = <R>(value: Function, args: ReadonlyArray<unknown>) => {
  try {
    const result: unknown = value.apply(undefined, args)
    // Extension.Services adds an Effect global's requirements to R.
    if (Effect.isEffect(result)) return { async: true, effect: result as Effect.Effect<unknown, unknown, R> }
    if (result instanceof Promise)
      return { async: true, effect: Effect.tryPromise({ try: () => result, catch: (reason) => reason }) }
    return { async: false, effect: Effect.succeed(result) }
  } catch (reason) {
    return { async: false, effect: Effect.fail(reason) }
  }
}

/**
 * An error crosses as its name, message, `cause`, and own enumerable fields, such as Node's `code`, `errno`,
 * `syscall`, and `path`. `stack` stays on its own side, and no field may shadow an Error method. A field that cannot
 * cross (a socket, a handle, a function) is left behind so the error itself always arrives.
 */
const uncrossed = new Set(["stack", "constructor", "toString", "__proto__"])
const left = Symbol("left behind")
const crossing = <T>(convert: () => T): T | typeof left => {
  try {
    return convert()
  } catch (reason) {
    if (reason instanceof PendingThrow) return left
    throw reason
  }
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
const isPrimitive = (value: unknown): value is string | number | boolean | null | undefined =>
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
