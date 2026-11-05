import type { Interpreter } from "../interpreter/interpreter.js"
import { typeError } from "../interpreter/model.js"
import { constructor, methods, receiver, requiresNew } from "../interpreter/native.js"
import { iteratorResult, IteratorObj, Position } from "../interpreter/objects.js"

// Every built-in iterator and helper shares the Iterator prototype; JS gives each collection its own, which is only
// observable through getPrototypeOf. The helpers (`map`, `take`, `Iterator.from`, ...) are the prelude's.
export const iteratorGlobals = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Iterator
  methods(builtins, proto, [
    [
      "next",
      0,
      (thisValue) => {
        const cursor = receiver(IteratorObj, thisValue, "Iterator.prototype.next").cursor
        if (!(cursor instanceof Position)) throw typeError("Iterator.prototype.next called on an internal iterator.")
        const step = cursor.step()
        return iteratorResult(builtins.Object, step.value, step.done)
      },
    ],
  ])
  return constructor(builtins, proto, {
    name: "Iterator",
    length: 0,
    call: requiresNew("Iterator"),
    construct: () => {
      throw typeError("Iterator is abstract; use Iterator.from(...) or a built-in iterator.")
    },
  })
}
