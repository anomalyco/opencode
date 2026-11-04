import type { Interpreter } from "./interpreter.js"
import { type Builtins, primitivePrototype } from "./intrinsics.js"
import { typeError } from "./model.js"
import {
  Callable,
  get,
  Builtin,
  DateObj,
  Obj,
  coerceToNumber,
  coerceToString,
  type NativeResult,
  type Value,
} from "./objects.js"
import { isOpaque, typeofValue } from "./references.js"
import { Convert, type Eval, type Hints, Invoke } from "./signals.js"

import type { Hint } from "./signals.js"

/**
 * ToPrimitive: calls `valueOf`/`toString` in hint order and returns the first primitive result. Dates treat the
 * default hint as "string", like their `Symbol.toPrimitive`. Opaque values (functions, promises, generators, tool
 * references) pass through unchanged so callers reject or describe them in their built-in form.
 */
export function* toPrimitive<R>(ctx: Interpreter<R>, value: Value, hint: Hint): Eval<Value> {
  if (!(value instanceof Obj) || isOpaque(value)) return value
  const asString = hint === "string" || (hint === "default" && value instanceof DateObj)
  for (const method of asString ? ["toString", "valueOf"] : ["valueOf", "toString"]) {
    const callable = get(value, method)
    if (!(callable instanceof Callable)) continue
    const result = yield* ctx.call(callable, value, [])
    if (result === null || (typeof result !== "object" && typeof result !== "function")) return result
  }
  throw typeError("Cannot convert object to primitive value.")
}

/** Invoke(value, name): calls the method the value would find through its prototype. */
export const invoke = <R>(ctx: Interpreter<R>, value: Value, name: string, label: string) => {
  const target = value instanceof Obj ? value : primitivePrototype(ctx.builtins, value)
  if (target === undefined) throw typeError(`${label} called on null or undefined.`)
  return ctx.call(get(target, name), value, [])
}

/** Invoke(value, name), as the call to make: the method the value would find through its prototype. */
export const invokeMethod = (builtins: Builtins, value: Value, name: string, label: string): Invoke => {
  const target = value instanceof Obj ? value : primitivePrototype(builtins, value)
  if (target === undefined) throw typeError(`${label} called on null or undefined.`)
  return new Invoke(get(target, name), value, [], undefined)
}

export function* toPrimitiveString<R>(ctx: Interpreter<R>, value: Value): Eval<string> {
  return coerceToString(yield* toPrimitive(ctx, value, "string"))
}

export function* toPrimitiveNumber<R>(ctx: Interpreter<R>, value: Value): Eval<number> {
  return coerceToNumber(yield* toPrimitive(ctx, value, "number"))
}

/**
 * The conversions a built-in received, while it runs again after them: by ordinal, the order its `withPrimitives`
 * calls run in. The machine resets `count` before every built-in call.
 */
export const conversions: { count: number; replay: Array<Array<Value> | undefined> | undefined } = {
  count: 0,
  replay: undefined,
}

/**
 * Runs a native body on values after ToPrimitive, in order, with one hint for all positions or one per position.
 * Primitive values skip the conversion entirely. Otherwise the built-in asks the machine for the conversions (they
 * call program code, so they run as a frame) and runs again from the start once they are done; this call then
 * receives them. So everything a built-in does before its last conversion must be repeatable: it reads, checks, and
 * throws, but changes nothing. State the body needs as it was before the conversions (a Date's time) goes in `values`.
 * With `coerce`, each value is also converted to a number or string (by its hint) before the next one is.
 */
export const withPrimitives = (
  hints: Hints,
  values: Array<Value>,
  body: (primitives: Array<Value>) => NativeResult,
  coerce = false,
): NativeResult => {
  const ordinal = conversions.count++
  const replayed = conversions.replay?.[ordinal]
  if (replayed !== undefined) return body(replayed)
  if (!values.some((value) => value instanceof Obj)) return body(values)
  return new Convert(hints, values, ordinal, coerce)
}

/** Checks a callback argument: the callable it is, or the TypeError for one a callback site does not admit. */
export const requireCallback = (callback: Value, name: string): Callable => {
  if (isSupportedCallback(callback)) return callback
  if (typeofValue(callback) === "function") {
    throw typeError(
      `${name} cannot use this callable as a callback; wrap it in an arrow function, e.g. (value) => tools.ns.tool(value).`,
    )
  }
  throw typeError(`${name} expects a function callback.`)
}

// The single acceptance list for callbacks: collections, sort, string replacers,
// Array.from mappers, and promise reactions all admit exactly these callables.
// Admission means dispatchable, not necessarily invocable: new-requiring
// constructors pass the gate and throw a TypeError on call, like JS.
export const isSupportedCallback = (value: Value): value is Callable =>
  value instanceof Callable && !(value instanceof Builtin && !value.callback)

export const applyCollectionCallback = <R>(
  ctx: Interpreter<R>,
  callback: Value,
  name: string,
): ((args: Array<Value>, thisValue?: Value) => Eval<Value>) => {
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
