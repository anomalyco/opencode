import { type Consumer, EXIT, nativeKind, site, STATE } from "../machine/native-kind.js"
import { requireCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { rangeError, typeError } from "../interpreter/model.js"
import { constructor, fn, methods, receiver, requiresNew } from "../interpreter/native.js"
import {
  Arr,
  type Callable,
  coerceToNumber,
  type Cursor,
  define,
  hasPrototype,
  Helper,
  type HelperOp,
  hidden,
  iteratorResult,
  IteratorObj,
  Obj,
  Position,
  type Step,
  type Value,
} from "../interpreter/objects.js"
import { Push } from "../interpreter/signals.js"
import { type Frame, PENDING } from "../machine/frame.js"
import { flattenable } from "../machine/helpers.js"
import { iterateDirect, iteratorClose, iteratorStep } from "../machine/iteration.js"
import { Drain, drainOpen } from "../machine/natives.js"

const method = (name: string) => `Iterator.prototype.${name}`

// Every built-in iterator and helper shares the Iterator prototype; JS gives each collection its own, which is only
// observable through getPrototypeOf.
export const iteratorGlobals = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Iterator

  const limit = (value: Value, name: string) => {
    const count = Math.trunc(coerceToNumber(value))
    if (Number.isNaN(count) || count < 0) {
      throw rangeError(`${method(name)} expects a non-negative count, received ${count}.`)
    }
    return count
  }
  const helper = (op: HelperOp, thisValue: Value, callback: Value, count: number) =>
    new IteratorObj(builtins.IteratorHelper, new Helper(op, iterateDirect(thisValue, undefined), callback, count))
  const lazy = (op: "map" | "filter" | "flatMap") =>
    [
      op,
      1,
      (thisValue: Value, args: Array<Value>) => {
        const source = iterateDirect(thisValue, undefined)
        const callback = requireCallback(args[0], method(op))
        return new IteratorObj(builtins.IteratorHelper, new Helper(op, source, callback, 0))
      },
    ] as const
  // A consuming method: drives the iterator to its end, or until the callback decides the result.
  const consuming = (name: string, consumer: Consumer, needsCallback = true) =>
    [
      name,
      name === "toArray" ? 0 : 1,
      (thisValue: Value, args: Array<Value>) => {
        const source = iterateDirect(thisValue, undefined)
        const callback = needsCallback ? requireCallback(args[0], method(name)) : undefined
        return new Push(
          Drain,
          drainOpen(consumer, source, [callback, args[1], name === "reduce" && args.length >= 2, undefined]),
        )
      },
    ] as const

  methods(builtins, proto, [
    [
      "next",
      0,
      (thisValue) => {
        const cursor = receiver(IteratorObj, thisValue, method("next")).cursor
        if (cursor instanceof Position) {
          const step = cursor.step()
          return iteratorResult(builtins.Object, step.value, step.done)
        }
        return new Push(IteratorNext, [cursor])
      },
    ],
    lazy("map"),
    lazy("filter"),
    ["take", 1, (thisValue, args) => helper("take", thisValue, undefined, limit(args[0], "take"))],
    ["drop", 1, (thisValue, args) => helper("drop", thisValue, undefined, limit(args[0], "drop"))],
    lazy("flatMap"),
    consuming("reduce", Reduce),
    consuming("toArray", ToArray, false),
    consuming("forEach", ForEach),
    consuming("some", Some),
    consuming("every", Every),
    consuming("find", Find),
  ])

  // Helpers and `Iterator.from` wrappers can be closed; collection iterators, as in JS, cannot.
  methods(builtins, builtins.IteratorHelper, [
    [
      "return",
      0,
      (thisValue) => new Push(IteratorReturn, [receiver(IteratorObj, thisValue, "Iterator.prototype.return").cursor]),
    ],
  ])

  const iterator = constructor(builtins, proto, {
    name: "Iterator",
    length: 0,
    call: requiresNew("Iterator"),
    construct: () => {
      throw typeError("Iterator is abstract; use Iterator.from(...) or a built-in iterator.")
    },
  })
  define(
    iterator,
    "from",
    fn(builtins, "from", 1, (_, args) => {
      if (args[0] instanceof Obj && hasPrototype(args[0], proto)) return args[0]
      return new Push(IteratorFrom, [args[0]])
    }),
    hidden,
  )
  return iterator
}

