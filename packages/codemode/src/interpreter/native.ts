import { Effect } from "effect"
import type { Builtins } from "./intrinsics.js"
import { typeError } from "./model.js"
import { type Callable, define, frozen, hidden, Native, type NativeOptions, Obj, type Value } from "./objects.js"
import { describeValue } from "./references.js"

/** A native function body: a value, a thrown `PendingThrow`, or an Effect of a value. */
export type Impl = (thisValue: Value, args: Array<Value>) => Value | Effect.Effect<Value, unknown, unknown>

// The dispatch in `Frame.call` suspends every native call, so a synchronous throw here is a defect.
const lift =
  <R>(impl: Impl) =>
  (thisValue: Value, args: Array<Value>): Effect.Effect<Value, unknown, R> => {
    const result = impl(thisValue, args)
    return Effect.isEffect(result) ? (result as Effect.Effect<Value, unknown, R>) : Effect.succeed(result)
  }

export const native = <R>(builtins: Builtins, options: NativeOptions<R>): Native<R> =>
  new Native<R>(builtins.Function, options)

export const fn = <R>(builtins: Builtins, name: string, length: number, impl: Impl): Native<R> =>
  native<R>(builtins, { name, length, call: lift(impl) })

export type Method = readonly [name: string, length: number, impl: Impl]

export const methods = (builtins: Builtins, target: Obj, table: ReadonlyArray<Method>): void => {
  for (const [name, length, impl] of table) define(target, name, fn(builtins, name, length, impl), hidden)
}

export const constants = (target: Obj, table: Record<string, Value>): void => {
  for (const [name, value] of Object.entries(table)) define(target, name, value, frozen)
}

/** A constructor wired to its prototype: `C.prototype === proto` and `proto.constructor === C`. */
export const constructor = <R>(builtins: Builtins, proto: Obj, options: NativeOptions<R>): Native<R> => {
  const ctor = native<R>(builtins, options)
  define(ctor, "prototype", proto, frozen)
  define(proto, "constructor", ctor, hidden)
  return ctor
}

/** The `call` of a constructor that JS requires to be invoked with `new`. */
export const requiresNew = (name: string) => (): Effect.Effect<never, unknown, never> =>
  Effect.sync(() => {
    throw typeError(`Constructor ${name} requires 'new'.`)
  })

/** The instance prototype for `new` via `newTarget.prototype`, falling back to the built-in's own. */
export const prototypeFrom = (newTarget: Callable, fallback: Obj): Obj => {
  const proto = newTarget.props.get("prototype")
  return proto !== undefined && "value" in proto && proto.value instanceof Obj ? proto.value : fallback
}

/** Narrows a method receiver to the built-in it belongs to, or throws the TypeError JS would. */
export const receiver = <T extends Obj>(
  cls: abstract new (...args: never) => T,
  thisValue: Value,
  method: string,
): T => {
  if (thisValue instanceof cls) return thisValue
  throw typeError(`${method} called on incompatible receiver ${describeValue(thisValue)}.`)
}
