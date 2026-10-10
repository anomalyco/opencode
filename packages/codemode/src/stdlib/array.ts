import { Effect } from "effect"
import { constructor, type Method, methods, prototypeFrom, receiver } from "../interpreter/native.js"
import { checkArrayLength, checkStringLength, MAX_ARRAY_LENGTH } from "../interpreter/limits.js"
import { invalidData, IteratorSymbol, rangeError, typeError } from "../interpreter/model.js"
import {
  define,
  get,
  Callable,
  hidden,
  Arr,
  GeneratorObj,
  hostIterator,
  Obj,
  PromiseObj,
  coerceToInteger,
  coerceToNumber,
  coerceToString,
  rejectAddition,
  type Value,
} from "../interpreter/objects.js"
import { describeValue, rejectCircularInsertion } from "../interpreter/references.js"
import { applyCollectionCallback, invoke, preserveConsumerError, withPrimitives } from "../interpreter/callback.js"
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

const arrayFrom = <R>(ctx: Interpreter<R>, args: Array<Value>): Effect.Effect<Value, unknown, R> => {
  const source = args[0]
  const proto = ctx.builtins.Array
  const apply =
    args.length < 2 || args[1] === undefined ? undefined : applyCollectionCallback(ctx, args[1], "Array.from")
  return Effect.gen(function* () {
    const cursor = yield* ctx.iterate(source)
    if (cursor === undefined) {
      if (source instanceof GeneratorObj) {
        throw typeError(
          `Array.from expects a synchronous iterable or array-like value, received ${describeValue(source)}.`,
        )
      }
      const arrayLike = arrayLikeSource(source)
      const values: Array<Value> = []
      for (let index = 0; index < arrayLike.length; index += 1) {
        const item = get(arrayLike.source, index)
        values.push(apply === undefined ? item : yield* apply([item, index], args[2]))
      }
      return new Arr(proto, values)
    }
    const values: Array<Value> = []
    let index = 0
    while (true) {
      const step = yield* cursor.next
      if (step.done) return new Arr(proto, values)
      values.push(
        apply === undefined
          ? step.value
          : yield* preserveConsumerError(cursor.close, apply([step.value, index], args[2])),
      )
      checkArrayLength(values.length)
      index += 1
    }
  })
}

