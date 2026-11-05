import { requireCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { checkArrayLength } from "../interpreter/limits.js"
import { invalidData, IteratorSymbol, PendingThrow } from "../interpreter/model.js"
import { native, receiver } from "../interpreter/native.js"
import {
  Arr,
  Bytes,
  coerceToInteger,
  coerceToNumber,
  GeneratorObj,
  get,
  HeadersObj,
  MapObj,
  type NativeResult,
  Obj,
  PromiseObj,
  SetObj,
  URLSearchParamsObj,
  type Value,
  WeakMapObj,
  WeakSetObj,
} from "../interpreter/objects.js"
import { builtinCursor } from "../interpreter/operations.js"
import { describeValue } from "../interpreter/references.js"
import { Invoke } from "../interpreter/signals.js"

// The prelude's privileged helpers: leaf built-ins (they never call program code) bound only in the prelude's scope.

type Helper = readonly [length: number, call: (args: Array<Value>) => NativeResult]

const classes = {
  Array: Arr,
  Uint8Array: Bytes,
  Map: MapObj,
  Set: SetObj,
  WeakMap: WeakMapObj,
  WeakSet: WeakSetObj,
  Headers: HeadersObj,
  URLSearchParams: URLSearchParamsObj,
} as const

export const helpers = (ctx: Interpreter<unknown>): Array<readonly [string, Value]> => {
  const builtins = ctx.builtins
  const table: Record<string, Helper> = {
    /** Throws a program error of `type` ("TypeError", "RangeError", or "InvalidData") with `message`. */
    $Throw: [
      2,
      ([type, message]) => {
        if (type === "InvalidData") throw invalidData(String(message))
        throw new PendingThrow(type as "TypeError", String(message))
      },
    ],
    /** The callback itself, or the TypeError for one a callback site doesn't admit. */
    $Callback: [2, ([value, label]) => requireCallback(value, String(label))],
    /** Calls `fn` with a receiver and arguments, as `Function.prototype.call` would, without reading `call`. */
    $Call: [2, ([fn, thisArg, ...args]) => new Invoke(fn, thisArg, args, undefined)],
    /** The receiver, when it is the built-in kind `kind` names, or the TypeError for any other. */
    $Receiver: [
      3,
      ([value, kind, method]) => receiver<Obj>(classes[kind as keyof typeof classes], value, String(method)),
    ],
    $IsObject: [1, ([value]) => value instanceof Obj],
  }
  return Object.entries(table).map(([name, [length, call]]) => [
    name,
    native(builtins, { name, length, call: (_, args) => call(args), callback: false }),
  ])
}
