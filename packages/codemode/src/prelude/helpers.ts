import { isSupportedCallback, requireCallback } from "../runtime/callback.js"
import type { Builtins } from "../runtime/intrinsics.js"
import { SORT_RUN, sorted, type SortInto } from "../stdlib/array.js"
import { finishBytes } from "../stdlib/bytes.js"
import { weakKey } from "../stdlib/collections.js"
import { buildPairs } from "../stdlib/url.js"
import type { Interpreter } from "../runtime/interpreter.js"
import { checkArrayLength } from "../runtime/limits.js"
import { invalidData, IteratorSymbol, PendingThrow } from "../runtime/model.js"
import { native, receiver } from "../runtime/native.js"
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
  MapObj,
  type NativeResult,
  Obj,
  PromiseObj,
  SetObj,
  type Value,
  WeakMapObj,
  WeakSetObj,
} from "../runtime/objects.js"
import { builtinCursor, requireIteratorObject } from "../runtime/operations.js"
import { containsOpaqueReference, describeValue, isOpaque } from "../runtime/references.js"
import { compareText } from "../tool-runtime.js"
import { Invoke } from "../runtime/signals.js"

// The prelude's privileged helpers: leaf built-ins (they never call program code) bound only in the prelude's scope.

type Helper = readonly [length: number, call: (args: Array<Value>) => NativeResult]

const classes = { Array: Arr, Uint8Array: Bytes, Map: MapObj, Set: SetObj } as const

// Bun exposes ES2026 Math.sumPrecise before TypeScript's standard library types.
declare global {
  interface Math {
    sumPrecise(values: Iterable<number>): number
  }
}

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
    /**
     * An iterator object as `for...of` steps it, reading `next` once and calling it only then (GetIteratorDirect);
     * with `arrays`, an array's values.
     */
    $Direct: [
      2,
      ([value, arrays]) =>
        arrays === true && value instanceof Arr
          ? positionIterator(builtins, value, "values")
          : value instanceof IteratorObj
            ? value
            : new IteratorObj(builtins.Iterator, {
                iterator: requireIteratorObject(value, "An iterator"),
                next: get(value as Obj, "next"),
                asynchronous: false,
              }),
    ],
    /** A sort's result written where it goes (see `sortWith`): the defined values in order, then `undefs` undefined. */
    $Sorted: [
      5,
      ([target, into, holes, values, undefs]) =>
        sorted(builtins, target as Arr | Bytes, into as SortInto, holes as number, [
          ...(values as Arr).items,
          ...Array<Value>(undefs as number).fill(undefined),
        ]),
    ],
    /** Ends one merge of `sortWith`: the runs' remaining values after the merged ones, then all of them back in `work`. */
    $MergeRest: [
      8,
      ([work, merged, count, left, middle, right, high, low]) => {
        const items = (work as Arr).items
        const out = (merged as Arr).items
        out.length = count as number
        for (let at = left as number; at < (middle as number); at++) out.push(items[at])
        for (let at = right as number; at < (high as number); at++) out.push(items[at])
        for (let at = 0; at < out.length; at++) items[(low as number) + at] = out[at]
        return undefined
      },
    ],
    $SortState: [1, ([values]) => sortState(builtins, values as Arr)],
    $SortStep: [1, ([state]) => sortStep(state as Arr)],
    $SortResult: [
      2,
      ([state, values]) => {
        const items = (values as Arr).items
        return new Arr(
          builtins.Array,
          ((state as Arr).items[1] as Arr).items.map((at) => items[at as number]),
        )
      },
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

// The most values one merge step writes.
const MERGE_STEP = 65_536

/**
 * A default sort's state, as data: the values' string keys, the order so far and a buffer (indices into the values),
 * the next run to sort, and the merge pass's run width, output position, and positions in its two runs. Runs of
 * SORT_RUN are sorted first, then merged in passes of doubling width from the order into the buffer, which swap.
 */
const sortState = (builtins: Builtins, values: Arr): Arr => {
  const keys = values.items.map(coerceToString)
  const order = keys.map((_, at) => at)
  return new Arr(builtins.Array, [
    new Arr(builtins.Array, keys),
    new Arr(builtins.Array, order),
    new Arr(builtins.Array, [...order]),
    0,
    SORT_RUN,
    0,
    0,
    0,
  ])
}

// One bounded step of a default sort: one run sorted, or up to MERGE_STEP values merged. Whether work remains.
const sortStep = (state: Arr): boolean => {
  const slots = state.items
  const keys = (slots[0] as Arr).items as Array<string>
  const from = (slots[1] as Arr).items as Array<number>
  const length = keys.length
  const run = slots[3] as number
  const width = slots[4] as number
  const compare = (left: number, right: number) => compareText(keys[left]!, keys[right]!)
  if (run < length) {
    const end = Math.min(run + SORT_RUN, length)
    const part = from.slice(run, end).sort(compare)
    for (let at = 0; at < part.length; at++) from[run + at] = part[at]!
    slots[3] = end
    return end < length || width < length
  }
  const to = (slots[2] as Arr).items as Array<number>
  let out = slots[5] as number
  let left = slots[6] as number
  let right = slots[7] as number
  const stop = Math.min(out + MERGE_STEP, length)
  while (out < stop) {
    const low = out - (out % (2 * width))
    const middle = Math.min(low + width, length)
    const high = Math.min(low + 2 * width, length)
    if (out === low) {
      left = low
      right = middle
    }
    while (out < high && out < stop) {
      to[out++] =
        left < middle && (right >= high || compare(from[left]!, from[right]!) <= 0) ? from[left++]! : from[right++]!
    }
  }
  if (out === length) {
    const merged = slots[2]
    slots[2] = slots[1]
    slots[1] = merged
    slots[4] = width * 2
    out = 0
  }
  slots[5] = out
  slots[6] = left
  slots[7] = right
  return (slots[4] as number) < length
}
