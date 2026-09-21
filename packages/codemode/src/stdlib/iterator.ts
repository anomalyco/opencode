import { methods, receiver } from "../interpreter/native.js"
import { IteratorObj, record } from "../interpreter/objects.js"
import type { Interpreter } from "../interpreter/interpreter.js"

// Every built-in collection iterator shares the Iterator prototype; JS gives each collection its own, which is only
// observable through getPrototypeOf.
export const iteratorGlobals = <R>(ctx: Interpreter<R>): void => {
  const builtins = ctx.builtins
  methods(builtins, builtins.Iterator, [
    [
      "next",
      0,
      (thisValue) => {
        const step = receiver(IteratorObj, thisValue, "Iterator.prototype.next").source.next()
        return record(builtins.Object, { value: step.value, done: Boolean(step.done) })
      },
    ],
  ])
}
