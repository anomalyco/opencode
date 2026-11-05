import { Invoke } from "../interpreter/signals.js"
import type { Builtins } from "../interpreter/intrinsics.js"
import { constructor, methods, prototypeFrom, receiver } from "../interpreter/native.js"
import { checkArrayLength, checkStringLength, MAX_ARRAY_LENGTH } from "../interpreter/limits.js"
import { IteratorSymbol, rangeError, typeError } from "../interpreter/model.js"
import {
  define,
  get,
  hidden,
  Arr,
  Bytes,
  positionIterator,
  Obj,
  type NativeResult,
  coerceToInteger,
  coerceToNumber,
  coerceToString,
  rejectAddition,
  type Value,
} from "../interpreter/objects.js"
import { rejectCircularInsertion } from "../interpreter/references.js"
import { withPrimitives } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { compareText } from "../tool-runtime.js"

/** Where a sort with a comparator puts its result: back into an array or bytes, or into a new array. */
type SortInto = "Array.sort" | "Array.toSorted" | "Uint8Array.sort"

/**
 * Sorts `target`'s values: at once without a comparator, otherwise in the prelude, which calls it. Holes and undefined
 * values sort last without being compared.
 */
export const sortArray = <R>(ctx: Interpreter<R>, target: Arr | Bytes, comparator: Value, into: SortInto): NativeResult => {
  if (comparator !== undefined) return new Invoke(ctx.prelude.fn("sortWith"), undefined, [target, comparator, into], undefined)
  const items = target instanceof Arr ? [...target.items] : [...target.bytes]
  let holes = 0
  if (target instanceof Arr) for (let index = 0; index < items.length; index++) if (!(index in target.items)) holes++
  const result = items.sort((a, b) => compareText(coerceToString(a), coerceToString(b)))
  return sorted(ctx.builtins, target, into, holes, result)
}

export const sorted = (builtins: Builtins, target: Arr | Bytes, into: SortInto, holes: number, result: Array<Value>) => {
  if (target instanceof Bytes) {
    target.bytes.set(Uint8Array.from(result, coerceToNumber))
    return target
  }
  if (into === "Array.toSorted") return new Arr(builtins.Array, result)
  const items = target.items
  const count = result.length - holes
  result.slice(0, count).forEach((item, index) => {
    items[index] = item
  })
  Array.from({ length: holes }, (_, index) => count + index).forEach((index) => {
    delete items[index]
  })
  return target
}

