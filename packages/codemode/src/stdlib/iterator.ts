import { nativeKind, site } from "../machine/native-kind.js"
import { requireCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { rangeError, typeError } from "../interpreter/model.js"
import { constructor, methods, receiver, requiresNew } from "../interpreter/native.js"
import {
  coerceToNumber,
  type Cursor,
  Helper,
  type HelperOp,
  iteratorResult,
  IteratorObj,
  Position,
  type Step,
  type Value,
} from "../interpreter/objects.js"
import { Push } from "../interpreter/signals.js"
import { PENDING } from "../machine/frame.js"
import { iterateDirect, iteratorClose, iteratorStep } from "../machine/iteration.js"

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
