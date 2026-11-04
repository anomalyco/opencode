import { consumer, nativeKind, STATE } from "../machine/native-kind.js"
import { Push } from "../interpreter/signals.js"
import { PENDING } from "../machine/frame.js"
import { Drain, drain } from "../machine/natives.js"
import type { MachineTask } from "../machine/task.js"
import type { Builtins } from "../interpreter/intrinsics.js"
import { builtinCursor } from "../interpreter/operations.js"
import { constructor, type Method, methods, prototypeFrom, receiver } from "../interpreter/native.js"
import { checkArrayLength, checkStringLength, MAX_ARRAY_LENGTH } from "../interpreter/limits.js"
import { invalidData, IteratorSymbol, rangeError, typeError } from "../interpreter/model.js"
import {
  define,
  get,
  hidden,
  Arr,
  Bytes,
  type Callable,
  GeneratorObj,
  positionIterator,
  Obj,
  PromiseObj,
  coerceToInteger,
  coerceToNumber,
  coerceToString,
  rejectAddition,
  type Value,
} from "../interpreter/objects.js"
import { describeValue, rejectCircularInsertion } from "../interpreter/references.js"
import { invokeMethod, requireCallback, withPrimitives } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { compareText } from "../tool-runtime.js"

const arrayLikeSource = (source: Value): { readonly length: number; readonly source: Obj } => {
  // JS would treat a promise as an empty array-like; that would hide a missing `await`.
  if (source instanceof Obj && !(source instanceof PromiseObj)) {
    const length = Math.max(0, coerceToInteger(get(source, "length")))
    checkArrayLength(length)
    return { length, source }
  }
  throw invalidData(`Array.from expects an iterable or array-like value, received ${describeValue(source)}.`)
}

const iterable = (builtins: Builtins, value: Value) => {
  if (builtinCursor(builtins, value) !== undefined) return true
  if (!(value instanceof Obj)) return false
  const method = get(value, IteratorSymbol)
  return method !== undefined && method !== null
}

const arrayFrom = <R>(ctx: Interpreter<R>, args: Array<Value>): Push => {
  const source = args[0]
  const mapper = args.length < 2 || args[1] === undefined ? undefined : requireCallback(args[1], "Array.from")
  if (iterable(ctx.builtins, source)) return new Push(Drain, drain(ArrayFrom, source, [mapper, args[2], []]))
  if (source instanceof GeneratorObj) {
    throw typeError(`Array.from expects a synchronous iterable or array-like value, received ${describeValue(source)}.`)
  }
  const arrayLike = arrayLikeSource(source)
  return new Push(ArrayFromArrayLike, [arrayLike.source, arrayLike.length, mapper, args[2], 0, []])
}

// State: the mapper, its `this`, and the values so far.
const ArrayFrom = consumer({
  name: "Array.from",
  each: (task, frame, value, index) => {
    const slots = frame.slots
    const values = slots[STATE + 2] as Array<Value>
    const mapper = slots[STATE] as Callable | undefined
    if (mapper === undefined) return values.push(value)
    const mapped = task.call(mapper, slots[STATE + 1] as Value, [value, index], frame.node)
    if (mapped === PENDING) return PENDING
    return values.push(mapped)
  },
  resume: (_task, frame, input) => (frame.slots[STATE + 2] as Array<Value>).push(input as Value),
  done: (task, frame) => new Arr(task.ctx.builtins.Array, frame.slots[STATE + 2] as Array<Value>),
})

