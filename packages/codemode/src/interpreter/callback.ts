import { Cause, Effect, Exit } from "effect"
import type { Interpreter } from "./interpreter.js"
import { primitivePrototype } from "./intrinsics.js"
import { GeneratorReturn, typeError } from "./model.js"
import {
  Callable,
  get,
  Native,
  DateObj,
  Obj,
  coerceToNumber,
  coerceToString,
  type Cursor,
  type Value,
} from "./objects.js"
import { isOpaque, typeofValue } from "./references.js"

/** IteratorClose: a consumer failure closes the iterator and wins over any close failure, except that a generator's
 * return() is a return completion, so a failing close wins over it, as after `break`. */
export const preserveConsumerError = <A, R>(
  close: Cursor<R>["close"],
  effect: Effect.Effect<A, unknown, R>,
): Effect.Effect<A, unknown, R> =>
  Effect.flatMap(Effect.exit(effect), (exit) => {
    if (Exit.isSuccess(exit)) return Effect.succeed(exit.value)
    return Effect.flatMap(Effect.exit(close), (closed) => {
      if (!Exit.isSuccess(closed) && Cause.squash(exit.cause) instanceof GeneratorReturn) {
        return Effect.failCause(closed.cause)
      }
      return Effect.failCause(exit.cause)
    })
  })

export type Hint = "number" | "string" | "default"

/**
 * ToPrimitive: calls `valueOf`/`toString` in hint order and returns the first primitive result. Dates treat the
 * default hint as "string", like their `Symbol.toPrimitive`. Opaque values (functions, promises, generators, tool
 * references) pass through unchanged so callers reject or describe them in their built-in form.
 */
export const toPrimitive = <R>(ctx: Interpreter<R>, value: Value, hint: Hint): Effect.Effect<Value, unknown, R> => {
  if (!(value instanceof Obj) || isOpaque(value)) return Effect.succeed(value)
  const asString = hint === "string" || (hint === "default" && value instanceof DateObj)
  const order = asString ? ["toString", "valueOf"] : ["valueOf", "toString"]
  return Effect.gen(function* () {
    for (const method of order) {
      const callable = get(value, method)
      if (!(callable instanceof Callable)) continue
      const result = yield* ctx.call(callable, value, [])
      if (result === null || (typeof result !== "object" && typeof result !== "function")) return result
    }
    throw typeError("Cannot convert object to primitive value.")
  })
}

/** Invoke(value, name): calls the method the value would find through its prototype. */
export const invoke = <R>(ctx: Interpreter<R>, value: Value, name: string, label: string) => {
  const target = value instanceof Obj ? value : primitivePrototype(ctx.builtins, value)
  if (target === undefined) throw typeError(`${label} called on null or undefined.`)
  return ctx.call(get(target, name), value, [])
}

export const toPrimitiveString = <R>(ctx: Interpreter<R>, value: Value) =>
  Effect.map(toPrimitive(ctx, value, "string"), coerceToString)

export const toPrimitiveNumber = <R>(ctx: Interpreter<R>, value: Value) =>
  Effect.map(toPrimitive(ctx, value, "number"), coerceToNumber)

/**
 * Runs a synchronous native body on its arguments after ToPrimitive, in order, with one hint for all positions or
 * one per position. Primitive arguments skip the Effect entirely.
 */
export const withPrimitives = <R>(
  ctx: Interpreter<R>,
  hints: Hint | ReadonlyArray<Hint>,
  values: Array<Value>,
  body: (primitives: Array<Value>) => Value,
): Value | Effect.Effect<Value, unknown, R> => {
  if (!values.some((value) => value instanceof Obj)) return body(values)
  return Effect.map(
    Effect.forEach(values, (value, index) =>
      toPrimitive(ctx, value, typeof hints === "string" ? hints : hints[index]!),
    ),
    body,
  )
}

// The single acceptance list for callbacks: collections, sort, string replacers,
// Array.from mappers, and promise reactions all admit exactly these callables.
// Admission means dispatchable, not necessarily invocable: new-requiring
// constructors pass the gate and throw a TypeError on call, like JS.
export const isSupportedCallback = (value: Value): value is Callable =>
  value instanceof Callable && !(value instanceof Native && !value.callback)

export const applyCollectionCallback = <R>(
  ctx: Interpreter<R>,
  callback: Value,
  name: string,
): ((args: Array<Value>, thisValue?: Value) => Effect.Effect<Value, unknown, R>) => {
  if (!isSupportedCallback(callback)) {
    if (typeofValue(callback) === "function") {
      throw typeError(
        `${name} cannot use this callable as a callback; wrap it in an arrow function, e.g. (value) => tools.ns.tool(value).`,
      )
    }
    throw typeError(`${name} expects a function callback.`)
  }
  return (callbackArgs, thisValue) => ctx.call(callback, thisValue, callbackArgs)
}
