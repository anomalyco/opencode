import { Throw, typeError } from "./model.js"
import { Callable, define, get, hidden, Arr, Fn, PromiseObj, record, type Value } from "./objects.js"
import { constructor, fn, methods, native, receiver, requiresNew } from "./native.js"
import { createAggregateErrorValue, materialize } from "./errors.js"
import { describeValue, typeofValue } from "./references.js"
import { isSupportedCallback } from "./callback.js"
import type { Interpreter } from "./interpreter.js"
import { type Completion, type Eval, normal, type Reaction, type Resolving, Task } from "./runner.js"

// A `resolve`/`reject` handed to an executor or thenable: calling it settles the capability.
const resolvingFunctions = <R>(ctx: Interpreter<R>, resolving: Resolving) => ({
  resolve: fn(ctx.builtins, "resolve", 1, (_, args) => {
    resolving.resolve(args[0])
    return undefined
  }),
  reject: fn(ctx.builtins, "reject", 1, (_, args) => {
    resolving.reject(new Throw(args[0]))
    return undefined
  }),
})

/**
 * NewPromiseCapability(%Promise%): a pending promise with the host functions that settle it once. A built-in's own
 * failure that rejects it is located at the call that created it.
 */
export const capability = <R>(ctx: Interpreter<R>) => {
  const promise = ctx.runner.newPromise()
  return { promise, ...ctx.runner.resolving(promise, ctx.site) }
}

/** Settles `resolving` with a completion: a fulfillment value is resolved, so a thenable is adopted. */
const settleWith = (resolving: Resolving, completion: Completion) =>
  completion.ok ? resolving.resolve(completion.value as Value) : resolving.reject(completion.error)

/**
 * A promise reaction that calls program code: the handler runs as a job, and its result or failure settles the
 * derived promise. A missing handler passes the outcome through.
 */
const handlerReaction =
  <R>(
    ctx: Interpreter<R>,
    onFulfilled: Callable | undefined,
    onRejected: Callable | undefined,
    derived: Resolving | undefined,
  ): Reaction =>
  (settled) => {
    const handler = settled.ok ? onFulfilled : onRejected
    if (handler === undefined) {
      if (derived !== undefined) settleWith(derived, settled)
      return
    }
    const argument = settled.ok ? (settled.value as Value) : materialize(ctx, settled.error)
    const body = function* (): Eval<void> {
      let result: Value
      try {
        result = yield* ctx.call(handler, undefined, [argument])
      } catch (error) {
        derived?.reject(error)
        return
      }
      derived?.resolve(result)
    }
    return { task: new Task([{ body: body(), boundary: undefined }]), input: normal(undefined) }
  }

const promiseStatics = ["all", "allSettled", "race", "any", "resolve", "reject", "withResolvers", "try"] as const

function* invokePromiseMethod<R>(
  ctx: Interpreter<R>,
  name: (typeof promiseStatics)[number],
  args: Array<Value>,
): Eval<Value> {
  const runner = ctx.runner
  if (name === "resolve") return runner.promiseResolve(args[0])
  if (name === "reject") {
    const made = capability(ctx)
    made.reject(new Throw(args[0]))
    return made.promise
  }
  if (name === "withResolvers") {
    const made = capability(ctx)
    const functions = resolvingFunctions(ctx, made)
    return record(ctx.builtins.Object, { promise: made.promise, resolve: functions.resolve, reject: functions.reject })
  }
  if (name === "try") {
    if (typeofValue(args[0]) !== "function") {
      throw typeError(`Promise.try expects a function, received ${describeValue(args[0])}.`)
    }
    const made = capability(ctx)
    try {
      made.resolve(yield* ctx.call(args[0], undefined, args.slice(1)))
    } catch (error) {
      made.reject(error)
    }
    return made.promise
  }
  return yield* combinator(ctx, name, args[0])
}

// Promise.all, allSettled, race, and any: each element is resolved to a promise and observed through a reaction, so
// the result settles in the job where the deciding element's reaction runs, or at once for an empty input. A failure
// while iterating rejects the result.
function* combinator<R>(
  ctx: Interpreter<R>,
  name: "all" | "allSettled" | "race" | "any",
  iterable: Value,
): Eval<Value> {
  const runner = ctx.runner
  const made = capability(ctx)
  try {
    const cursor = yield* ctx.iterate(iterable)
    if (cursor === undefined) {
      throw typeError(`Promise.${name} expects a synchronous iterable, received ${describeValue(iterable)}.`)
    }
    const values: Array<Value> = []
    const reasons: Array<Value> = []
    let remaining = 1
    let index = 0
    const finish = () => {
      if (--remaining > 0) return
      if (name === "any") {
        made.reject(new Throw(createAggregateErrorValue(ctx, reasons, "All promises were rejected")))
        return
      }
      made.resolve(new Arr(ctx.builtins.Array, values))
    }
    while (true) {
      const step = yield* cursor.next()
      if (step.done) break
      const item = runner.promiseResolve(step.value)
      const at = index++
      values.push(undefined)
      reasons.push(undefined)
      remaining++
      let called = false
      runner.then(item, (settled) => {
        if (called) return
        called = true
        if (name === "race") return settleWith(made, settled)
        if (name === "all") {
          if (!settled.ok) return made.reject(settled.error)
          values[at] = settled.value as Value
          return finish()
        }
        if (name === "any") {
          if (settled.ok) return made.resolve(settled.value as Value)
          reasons[at] = materialize(ctx, settled.error)
          return finish()
        }
        values[at] = settled.ok
          ? record(ctx.builtins.Object, { status: "fulfilled", value: settled.value as Value })
          : record(ctx.builtins.Object, { status: "rejected", reason: materialize(ctx, settled.error) })
        finish()
      })
    }
    if (name === "race" && index === 0) {
      throw typeError("Promise.race([]) would never settle; provide at least one promise or value.")
    }
    finish()
  } catch (error) {
    made.reject(error)
  }
  return made.promise
}

