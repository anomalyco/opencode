import { type Builtins, primitivePrototype } from "./intrinsics.js"
import { typeError } from "./model.js"
import { Callable, get, Builtin, Obj, type NativeResult, type Value } from "./objects.js"
import { typeofValue } from "./references.js"
import { Convert, type Hints, Invoke } from "./signals.js"

/** Invoke(value, name), as the call to make: the method the value would find through its prototype. */
export const invokeMethod = (builtins: Builtins, value: Value, name: string, label: string): Invoke => {
  const target = value instanceof Obj ? value : primitivePrototype(builtins, value)
  if (target === undefined) throw typeError(`${label} called on null or undefined.`)
  return new Invoke(get(target, name), value, [], undefined)
}

/**
 * The conversions a built-in received, while it runs again after them: by ordinal, the order its `withPrimitives`
 * calls run in. The VM resets `count` before every built-in call.
 */
export const conversions: { count: number; replay: Array<Array<Value> | undefined> | undefined } = {
  count: 0,
  replay: undefined,
}

/**
 * Runs a native body on values after ToPrimitive, in order, with one hint for all positions or one per position.
 * Primitive values skip the conversion entirely. Otherwise the built-in asks the VM for the conversions (they
 * call program code, so they run as prelude code) and runs again from the start once they are done; this call then
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