export const sortArray = <R>(
  ctx: Interpreter<R>,
  target: Array<Value>,
  comparator: Value,
  name: string,
): Effect.Effect<Array<Value>, unknown, R> => {
  if (comparator === undefined) {
    return Effect.sync(() => [...target].sort((a, b) => compareText(coerceToString(a), coerceToString(b))))
  }
  const apply = applyCollectionCallback(ctx, comparator, name)
  const mergeSort = (items: Array<Value>): Effect.Effect<Array<Value>, unknown, R> => {
    if (items.length <= 1) return Effect.succeed(items)
    const midpoint = Math.floor(items.length / 2)
    return Effect.gen(function* () {
      const left = yield* mergeSort(items.slice(0, midpoint))
      const right = yield* mergeSort(items.slice(midpoint))
      const merged: Array<Value> = []
      let leftIndex = 0
      let rightIndex = 0
      while (leftIndex < left.length && rightIndex < right.length) {
        // Treat a NaN comparator result as equal to preserve stable ordering.
        const order = coerceToNumber(yield* apply([left[leftIndex], right[rightIndex]]))
        if (Number.isNaN(order) || order <= 0) merged.push(left[leftIndex++])
        else merged.push(right[rightIndex++])
      }
      return [...merged, ...left.slice(leftIndex), ...right.slice(rightIndex)]
    })
  }
  const defined = target.filter((item) => item !== undefined)
  const undefinedCount = target.length - defined.length
  return Effect.map(mergeSort(defined), (items) => [...items, ...Array(undefinedCount).fill(undefined)])
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
  const array = constructor<R>(builtins, proto, {
    name: "Array",
    length: 1,
    call: (_, args) => Effect.sync(() => construct(args, proto)),
    construct: (args, newTarget) => Effect.sync(() => construct(args, prototypeFrom(newTarget, proto))),
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
        // .map would keep holes, which Effect.forEach would then hand to the body as undefined.
        const parts = Array.from(self(thisValue, "join").items, (item) => item ?? "")
        return withPrimitives(
          ctx,
          "string",
          [args[0] === undefined ? "," : args[0], ...parts],
          ([separator, ...items]) => {
            const joined = items.map(coerceToString).join(coerceToString(separator))
            checkStringLength(joined.length)
            return joined
          },
        )
      },
    ],
    [
      "toString",
      0,
      (thisValue) => {
        // Spec: delegate to this.join, so an overridden join shows up in `arr + ""` and String(arr).
        const target = self(thisValue, "toString")
        const join = get(target, "join")
        return join instanceof Callable ? ctx.call(join, target, []) : `[object ${target.tag}]`
      },
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
    [
      "sort",
      1,
      (thisValue, args) => {
        const target = mutable(self(thisValue, "sort"))
        const items = target.items
        const length = items.length
        const holeCount = Array.from({ length }, (_, index) => Object.hasOwn(items, index)).filter((o) => !o).length
        const itemCount = length - holeCount
        return Effect.map(sortArray(ctx, items, args[0], "Array.sort"), (sorted) => {
          sorted.slice(0, itemCount).forEach((item, index) => {
            items[index] = item
          })
          Array.from({ length: holeCount }, (_, index) => itemCount + index).forEach((index) => {
            delete items[index]
          })
          return target
        })
      },
    ],
    [
      "toSorted",
      1,
      (thisValue, args) =>
        Effect.map(sortArray(ctx, self(thisValue, "toSorted").items, args[0], "Array.toSorted"), wrap),
    ],
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
    [
      "toLocaleString",
      0,
      (thisValue) =>
        Effect.map(
          Effect.forEach(self(thisValue, "toLocaleString").items, (item) =>
            item === null || item === undefined
              ? Effect.succeed("")
              : Effect.map(invoke(ctx, item, "toLocaleString", "Array.prototype.toLocaleString"), coerceToString),
          ),
          (parts) => parts.join(","),
        ),
    ],
    ["keys", 0, (thisValue) => hostIterator(builtins, self(thisValue, "keys").items.keys())],
    ["values", 0, (thisValue) => hostIterator(builtins, self(thisValue, "values").items.values())],
    [
      "entries",
      0,
      (thisValue) =>
        hostIterator(
          builtins,
          self(thisValue, "entries")
            .items.entries()
            .map(([index, item]) => wrap([index, item])),
        ),
    ],
    [
      "flatMap",
      1,
      (thisValue, args) => {
        const target = self(thisValue, "flatMap")
        const apply = applyCollectionCallback(ctx, args[0], "Array.flatMap")
        return Effect.gen(function* () {
          const length = target.items.length
          const values: Array<Value> = []
          for (let index = 0; index < length; index += 1) {
            if (!(index in target.items)) continue
            const mapped = yield* apply([target.items[index], index, target], args[1])
            if (mapped instanceof Arr) values.push(...mapped.items)
            else values.push(mapped)
          }
          return wrap(values)
        })
      },
    ],
    ...callbackMethods(ctx, "Array", self, (target) => target.items, wrap),
  ])
  define(proto, IteratorSymbol, get(proto, "values"), hidden)
  return array
}

/**
 * The callback methods Array and Uint8Array share. They fix the iteration length while reading existing elements
 * live; `wrap` builds the collection `map` and `filter` return.
 */