// Slots: the array-like, its length, the mapper and its `this`, the next index, and the values so far.
const ArrayFromArrayLike = nativeKind("Array.from array-like", (task, frame, input) => {
  const slots = frame.slots
  const source = slots[0] as Obj
  const length = slots[1] as number
  const mapper = slots[2] as Callable | undefined
  const values = slots[5] as Array<Value>
  let index = slots[4] as number
  if (frame.phase === 1) {
    values.push(input as Value)
    index++
  }
  for (; index < length; index++) {
    const item = get(source, index)
    if (mapper === undefined) {
      values.push(item)
      continue
    }
    const mapped = task.call(mapper, slots[3] as Value, [item, index], frame.node)
    if (mapped === PENDING) {
      slots[4] = index
      frame.phase = 1
      return PENDING
    }
    values.push(mapped)
  }
  return new Arr(task.ctx.builtins.Array, values)
})

/** Where a sort with a comparator puts its result: back into an array or bytes, or into a new array. */
type SortInto = "Array.sort" | "Array.toSorted" | "Uint8Array.sort"

/**
 * Sorts `target`'s values: at once without a comparator, otherwise as a frame that calls it. A stable top-down merge
 * sort that compares in the same order as the recursive one: the merges run in post-order, each over a range of one
 * working copy. Holes and undefined values sort last without being compared.
 */
export const sortArray = (builtins: Builtins, target: Arr | Bytes, comparator: Value, into: SortInto): Value | Push => {
  const items = target instanceof Arr ? [...target.items] : [...target.bytes]
  // Counted before any comparator runs; a comparator that changes the array does not change where holes go.
  let holes = 0
  if (target instanceof Arr) for (let index = 0; index < items.length; index++) if (!(index in target.items)) holes++
  if (comparator === undefined) {
    const result = items.sort((a, b) => compareText(coerceToString(a), coerceToString(b)))
    return sorted(builtins, target, into, holes, result)
  }
  const callback = requireCallback(comparator, into)
  const defined = items.filter((item) => item !== undefined)
  const merges: Array<number> = []
  const plan = (low: number, high: number) => {
    if (high - low <= 1) return
    const middle = low + Math.floor((high - low) / 2)
    plan(low, middle)
    plan(middle, high)
    merges.push(low, middle, high)
  }
  plan(0, defined.length)
  return new Push(Sort, [target, into, holes, callback, defined, items.length - defined.length, merges, 0, 0, 0, []])
}

// Slots: the target, where the result goes, its hole count, the comparator, the working copy, the undefined count, the
// merges (low, middle, high, flattened), the next merge, the left and right positions within it, and the merged values
// so far.
const Sort = nativeKind("Array sort", (task, frame, input) => {
  const slots = frame.slots
  const callback = slots[3] as Callable
  const work = slots[4] as Array<Value>
  const merges = slots[6] as Array<number>
  let merge = slots[7] as number
  let left = slots[8] as number
  let right = slots[9] as number
  let merged = slots[10] as Array<Value>
  let resumed = frame.phase === 1
  for (; merge < merges.length; merge += 3) {
    const low = merges[merge]!
    const middle = merges[merge + 1]!
    const high = merges[merge + 2]!
    if (!resumed) {
      left = low
      right = middle
      merged = []
    }
    while (left < middle && right < high) {
      let order: Value
      if (resumed) {
        order = input as Value
        resumed = false
      } else {
        const result = task.call(callback, undefined, [work[left], work[right]], frame.node)
        if (result === PENDING) {
          slots[7] = merge
          slots[8] = left
          slots[9] = right
          slots[10] = merged
          frame.phase = 1
          return PENDING
        }
        order = result
      }
      // Treat a NaN comparator result as equal to preserve stable ordering.
      const number = coerceToNumber(order)
      if (Number.isNaN(number) || number <= 0) merged.push(work[left++])
      else merged.push(work[right++])
    }
    while (left < middle) merged.push(work[left++])
    while (right < high) merged.push(work[right++])
    for (let index = 0; index < merged.length; index++) work[low + index] = merged[index]
  }
  const result = [...work, ...Array(slots[5] as number).fill(undefined)]
  return sorted(task.ctx.builtins, slots[0] as Arr | Bytes, slots[1] as SortInto, slots[2] as number, result)
})