// Array constructs identically with or without new, like JS.
export const arrayGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Array
  const wrap = (items: Array<Value>) => new Arr(proto, items)
  const construct = (args: Array<Value>, into: Obj): Arr => {
    if (args.length !== 1) return new Arr(into, [...args])
    const first = args[0]
    if (typeof first !== "number") return new Arr(into, [first])
    if (!Number.isInteger(first) || first < 0 || first > MAX_ARRAY_LENGTH) throw rangeError("Invalid array length.")
    // Sparse like JS: Array(3) has holes, and combinator loops already skip them.
    return new Arr(into, new Array(first))
  }
  const array = constructor(builtins, proto, {
    name: "Array",
    length: 1,
    call: (_, args) => construct(args, proto),
    construct: (args, newTarget) => construct(args, prototypeFrom(newTarget, proto)),
  })
  methods(builtins, array, [
    ["isArray", 1, (_, args) => args[0] instanceof Arr],
    ["of", 0, (_, args) => wrap([...args])],
  ])

  const self = (thisValue: Value, name: string) => receiver(Arr, thisValue, `Array.prototype.${name}`)
  // A mutating method fails where its first element write, delete, or `length` write would on a frozen, sealed, or
  // non-extensible array. `growth` is given by the methods that always write `length`, even when it is 0; holes a
  // method would fill on a non-extensible array are not checked.
  const mutable = (target: Arr, growth?: number): Arr => {
    const length = target.items.length
    if ((growth ?? 0) > 0) rejectAddition(target, length)
    if ((growth ?? 0) < 0 && length > 0 && !target.elements.configurable) {
      throw typeError(`Cannot delete property '${length - 1}'.`)
    }
    if (!target.elements.writable && (length > 0 || growth !== undefined)) {
      throw typeError(`Cannot assign to read only property '${length > 0 ? 0 : "length"}'.`)
    }
    return target
  }
  const optNumber = (value: Value): number | undefined => (value === undefined ? undefined : coerceToInteger(value))

  methods(builtins, proto, [
    [
      "join",
      1,
      (thisValue, args) => {
        // .map would keep holes, which the conversion would then hand to the body as undefined.
        const parts = Array.from(self(thisValue, "join").items, (item) => item ?? "")
        return withPrimitives("string", [args[0] === undefined ? "," : args[0], ...parts], ([separator, ...items]) => {
          const joined = items.map(coerceToString).join(coerceToString(separator))
          checkStringLength(joined.length)
          return joined
        })
      },
    ],
    [
      "toString",
      0,
      (thisValue) =>
        withPrimitives(
          "string",
          Array.from(self(thisValue, "toString").items, (item) => item ?? ""),
          (items) => items.map(coerceToString).join(","),
        ),
    ],
    [
      "includes",
      1,
      (thisValue, args) => {
        return self(thisValue, "includes").items.includes(args[0], optNumber(args[1]))
      },
    ],
    ["indexOf", 1, (thisValue, args) => self(thisValue, "indexOf").items.indexOf(args[0], optNumber(args[1]))],
    [
      "lastIndexOf",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "lastIndexOf").items
        // An explicit undefined is a fromIndex of 0, unlike omitting it.
        return args.length < 2 ? target.lastIndexOf(args[0]) : target.lastIndexOf(args[0], optNumber(args[1]))
      },
    ],
    ["at", 1, (thisValue, args) => self(thisValue, "at").items.at(optNumber(args[0]) ?? 0)],
    [
      "slice",
      2,
      (thisValue, args) => wrap(self(thisValue, "slice").items.slice(optNumber(args[0]), optNumber(args[1]))),
    ],
    [
      "concat",
      1,
      (thisValue, args) => {
        const joined = self(thisValue, "concat").items.concat(
          ...args.map((item) => (item instanceof Arr ? item.items : item)),
        )
        checkArrayLength(joined.length)
        return wrap(joined)
      },
    ],
    [
      "flat",
      0,
      (thisValue, args) => {
        const flatten = (items: Array<Value>, depth: number): Array<Value> =>
          items.flatMap((item) => (item instanceof Arr && depth > 0 ? flatten(item.items, depth - 1) : [item]))
        const flattened = flatten(self(thisValue, "flat").items, optNumber(args[0]) ?? 1)
        checkArrayLength(flattened.length)
        return wrap(flattened)
      },
    ],
    [
      "reverse",
      0,
      (thisValue) => {
        const target = self(thisValue, "reverse")
        // Fewer than two elements means no writes at all, so a frozen one-element array reverses fine.
        if (target.items.length > 1) mutable(target)
        target.items.reverse()
        return target
      },
    ],
    ["sort", 1, (thisValue, args) => sortArray(ctx, mutable(self(thisValue, "sort")), args[0], "Array.sort")],
    ["toSorted", 1, (thisValue, args) => sortArray(ctx, self(thisValue, "toSorted"), args[0], "Array.toSorted")],
    ["toReversed", 0, (thisValue) => wrap([...self(thisValue, "toReversed").items].reverse())],
    [
      "with",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "with").items
        const index = optNumber(args[0]) ?? 0
        const resolved = index < 0 ? target.length + index : index
        if (resolved < 0 || resolved >= target.length) throw rangeError("Array.with index is out of range.")
        const copied = [...target]
        copied[resolved] = args[1]
        return wrap(copied)
      },
    ],
    [
      "push",
      1,
      (thisValue, args) => {
        const target = mutable(self(thisValue, "push"), args.length)
        // Validate all insertions before mutating to avoid partial cyclic updates.
        for (const item of args) rejectCircularInsertion(target, item, "Array.push result")
        return target.items.push(...args)
      },
    ],
    [
      "unshift",
      1,
      (thisValue, args) => {
        const target = mutable(self(thisValue, "unshift"), args.length)
        for (const item of args) rejectCircularInsertion(target, item, "Array.unshift result")
        return target.items.unshift(...args)
      },
    ],
    ["pop", 0, (thisValue) => mutable(self(thisValue, "pop"), -1).items.pop()],
    ["shift", 0, (thisValue) => mutable(self(thisValue, "shift"), -1).items.shift()],
    [
      "splice",
      2,
      (thisValue, args) => {
        const target = self(thisValue, "splice")
        const length = target.items.length
        const start = optNumber(args[0]) ?? 0
        const from = start < 0 ? Math.max(length + start, 0) : Math.min(start, length)
        const deleteCount =
          args.length === 1 ? length - from : Math.min(Math.max(optNumber(args[1]) ?? 0, 0), length - from)
        const inserted = args.slice(2)
        for (const item of inserted) rejectCircularInsertion(target, item, "Array.splice result")
        mutable(target, inserted.length - deleteCount)
        return wrap(target.items.splice(from, deleteCount, ...inserted))
      },
    ],
    [
      "toSpliced",
      2,
      (thisValue, args) => {
        const copied = [...self(thisValue, "toSpliced").items]
        if (args.length === 0) return wrap(copied)
        const start = optNumber(args[0]) ?? 0
        if (args.length === 1) copied.splice(start)
        else copied.splice(start, optNumber(args[1]) ?? 0, ...args.slice(2))
        return wrap(copied)
      },
    ],
    [
      "fill",
      1,
      (thisValue, args) => {
        const target = mutable(self(thisValue, "fill"))
        rejectCircularInsertion(target, args[0], "Array.fill result")
        target.items.fill(args[0], optNumber(args[1]), optNumber(args[2]))
        return target
      },
    ],
    [
      "copyWithin",
      2,
      (thisValue, args) => {
        const target = mutable(self(thisValue, "copyWithin"))
        target.items.copyWithin(optNumber(args[0]) ?? 0, optNumber(args[1]) ?? 0, optNumber(args[2]))
        return target
      },
    ],
    ["keys", 0, (thisValue) => positionIterator(builtins, self(thisValue, "keys"), "keys")],
    ["values", 0, (thisValue) => positionIterator(builtins, self(thisValue, "values"), "values")],
    ["entries", 0, (thisValue) => positionIterator(builtins, self(thisValue, "entries"), "entries")],
  ])
  define(proto, IteratorSymbol, get(proto, "values"), hidden)
  return array
}