export const callbackMethods = <R, T extends Obj>(
  ctx: Interpreter<R>,
  label: string,
  self: (thisValue: Value, name: string) => T,
  elements: (target: T) => ArrayLike<Value>,
  wrap: (values: Array<Value>) => Value,
): Array<Method> => {
  const iterate = (
    name: string,
    length: number,
    body: (
      target: ArrayLike<Value>,
      receiver: T,
      apply: (args: Array<Value>) => Effect.Effect<Value, unknown, R>,
      args: Array<Value>,
    ) => Effect.Effect<Value, unknown, R>,
  ): Method => [
    name,
    length,
    (thisValue, args) => {
      const target = self(thisValue, name)
      const call = applyCollectionCallback(ctx, args[0], `${label}.${name}`)
      // reduce and reduceRight take an initial value where the others take a thisArg.
      const thisArg = name.startsWith("reduce") ? undefined : args[1]
      return body(elements(target), target, (callbackArgs) => call(callbackArgs, thisArg), args)
    },
  ]
  return [
    iterate("map", 1, (target, receiver, apply) =>
      Effect.gen(function* () {
        const length = target.length
        const values: Array<Value> = []
        values.length = length
        for (let index = 0; index < length; index += 1) {
          if (!(index in target)) continue
          values[index] = yield* apply([target[index], index, receiver])
        }
        return wrap(values)
      }),
    ),
    iterate("filter", 1, (target, receiver, apply) =>
      Effect.gen(function* () {
        const length = target.length
        const values: Array<Value> = []
        for (let index = 0; index < length; index += 1) {
          if (!(index in target)) continue
          const item = target[index]
          if (yield* apply([item, index, receiver])) values.push(item)
        }
        return wrap(values)
      }),
    ),
    iterate("find", 1, (target, receiver, apply) =>
      Effect.gen(function* () {
        const length = target.length
        for (let index = 0; index < length; index += 1) {
          const item = target[index]
          if (yield* apply([item, index, receiver])) return item
        }
        return undefined
      }),
    ),
    iterate("findIndex", 1, (target, receiver, apply) =>
      Effect.gen(function* () {
        const length = target.length
        for (let index = 0; index < length; index += 1) {
          if (yield* apply([target[index], index, receiver])) return index
        }
        return -1
      }),
    ),
    iterate("findLast", 1, (target, receiver, apply) =>
      Effect.gen(function* () {
        for (let index = target.length - 1; index >= 0; index -= 1) {
          const item = target[index]
          if (yield* apply([item, index, receiver])) return item
        }
        return undefined
      }),
    ),
    iterate("findLastIndex", 1, (target, receiver, apply) =>
      Effect.gen(function* () {
        for (let index = target.length - 1; index >= 0; index -= 1) {
          if (yield* apply([target[index], index, receiver])) return index
        }
        return -1
      }),
    ),
    iterate("some", 1, (target, receiver, apply) =>
      Effect.gen(function* () {
        const length = target.length
        for (let index = 0; index < length; index += 1) {
          if (!(index in target)) continue
          if (yield* apply([target[index], index, receiver])) return true
        }
        return false
      }),
    ),
    iterate("every", 1, (target, receiver, apply) =>
      Effect.gen(function* () {
        const length = target.length
        for (let index = 0; index < length; index += 1) {
          if (!(index in target)) continue
          if (!(yield* apply([target[index], index, receiver]))) return false
        }
        return true
      }),
    ),
    iterate("forEach", 1, (target, receiver, apply) =>
      Effect.gen(function* () {
        const length = target.length
        for (let index = 0; index < length; index += 1) {
          if (index in target) yield* apply([target[index], index, receiver])
        }
        return undefined
      }),
    ),
    iterate("reduce", 1, (target, receiver, apply, args) =>
      Effect.gen(function* () {
        const length = target.length
        let start = 0
        let accumulator = args[1]
        if (args.length < 2) {
          while (start < length && !(start in target)) start += 1
          if (start === length) {
            throw typeError(`${label}.reduce of an empty array with no initial value.`)
          }
          accumulator = target[start]
          start += 1
        }
        for (let index = start; index < length; index += 1) {
          if (!(index in target)) continue
          accumulator = yield* apply([accumulator, target[index], index, receiver])
        }
        return accumulator
      }),
    ),
    iterate("reduceRight", 1, (target, receiver, apply, args) =>
      Effect.gen(function* () {
        let start = target.length - 1
        let accumulator = args[1]
        if (args.length < 2) {
          while (start >= 0 && !(start in target)) start -= 1
          if (start < 0) {
            throw typeError(`${label}.reduceRight of an empty array with no initial value.`)
          }
          accumulator = target[start]
          start -= 1
        }
        for (let index = start; index >= 0; index -= 1) {
          if (!(index in target)) continue
          accumulator = yield* apply([accumulator, target[index], index, receiver])
        }
        return accumulator
      }),
    ),
  ]
}