const sorted = (builtins: Builtins, target: Arr | Bytes, into: SortInto, holes: number, result: Array<Value>) => {
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
    ["from", 1, (_, args) => arrayFrom(ctx, args)],
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
    ["sort", 1, (thisValue, args) => sortArray(builtins, mutable(self(thisValue, "sort")), args[0], "Array.sort")],
    ["toSorted", 1, (thisValue, args) => sortArray(builtins, self(thisValue, "toSorted"), args[0], "Array.toSorted")],
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
    ["toLocaleString", 0, (thisValue) => new Push(ToLocaleString, [self(thisValue, "toLocaleString").items, 0, []])],
    ["keys", 0, (thisValue) => positionIterator(builtins, self(thisValue, "keys"), "keys")],
    ["values", 0, (thisValue) => positionIterator(builtins, self(thisValue, "values"), "values")],
    ["entries", 0, (thisValue) => positionIterator(builtins, self(thisValue, "entries"), "entries")],
    [
      "flatMap",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "flatMap")
        const callback = requireCallback(args[0], "Array.flatMap")
        return new Push(ArrayCallback, ["flatMap", target, callback, args[1], target.items.length, 0, []])
      },
    ],
    ...callbackMethods("Array", self),
  ])
  define(proto, IteratorSymbol, get(proto, "values"), hidden)
  return array
}

// Slots: the items (read live; holes and values that are null or undefined print as nothing), the next index, and
// the parts so far.
const ToLocaleString = nativeKind("Array.prototype.toLocaleString", (task, frame, input) => {
  const slots = frame.slots
  const items = slots[0] as Array<Value>
  const parts = slots[2] as Array<string>
  let index = slots[1] as number
  if (frame.phase === 1) {
    parts.push(coerceToString(input as Value))
    index++
  }
  const length = items.length
  for (; index < length; index++) {
    const item = items[index]
    if (item === null || item === undefined) {
      parts.push("")
      continue
    }
    const method = invokeMethod(task.ctx.builtins, item, "toLocaleString", "Array.prototype.toLocaleString")
    const called = task.call(method.callable, method.thisValue, [], frame.node)
    if (called === PENDING) {
      slots[1] = index
      frame.phase = 1
      return PENDING
    }
    parts.push(coerceToString(called))
  }
  return parts.join(",")
})

/** What a callback method does with each element; see `callbackMethods`. */
type CallbackOp =
  | "map"
  | "filter"
  | "find"
  | "findIndex"
  | "findLast"
  | "findLastIndex"
  | "some"
  | "every"
  | "forEach"
  | "reduce"
  | "reduceRight"
  | "flatMap"

/**
 * The callback methods Array and Uint8Array share. They fix the iteration length while reading existing elements
 * live; `map` and `filter` return the receiver's kind of collection.
 */
export const callbackMethods = <T extends Arr | Bytes>(
  label: "Array" | "Uint8Array",
  self: (thisValue: Value, name: string) => T,
): Array<Method> => {
  const method = (name: CallbackOp): Method => [
    name,
    1,
    (thisValue, args) => {
      const target = self(thisValue, name)
      const callback = requireCallback(args[0], `${label}.${name}`)
      const items = elements(target)
      const length = items.length
      if (name !== "reduce" && name !== "reduceRight") {
        const start = name === "findLast" || name === "findLastIndex" ? length - 1 : 0
        return new Push(ArrayCallback, [
          name,
          target,
          callback,
          args[1],
          length,
          start,
          name === "map" ? new Array(length) : [],
        ])
      }
      // reduce and reduceRight take an initial value where the others take a thisArg.
      const step = name === "reduce" ? 1 : -1
      let start = name === "reduce" ? 0 : length - 1
      let accumulator = args[1]
      if (args.length < 2) {
        while (start >= 0 && start < length && !(start in items)) start += step
        if (start < 0 || start >= length) throw typeError(`${label}.${name} of an empty array with no initial value.`)
        accumulator = items[start]
        start += step
      }
      return new Push(ArrayCallback, [name, target, callback, undefined, length, start, accumulator])
    },
  ]
  return (["map", "filter", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "forEach"] as const)
    .map(method)
    .concat([method("reduce"), method("reduceRight")])
}