// Slots: the cursor.
const IteratorNext = nativeKind("Iterator.prototype.next", (task, frame, input) => {
  let step = input as Step
  if (frame.phase === 0) {
    const stepped = iteratorStep(task, frame.slots[0] as Cursor, site(frame))
    if (stepped === PENDING) {
      frame.phase = 1
      return PENDING
    }
    step = stepped
  }
  return iteratorResult(task.ctx.builtins.Object, step.value, step.done)
})

const IteratorReturn = nativeKind("%IteratorHelper%.return", (task, frame) => {
  if (frame.phase === 0) {
    frame.phase = 1
    if (iteratorClose(task, frame.slots[0] as Cursor, site(frame)) === PENDING) return PENDING
  }
  return iteratorResult(task.ctx.builtins.Object, undefined, true)
})

// Slots: the value to iterate.
const IteratorFrom = nativeKind("Iterator.from", (task, frame, input) => {
  let cursor = input as Cursor
  if (frame.phase === 0) {
    const opened = flattenable(task, frame.slots[0] as Value, "Iterator.from", true, site(frame))
    if (opened === PENDING) {
      frame.phase = 1
      return PENDING
    }
    cursor = opened
  }
  return new IteratorObj(task.ctx.builtins.IteratorHelper, cursor)
})

// The consuming methods' state: the callback, the initial value (reduce), whether there is an accumulator yet
// (reduce), and the result.
const CALLBACK = STATE
const ACCUMULATOR = STATE + 1
const HAS = STATE + 2
const RESULT = STATE + 3

const Reduce: Consumer = {
  name: "Iterator.prototype.reduce",
  each: (task, frame, value, index) => {
    const slots = frame.slots
    if (!slots[HAS]) {
      slots[HAS] = true
      slots[ACCUMULATOR] = value
      return undefined
    }
    const result = task.call(
      slots[CALLBACK] as Callable,
      undefined,
      [slots[ACCUMULATOR] as Value, value, index],
      undefined,
    )
    if (result === PENDING) return PENDING
    slots[ACCUMULATOR] = result
    return undefined
  },
  resume: (_task, frame, input) => {
    frame.slots[ACCUMULATOR] = input
  },
  done: (_task, frame) => {
    if (!frame.slots[HAS]) throw typeError("Iterator.prototype.reduce of an empty iterator with no initial value.")
    return frame.slots[ACCUMULATOR] as Value
  },
}

const ToArray: Consumer = {
  name: "Iterator.prototype.toArray",
  take: (frame, value) => {
    ;((frame.slots[RESULT] ??= []) as Array<Value>).push(value)
  },
  done: (task, frame) => new Arr(task.ctx.builtins.Array, (frame.slots[RESULT] ?? []) as Array<Value>),
}

// A consumer that calls the callback with each value and its index, and decides by the result.
const deciding = (
  name: string,
  decide: (frame: Frame, value: Value, result: Value) => typeof EXIT | undefined,
  otherwise: Value,
): Consumer => ({
  name: method(name),
  each: (task, frame, value, index) => {
    frame.slots[RESULT] = value
    const result = task.call(frame.slots[CALLBACK] as Callable, undefined, [value, index], undefined)
    if (result === PENDING) return PENDING
    return decide(frame, frame.slots[RESULT] as Value, result)
  },
  resume: (_task, frame, input) => decide(frame, frame.slots[RESULT] as Value, input as Value),
  done: (_task, frame) => (frame.slots[HAS] ? (frame.slots[RESULT] as Value) : otherwise),
})

// Stops with `result` as the method's result.
const stop = (frame: Frame, result: Value): typeof EXIT => {
  frame.slots[HAS] = true
  frame.slots[RESULT] = result
  return EXIT
}

const ForEach = deciding("forEach", () => undefined, undefined)
const Some = deciding("some", (frame, _value, result) => (result ? stop(frame, true) : undefined), false)
const Every = deciding("every", (frame, _value, result) => (result ? undefined : stop(frame, false)), true)
const Find = deciding("find", (frame, value, result) => (result ? stop(frame, value) : undefined), undefined)
