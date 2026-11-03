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
  type NativeResult,
  type Value,
} from "./objects.js"
import { isOpaque, typeofValue } from "./references.js"
import { type Eval, Interruption, isEval } from "./runner.js"

/** IteratorClose: a consumer failure closes the iterator and wins over any close failure, except that a generator's
 * return() is a return completion, so a failing close wins over it, as after `break`. */
export function* preserveConsumerError<A>(close: Cursor["close"], body: Eval<A>): Eval<A> {
  try {
    return yield* body
  } catch (error) {
    if (error instanceof Interruption) throw error
    try {
      yield* close()
    } catch (closed) {
      if (error instanceof GeneratorReturn) throw closed
    }
    throw error
  }
}

export type Hint = "number" | "string" | "default"

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

export function* toPrimitiveString<R>(ctx: Interpreter<R>, value: Value): Eval<string> {
  return coerceToString(yield* toPrimitive(ctx, value, "string"))
}

export function* toPrimitiveNumber<R>(ctx: Interpreter<R>, value: Value): Eval<number> {
  return coerceToNumber(yield* toPrimitive(ctx, value, "number"))
}

/**
 * Runs a native body on its arguments after ToPrimitive, in order, with one hint for all positions or one per
 * position. Primitive arguments skip the conversion entirely.
 */
export const withPrimitives = <R>(
  ctx: Interpreter<R>,
  hints: Hint | ReadonlyArray<Hint>,
  values: Array<Value>,
  body: (primitives: Array<Value>) => NativeResult,
): NativeResult => {
  if (!values.some((value) => value instanceof Obj)) return body(values)
  return (function* () {
    const primitives: Array<Value> = []
    for (const [index, value] of values.entries()) {
      primitives.push(yield* toPrimitive(ctx, value, typeof hints === "string" ? hints : hints[index]!))
    }
    const result = body(primitives)
    return isEval(result) ? yield* result : result
  })()
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