const elements = (target: Arr | Bytes): ArrayLike<Value> => (target instanceof Arr ? target.items : target.bytes)

// Whether a callback method visits holes: only the find methods do, as undefined.
const visitsHoles = (op: CallbackOp) => op.startsWith("find")
const backwards = (op: CallbackOp) => op === "findLast" || op === "findLastIndex" || op === "reduceRight"
export const NEXT: unique symbol = Symbol("next")

// Slots: what the method does, the receiver, the callback, its `this`, the fixed length, the next index, what it has
// built so far (the values, or the accumulator), and the element the callback is looking at.
const ArrayCallback = nativeKind("Array callback", (task, frame, input) => {
  const slots = frame.slots
  const op = slots[0] as CallbackOp
  const receiver = slots[1] as Arr | Bytes
  const callback = slots[2] as Callable
  const thisArg = slots[3] as Value
  const length = slots[4] as number
  const step = backwards(op) ? -1 : 1
  const reducing = op === "reduce" || op === "reduceRight"
  const holes = visitsHoles(op)
  const items = elements(receiver)
  let index = slots[5] as number
  if (frame.phase === 1) {
    const out = received(task, slots, op, input as Value, index)
    if (out !== NEXT) return out
    index += step
  }
  for (; index >= 0 && index < length; index += step) {
    if (!holes && !(index in items)) continue
    const item = items[index]
    const result = task.call(
      callback,
      thisArg,
      reducing ? [slots[6] as Value, item, index, receiver] : [item, index, receiver],
      frame.node,
    )
    if (result === PENDING) {
      slots[5] = index
      slots[7] = item
      frame.phase = 1
      return PENDING
    }
    slots[7] = item
    const out = received(task, slots, op, result, index)
    if (out !== NEXT) return out
  }
  return finished(task, op, receiver, slots[6])
})

// What one callback result does: the method's result once it is decided, or NEXT to go on.
const received = (task: MachineTask, slots: Array<unknown>, op: CallbackOp, result: Value, index: number) => {
  const built = slots[6]
  switch (op) {
    case "map":
      ;(built as Array<Value>)[index] = result
      return NEXT
    case "filter":
      if (result) (built as Array<Value>).push(slots[7] as Value)
      return NEXT
    case "flatMap":
      // forEach skips holes, as flattening does; spreading would turn them into undefined.
      if (result instanceof Arr) result.items.forEach((item) => (built as Array<Value>).push(item))
      else (built as Array<Value>).push(result)
      return NEXT
    case "find":
    case "findLast":
      return result ? (slots[7] as Value) : NEXT
    case "findIndex":
    case "findLastIndex":
      return result ? index : NEXT
    case "some":
      return result ? true : NEXT
    case "every":
      return result ? NEXT : false
    case "forEach":
      return NEXT
    case "reduce":
    case "reduceRight":
      slots[6] = result
      return NEXT
  }
}

const finished = (task: MachineTask, op: CallbackOp, receiver: Arr | Bytes, built: unknown): Value => {
  switch (op) {
    case "map":
    case "filter":
      return receiver instanceof Arr
        ? new Arr(task.ctx.builtins.Array, built as Array<Value>)
        : new Bytes(task.ctx.builtins.Uint8Array, Uint8Array.from(built as Array<Value>, coerceToNumber))
    case "flatMap":
      return new Arr(task.ctx.builtins.Array, built as Array<Value>)
    case "find":
    case "findLast":
    case "forEach":
      return undefined
    case "findIndex":
    case "findLastIndex":
      return -1
    case "some":
      return false
    case "every":
      return true
    case "reduce":
    case "reduceRight":
      return built as Value
  }
}
