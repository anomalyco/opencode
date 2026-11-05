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
import { sorted } from "../stdlib/array.js"

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
    $IsArray: [1, ([value]) => value instanceof Arr],
    /** Whether `for...of` can iterate `value`. */
    $IsIterable: [
      1,
      ([value]) => {
        if (builtinCursor(builtins, value) !== undefined) return true
        if (!(value instanceof Obj)) return false
        const method = get(value, IteratorSymbol)
        return method !== undefined && method !== null
      },
    ],
    /** The length of an array-like `Array.from` source. */
    $ArrayLikeLength: [
      1,
      ([value]) => {
        if (value instanceof GeneratorObj || !(value instanceof Obj) || value instanceof PromiseObj) {
          throw invalidData(`Array.from expects an iterable or array-like value, received ${describeValue(value)}.`)
        }
        const length = Math.max(0, coerceToInteger(get(value, "length")))
        checkArrayLength(length)
        return length
      },
    ],
    /** Appends `value` to `target`, or each element of an array `value` (skipping holes), as `flatMap` does. */
    $Append: [
      2,
      ([target, value]) => {
        const items = (target as Arr).items
        if (value instanceof Arr) value.items.forEach((item) => items.push(item))
        else items.push(value)
        checkArrayLength(items.length)
        return undefined
      },
    ],
    /** A new Uint8Array of the values of an array, each converted to a byte. */
    $Bytes: [1, ([values]) => new Bytes(builtins.Uint8Array, Uint8Array.from((values as Arr).items, coerceToNumber))],
    /**
     * What a sort with a comparator works on, taken before the comparator runs: the values that are neither holes nor
     * undefined, the hole count, and the length.
     */
    $SortItems: [
      1,
      ([target]) => {
        const items = target instanceof Arr ? target.items : [...(target as Bytes).bytes]
        let holes = 0
        if (target instanceof Arr) for (let index = 0; index < items.length; index++) if (!(index in items)) holes++
        const values = new Arr(builtins.Array, [...items].filter((item) => item !== undefined))
        return new Arr(builtins.Array, [values, holes, items.length])
      },
    ],
    /** Puts sorted values back: into the array or bytes in place, or into a new array (`into` is "Array.toSorted"). */
    $Sorted: [
      5,
      ([target, into, values, length, holes]) => {
        const items = [...(values as Arr).items]
        while (items.length < (length as number)) items.push(undefined)
        return sorted(builtins, target as Arr | Bytes, into as never, holes as number, items)
      },
    ],
  }
  return Object.entries(table).map(([name, [length, call]]) => [
    name,
    native(builtins, { name, length, call: (_, args) => call(args), callback: false }),
  ])
}
