import { Cause, Effect, Exit } from "effect"
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
  IteratorObj,
  Obj,
  record,
  type Step,
  type Value,
} from "../interpreter/objects.js"
import { describeValue } from "../interpreter/references.js"

const finished: Step = { done: true, value: undefined }

// Every built-in iterator and helper shares the Iterator prototype; JS gives each collection its own, which is only
// observable through getPrototypeOf.
export const iteratorGlobals = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Iterator
  const method = (name: string) => `Iterator.prototype.${name}`

  // A step that runs program code: when it throws, close the source first, as IteratorClose does.
  const guarded = <A>(source: Cursor<R>, body: Effect.Effect<A, unknown, R>) =>
    Effect.flatMap(Effect.exit(body), (exit) => {
      if (Exit.isSuccess(exit)) return Effect.succeed(exit.value)
      if (Cause.hasInterruptsOnly(exit.cause)) return Effect.failCause(exit.cause)
      return Effect.andThen(Effect.exit(source.close), Effect.failCause(exit.cause))
    })

  // A lazy helper: `pull` advances it once. Once it reports done, throws, or is closed, it stays done. A callback
  // that re-enters its own helper is a TypeError, as for a running generator.
  const helper = (source: Cursor<R>, pull: Effect.Effect<Step, unknown, R>, close = source.close) => {
    let done = false
    let running = false
    const enter = () => {
      if (running) throw typeError("Iterator helper is already running.")
      running = true
    }
    return new IteratorObj(builtins.IteratorHelper, {
      next: Effect.suspend(() => {
        if (done) return Effect.succeed(finished)
        enter()
        return Effect.flatMap(Effect.exit(pull), (exit) => {
          running = false
          done = Exit.isSuccess(exit) ? exit.value.done : true
          return exit
        })
      }),
      close: Effect.suspend(() => {
        if (done) return Effect.void
        enter()
        done = true
        return Effect.ensuring(
          close,
          Effect.sync(() => {
            running = false
          }),
        )
      }),
    })
  }

  // GetIteratorFlattenable: an iterable by `[Symbol.iterator]`, otherwise the object itself as an iterator.
  const flattenable = (value: Value, name: string, strings: boolean) =>
    Effect.gen(function* () {
      if (typeof value === "string" ? !strings : !(value instanceof Obj)) {
        throw typeError(`${name} expects an iterable or iterator, received ${describeValue(value)}.`)
      }
      return (yield* ctx.iterate(value)) ?? ctx.iterateDirect(value)
    })

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
      (thisValue) =>
        Effect.map(receiver(IteratorObj, thisValue, method("next")).cursor.next, (step) =>
          record(builtins.Object, { value: step.value, done: step.done }),
        ),
    ],
    [
      "map",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("map"))
        let counter = 0
        return helper(
          source,
          Effect.gen(function* () {
            const step = yield* source.next
            if (step.done) return finished
            return { done: false, value: yield* guarded(source, apply([step.value, counter++])) }
          }),
        )
      },
    ],
    [
      "filter",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("filter"))
        let counter = 0
        return helper(
          source,
          Effect.gen(function* () {
            while (true) {
              const step = yield* source.next
              if (step.done) return finished
              if (yield* guarded(source, apply([step.value, counter++]))) return step
            }
          }),
        )
      },
    ],
    [
      "take",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        let remaining = limit(args[0], "take")
        return helper(
          source,
          Effect.gen(function* () {
            if (remaining === 0) {
              yield* source.close
              return finished
            }
            remaining -= 1
            return yield* source.next
          }),
        )
      },
    ],
    [
      "drop",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        let remaining = limit(args[0], "drop")
        return helper(
          source,
          Effect.gen(function* () {
            while (remaining > 0) {
              remaining -= 1
              const step = yield* source.next
              if (step.done) return finished
            }
            return yield* source.next
          }),
        )
      },
    ],
    [
      "flatMap",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("flatMap"))
        let counter = 0
        let inner: Cursor<R> | undefined
        return helper(
          source,
          Effect.gen(function* () {
            while (true) {
              if (inner !== undefined) {
                const step = yield* guarded(source, inner.next)
                if (!step.done) return step
                inner = undefined
              }
              const step = yield* source.next
              if (step.done) return finished
              inner = yield* guarded(
                source,
                Effect.flatMap(apply([step.value, counter++]), (mapped) =>
                  flattenable(mapped, method("flatMap"), false),
                ),
              )
            }
          }),
          Effect.suspend(() => (inner === undefined ? source.close : Effect.andThen(inner.close, source.close))),
        )
      },
    ],
    [
      "reduce",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("reduce"))
        return Effect.gen(function* () {
          let counter = 0
          let accumulator = args[1]
          if (args.length < 2) {
            const first = yield* source.next
            if (first.done) throw typeError("Iterator.prototype.reduce of an empty iterator with no initial value.")
            accumulator = first.value
            counter = 1
          }
          while (true) {
            const step = yield* source.next
            if (step.done) return accumulator
            accumulator = yield* guarded(source, apply([accumulator, step.value, counter++]))
          }
        })
      },
    ],
    [
      "toArray",
      0,
      (thisValue) => {
        const source = ctx.iterateDirect(thisValue)
        return Effect.gen(function* () {
          const items: Array<Value> = []
          while (true) {
            const step = yield* source.next
            if (step.done) return new Arr(builtins.Array, items)
            items.push(step.value)
          }
        })
      },
    ],
    [
      "forEach",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("forEach"))
        return Effect.gen(function* () {
          let counter = 0
          while (true) {
            const step = yield* source.next
            if (step.done) return undefined
            yield* guarded(source, apply([step.value, counter++]))
          }
        })
      },
    ],
    [
      "some",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("some"))
        return Effect.gen(function* () {
          let counter = 0
          while (true) {
            const step = yield* source.next
            if (step.done) return false
            if (yield* guarded(source, apply([step.value, counter++]))) {
              yield* source.close
              return true
            }
          }
        })
      },
    ],
    [
      "every",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("every"))
        return Effect.gen(function* () {
          let counter = 0
          while (true) {
            const step = yield* source.next
            if (step.done) return true
            if (!(yield* guarded(source, apply([step.value, counter++])))) {
              yield* source.close
              return false
            }
          }
        })
      },
    ],
    [
      "find",
      1,
      (thisValue, args) => {
        const source = ctx.iterateDirect(thisValue)
        const apply = applyCollectionCallback(ctx, args[0], method("find"))
        return Effect.gen(function* () {
          let counter = 0
          while (true) {
            const step = yield* source.next
            if (step.done) return undefined
            if (yield* guarded(source, apply([step.value, counter++]))) {
              yield* source.close
              return step.value
            }
          }
        })
      },
    ],
  ])

  // Helpers and `Iterator.from` wrappers can be closed; collection iterators, as in JS, cannot.
  methods(builtins, builtins.IteratorHelper, [
    [
      "return",
      0,
      (thisValue) =>
        Effect.map(receiver(IteratorObj, thisValue, "Iterator.prototype.return").cursor.close, () =>
          record(builtins.Object, { value: undefined, done: true }),
        ),
    ],
  ])

  const iterator = constructor<R>(builtins, proto, {
    name: "Iterator",
    length: 0,
    call: requiresNew("Iterator"),
    construct: () =>
      Effect.sync(() => {
        throw typeError("Iterator is abstract; use Iterator.from(...) or a built-in iterator.")
      }),
  })
  define(
    iterator,
    "from",
    fn(builtins, "from", 1, (_, args) =>
      Effect.gen(function* () {
        if (args[0] instanceof Obj && hasPrototype(args[0], proto)) return args[0]
        return new IteratorObj(builtins.IteratorHelper, yield* flattenable(args[0], "Iterator.from", true))
      }),
    ),
    hidden,
  )
  return iterator
}
