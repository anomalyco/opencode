import { applyCollectionCallback } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { rangeError, typeError } from "../interpreter/model.js"
import { constructor, fn, methods, receiver, requiresNew } from "../interpreter/native.js"
import {
  Arr,
  coerceToNumber,
  type Cursor,
  define,
  hasPrototype,
  hidden,
  iteratorResult,
  IteratorObj,
  Obj,
  type Step,
  type Value,
} from "../interpreter/objects.js"
import { describeValue } from "../interpreter/references.js"
import { type Eval, Interruption } from "../interpreter/runner.js"

const finished: Step = { done: true, value: undefined }

// Every built-in iterator and helper shares the Iterator prototype; JS gives each collection its own, which is only
// observable through getPrototypeOf.
export const iteratorGlobals = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Iterator
  const method = (name: string) => `Iterator.prototype.${name}`

  // A step that runs program code: when it throws, close the source first, as IteratorClose does.
  const guarded = function* <A>(source: Cursor, body: Eval<A>): Eval<A> {
    try {
      return yield* body
    } catch (error) {
      if (error instanceof Interruption) throw error
      try {
        yield* source.close()
      } catch {
        // The step's failure wins over a failing close.
      }
      throw error
    }
  }

  // A lazy helper: `pull` advances it once. Once it reports done, throws, or is closed, it stays done. A callback
  // that re-enters its own helper is a TypeError, as for a running generator.
  const helper = (source: Cursor, pull: () => Eval<Step>, close = source.close) => {
    let done = false
    let running = false
    const enter = () => {
      if (running) throw typeError("Iterator helper is already running.")
      running = true
    }
    return new IteratorObj(builtins.IteratorHelper, {
      next: function* () {
        if (done) return finished
        enter()
        try {
          const step = yield* pull()
          done = step.done
          return step
        } catch (error) {
          done = true
          throw error
        } finally {
          running = false
        }
      },
      close: function* () {
        if (done) return
        enter()
        done = true
        try {
          yield* close()
        } finally {
          running = false
        }
      },
    })
  }

  // GetIteratorFlattenable: an iterable by `[Symbol.iterator]`, otherwise the object itself as an iterator.
  const flattenable = function* (value: Value, name: string, strings: boolean): Eval<Cursor> {
    if (typeof value === "string" ? !strings : !(value instanceof Obj)) {
      throw typeError(`${name} expects an iterable or iterator, received ${describeValue(value)}.`)
    }
    return (yield* ctx.iterate(value)) ?? ctx.iterateDirect(value)
  }

  const limit = (value: Value, name: string) => {
    const count = Math.trunc(coerceToNumber(value))
    if (Number.isNaN(count) || count < 0) {
      throw rangeError(`${method(name)} expects a non-negative count, received ${count}.`)
    }
    return count
  }

  methods(builtins, proto, [
    [
      "next",
      0,
      function* (thisValue) {
        const step = yield* receiver(IteratorObj, thisValue, method("next")).cursor.next()
        return iteratorResult(builtins.Object, step.value, step.done)
      },
    ],
    [
      "map",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("map"))
        let counter = 0
        return helper(source, function* () {
          const step = yield* source.next()
          if (step.done) return finished
          return { done: false, value: yield* guarded(source, apply([step.value, counter++])) }
        })
      },
    ],
    [
      "filter",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("filter"))
        let counter = 0
        return helper(source, function* () {
          while (true) {
            const step = yield* source.next()
            if (step.done) return finished
            if (yield* guarded(source, apply([step.value, counter++]))) return step
          }
        })
      },
    ],
    [
      "take",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        let remaining = limit(args[0], "take")
        return helper(source, function* () {
          if (remaining === 0) {
            yield* source.close()
            return finished
          }
          remaining -= 1
          return yield* source.next()
        })
      },
    ],
    [
      "drop",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        let remaining = limit(args[0], "drop")
        return helper(source, function* () {
          while (remaining > 0) {
            remaining -= 1
            const step = yield* source.next()
            if (step.done) return finished
          }
          return yield* source.next()
        })
      },
    ],
    [
      "flatMap",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("flatMap"))
        let counter = 0
        let inner: Cursor | undefined
        return helper(
          source,
          function* () {
            while (true) {
              if (inner !== undefined) {
                const step = yield* guarded(source, inner.next())
                if (!step.done) return step
                inner = undefined
              }
              const step = yield* source.next()
              if (step.done) return finished
              const mapped = yield* guarded(source, apply([step.value, counter++]))
              inner = yield* guarded(source, flattenable(mapped, method("flatMap"), false))
            }
          },
          function* () {
            if (inner !== undefined) yield* inner.close()
            yield* source.close()
          },
        )
      },
    ],
    [
      "reduce",
      1,
      function* (thisValue, args) {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("reduce"))
        let counter = 0
        let accumulator = args[1]
        if (args.length < 2) {
          const first = yield* source.next()
          if (first.done) throw typeError("Iterator.prototype.reduce of an empty iterator with no initial value.")
          accumulator = first.value
          counter = 1
        }
        while (true) {
          const step = yield* source.next()
          if (step.done) return accumulator
          accumulator = yield* guarded(source, apply([accumulator, step.value, counter++]))
        }
      },
    ],
    [
      "toArray",
      0,
      function* (thisValue) {
        const source = ctx.iterateDirect(thisValue)
        const items: Array<Value> = []
        while (true) {
          const step = yield* source.next()
          if (step.done) return new Arr(builtins.Array, items)
          items.push(step.value)
        }
      },
    ],
    [
      "forEach",
      1,
      function* (thisValue, args) {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("forEach"))
        let counter = 0
        while (true) {
          const step = yield* source.next()
          if (step.done) return undefined
          yield* guarded(source, apply([step.value, counter++]))
        }
      },
    ],
    [
      "some",
      1,
      function* (thisValue, args) {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("some"))
        let counter = 0
        while (true) {
          const step = yield* source.next()
          if (step.done) return false
          if (yield* guarded(source, apply([step.value, counter++]))) {
            yield* source.close()
            return true
          }
        }
      },
    ],
    [
      "every",
      1,
      function* (thisValue, args) {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("every"))
        let counter = 0
        while (true) {
          const step = yield* source.next()
          if (step.done) return true
          if (!(yield* guarded(source, apply([step.value, counter++])))) {
            yield* source.close()
            return false
          }
        }
      },
    ],
    [
      "find",
      1,
      function* (thisValue, args) {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("find"))
        let counter = 0
        while (true) {
          const step = yield* source.next()
          if (step.done) return undefined
          if (yield* guarded(source, apply([step.value, counter++]))) {
            yield* source.close()
            return step.value
          }
        }
      },
    ],
  ])

  // Helpers and `Iterator.from` wrappers can be closed; collection iterators, as in JS, cannot.
  methods(builtins, builtins.IteratorHelper, [
    [
      "return",
      0,
      function* (thisValue) {
        yield* receiver(IteratorObj, thisValue, "Iterator.prototype.return").cursor.close()
        return iteratorResult(builtins.Object, undefined, true)
      },
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
    fn(builtins, "from", 1, function* (_, args) {
      if (args[0] instanceof Obj && hasPrototype(args[0], proto)) return args[0]
      return new IteratorObj(builtins.IteratorHelper, yield* flattenable(args[0], "Iterator.from", true))
    }),
    hidden,
  )
  return iterator
}
