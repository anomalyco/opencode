import type { Builtins } from "./intrinsics.js"
import { typeError } from "./model.js"
import {
  type Callable,
  define,
  frozen,
  hidden,
  Native,
  type NativeCall,
  type NativeOptions,
  Obj,
  type Value,
} from "./objects.js"
import { describeValue } from "./references.js"

/** A native function body: a value, a thrown `PendingThrow`, or interpreter work producing a value. */
export type Impl = NativeCall

export const native = (builtins: Builtins, options: NativeOptions): Native => new Native(builtins.Function, options)

export const fn = (builtins: Builtins, name: string, length: number, impl: Impl): Native =>
  native(builtins, { name, length, call: impl })

export type Method = readonly [name: string, length: number, impl: Impl]

export const methods = (builtins: Builtins, target: Obj, table: ReadonlyArray<Method>): void => {
  for (const [name, length, impl] of table) define(target, name, fn(builtins, name, length, impl), hidden)
}

export const constants = (target: Obj, table: Record<string, Value>): void => {
  for (const [name, value] of Object.entries(table)) define(target, name, value, frozen)
}

/** A constructor wired to its prototype: `C.prototype === proto` and `proto.constructor === C`. */
export const constructor = (builtins: Builtins, proto: Obj, options: NativeOptions): Native => {
  const ctor = native(builtins, options)
  define(ctor, "prototype", proto, frozen)
  define(proto, "constructor", ctor, hidden)
  return ctor
}

/** The `call` of a constructor that JS requires to be invoked with `new`. */
export const requiresNew = (name: string) => (): never => {
  throw typeError(`Constructor ${name} requires 'new'.`)
}

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
