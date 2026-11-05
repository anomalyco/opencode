import { isSupportedCallback, requireCallback } from "../interpreter/callback.js"
import type { Builtins } from "../interpreter/intrinsics.js"
import { iterateDirect } from "../machine/iteration.js"
import { finishBytes } from "../stdlib/bytes.js"
import { weakKey } from "../stdlib/collections.js"
import { buildPairs } from "../stdlib/url.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { checkArrayLength } from "../interpreter/limits.js"
import { invalidData, IteratorSymbol, PendingThrow } from "../interpreter/model.js"
import { native, receiver } from "../interpreter/native.js"
import {
  Arr,
  Bytes,
  coerceToString,
  data,
  define,
  hidden,
  hasPrototype,
  keys,
  getOwn,
  IteratorObj,
  positionIterator,
  coerceToNumber,
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
import { containsOpaqueReference, describeValue, isOpaque } from "../interpreter/references.js"
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
  const helpers: Record<string, Helper> = {
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
    /** Whether `value` is an object; with `data`, one holding no opaque reference. */
    $IsObject: [2, ([value, data]) => value instanceof Obj && !(data === true && containsOpaqueReference(value))],
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
    $Describe: [1, ([value]) => describeValue(value)],
    $Inherits: [2, ([value, proto]) => hasPrototype(value, proto as Obj)],
    /** An iterator wrapped as `Iterator.from` returns it. */
    $Wrap: [1, ([value]) => new IteratorObj(builtins.IteratorHelper, iterateDirect(value, undefined))],
    /** An object's own enumerable string keys. */
    $Keys: [1, ([value]) => new Arr(builtins.Array, keys(value as Obj))],
    /** Defines an own data property, enumerable or hidden, and returns the object. */
    $Define: [
      4,
      ([target, key, value, enumerable]) => {
        define(target as Obj, key as string, value, enumerable === true ? data : hidden)
        return target
      },
    ],
    $SumPrecise: [1, ([numbers]) => Math.sumPrecise((numbers as Arr).items as Array<number>)],
    /** A Uint8Array of the values (see `collectBytes`). */
    $Bytes: [
      3,
      ([values, into, offset]) => {
        const items = (values as Arr).items
        checkArrayLength(items.length)
        return finishBytes(Uint8Array.from(items, coerceToNumber), into as Obj, offset as number)
      },
    ],
    /** Headers or URLSearchParams from the pairs `readPairs` read, or from a record. */
    $Pairs: [
      4,
      ([kind, proto, value, label]) =>
        buildPairs({ kind: kind as "Headers", proto: proto as Obj }, value, String(label)),
    ],
    $IsCallable: [1, ([value]) => isSupportedCallback(value)],
    /** An iterator object as `for...of` steps it, reading `next` once (GetIteratorDirect); with `arrays`, an array's values. */
    $Direct: [
      2,
      ([value, arrays]) =>
        arrays === true && value instanceof Arr
          ? positionIterator(builtins, value, "values")
          : new IteratorObj(builtins.Iterator, iterateDirect(value, undefined)),
    ],
    /** What the collection built-ins need from a Map, Set, WeakMap, or WeakSet's table; see `table`. */
    $Table: [4, ([op, target, key, value]) => table(builtins, String(op), target, key, value)],
  }
  return Object.entries(helpers).map(([name, [length, call]]) => [
    name,
    native(builtins, { name, length, call: (_, args) => call(args), callback: false }),
  ])
}

const table = (builtins: Builtins, op: string, target: Value, key: Value, value: Value): Value => {
  switch (op) {
    case "add":
      if (target instanceof MapObj) target.map.set(key, value)
      else if (target instanceof SetObj) target.set.add(key)
      else if (target instanceof WeakMapObj) target.map.set(weakKey(key, "as weak map key"), value)
      else (target as WeakSetObj).set.add(weakKey(key, "in weak set"))
      return undefined
    case "delete":
      return (target as SetObj).set.delete(key)
    case "has":
      return (target as SetObj).set.has(key)
    case "size":
      return (target as SetObj).set.size
    case "copy": {
      const copy = new SetObj(builtins.Set)
      for (const item of (target as SetObj).set.liveKeys()) copy.set.add(item)
      return copy
    }
    case "values":
      return positionIterator(builtins, target as SetObj, "values")
    case "entries":
      return positionIterator(builtins, target as MapObj | SetObj, "entries")
    case "groups":
      return target === "Map" ? new MapObj(builtins.Map) : new Obj(null)
    case "groupKey":
      if (target instanceof PromiseObj) return coerceToString(target)
      if (isOpaque(target)) {
        throw invalidData(`Object.groupBy callback must return a data value, received ${describeValue(target)}.`)
      }
      return target
    case "group": {
      if (target instanceof MapObj) {
        const group = target.map.get(key)
        if (group === undefined) target.map.set(key, new Arr(builtins.Array, [value]))
        else (group as Arr).items.push(value)
        return undefined
      }
      const group = getOwn(target as Obj, key as string)
      if (group === undefined) define(target as Obj, key as string, new Arr(builtins.Array, [value]))
      else (group as Arr).items.push(value)
      return undefined
    }
  }
  throw new Error(`Unknown table operation ${op}.`)
}