const instanceMethod = <R>(
  ctx: Interpreter<R>,
  name: "then" | "catch" | "finally",
  thisValue: Value,
  args: Array<Value>,
): Value => {
  const method = `Promise.prototype.${name}`
  const promise = receiver(PromiseObj, thisValue, method)
  if (name === "finally") return chainFinally(ctx, promise, reactionHandler(args[0], method))
  const onFulfilled = name === "then" ? reactionHandler(args[0], method) : undefined
  const onRejected = reactionHandler(name === "then" ? args[1] : args[0], method)
  const made = capability(ctx)
  ctx.runner.then(promise, handlerReaction(ctx, onFulfilled, onRejected, made))
  return made.promise
}

// Promise.prototype.finally: the cleanup runs as a reaction, then the original outcome passes through once the
// cleanup's own result settles; a failing cleanup wins.
const chainFinally = <R>(ctx: Interpreter<R>, source: PromiseObj, cleanup: Callable | undefined): PromiseObj => {
  const runner = ctx.runner
  const made = capability(ctx)
  if (cleanup === undefined) {
    runner.then(source, (settled) => settleWith(made, settled))
    return made.promise
  }
  runner.then(source, (settled) => {
    const body = function* (): Eval<void> {
      let result: Value
      try {
        result = yield* ctx.call(cleanup, undefined, [])
      } catch (error) {
        made.reject(error)
        return
      }
      let after: PromiseObj
      try {
        after = runner.promiseResolve(result)
      } catch (error) {
        made.reject(error)
        return
      }
      // The spec chains `then(valueThunk)` onto the cleanup's promise: one more job before the outcome passes.
      const derived = capability(ctx)
      runner.then(after, (cleaned) => (cleaned.ok ? derived.resolve(undefined) : derived.reject(cleaned.error)))
      runner.then(derived.promise, (cleaned) => settleWith(made, cleaned.ok ? settled : cleaned))
    }
    return { task: new Task([{ body: body(), boundary: undefined }]), input: normal(undefined) }
  })
  return made.promise
}

const reactionHandler = (value: Value, method: string): Callable | undefined => {
  if (isSupportedCallback(value)) return value
  if (typeofValue(value) === "function") {
    throw typeError(
      `${method} cannot use this callable as a handler; wrap it in an arrow function, e.g. (value) => tools.ns.tool(value).`,
    )
  }
  return undefined
}

function* constructPromise<R>(ctx: Interpreter<R>, executor: Value): Eval<Value> {
  if (!(executor instanceof Fn)) {
    throw typeError("new Promise(...) expects an executor function (e.g. new Promise((resolve, reject) => { ... })).")
  }
  const made = capability(ctx)
  const functions = resolvingFunctions(ctx, made)
  try {
    yield* ctx.call(executor, undefined, [functions.resolve, functions.reject])
  } catch (error) {
    made.reject(error)
  }
  return made.promise
}

export const promiseGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Promise
  const promise = constructor(builtins, proto, {
    name: "Promise",
    length: 1,
    call: requiresNew("Promise"),
    construct: (args) => constructPromise(ctx, args[0]),
  })
  // Combinators are not callbacks: `[p].map(Promise.resolve)` must ask for an arrow function.
  for (const name of promiseStatics) {
    define(
      promise,
      name,
      native(builtins, {
        name,
        length: 1,
        call: (_, args) => invokePromiseMethod(ctx, name, args),
        callback: false,
      }),
      hidden,
    )
  }
  methods(builtins, proto, [
    ["then", 2, (thisValue, args) => instanceMethod(ctx, "then", thisValue, args)],
    ["catch", 1, (thisValue, args) => instanceMethod(ctx, "catch", thisValue, args)],
    ["finally", 1, (thisValue, args) => instanceMethod(ctx, "finally", thisValue, args)],
  ])
  const then = get(proto, "then")
  if (then instanceof Callable) ctx.runner.intrinsicThen = then
  return promise
}
