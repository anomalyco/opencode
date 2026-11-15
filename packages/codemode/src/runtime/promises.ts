import { type AstNode, Throw, typeError } from "./model.js"
import { Callable, changed, define, hidden, Arr, Fn, Obj, PromiseObj, record, Resolver, type Value } from "./objects.js"
import { constructor, methods, native, receiver, requiresNew } from "./native.js"
import { createAggregateErrorValue, materialize } from "./errors.js"
import { describeValue, typeofValue } from "./references.js"
import { isSupportedCallback } from "./callback.js"
import type { Interpreter } from "./interpreter.js"
import { type Completion, Interruption, Push } from "./signals.js"
import type { Combination, Reaction, Resolving } from "../scheduler.js"
import { finishAwaitReturn } from "../generators.js"

// A `resolve`/`reject` handed to an executor or thenable: calling it settles the capability.
const resolvingFunctions = <R>(ctx: Interpreter<R>, resolving: Resolving) => ({
  resolve: new Resolver(ctx.builtins.Function, "resolve", resolving, "resolve"),
  reject: new Resolver(ctx.builtins.Function, "reject", resolving, "reject"),
})

/**
 * NewPromiseCapability(%Promise%): a pending promise with what settles it once. A built-in's own failure that rejects
 * it is located at `site`, the call that created it.
 */
export const capability = <R>(ctx: Interpreter<R>, site: AstNode | undefined): Resolving =>
  ctx.vm.scheduler.resolving(ctx.vm.scheduler.newPromise(), site)

/** Settles `resolving` with a completion: a fulfillment value is resolved, so a thenable is adopted. */
const settleWith = (resolving: Resolving, completion: Completion) =>
  completion.ok ? resolving.resolve(completion.value as Value) : resolving.reject(completion.error)

/**
 * Runs a settled promise's reaction as a job: it finishes at once, or returns the call into program code the VM makes
 * for it.
 */
export const react = <R>(
  ctx: Interpreter<R>,
  reaction: Exclude<Reaction, { readonly kind: "await" | "asyncFromSync" }>,
  settled: Completion,
): JobCall | void => {
  switch (reaction.kind) {
    case "settle":
      return settleWith(reaction.target, settled)
    case "handler":
      return handle(ctx, reaction, settled)
    case "combinator":
      return combine(ctx, reaction, settled)
    case "finally":
      return cleanUp(ctx, reaction, settled)
    case "finallyCleaned":
      return settled.ok ? reaction.target.resolve(undefined) : reaction.target.reject(settled.error)
    case "finallyOutcome":
      return settleWith(reaction.target, settled.ok ? reaction.outcome : settled)
    case "awaitReturn":
      return finishAwaitReturn(ctx.vm, reaction.generator, settled)
  }
}

/**
 * A job that calls program code once, which the VM runs (`VmScheduler.beginJob`), counted toward the depth limit:
 * - `thenable` (PromiseResolveThenableJob): calls the thenable's `then` with the resolving functions; a throw rejects
 *   `resolving`.
 * - `handler` (PromiseReactionJob): a `then`/`catch` handler; its result or failure settles `derived`.
 * - `finally` (PromiseFinallyJob): a `finally` cleanup; once its own result settles, the original outcome passes on to
 *   `made` (the spec chains `then(valueThunk)` onto the cleanup's promise: one more job), and a failing cleanup wins.
 */
export type JobCall =
  | {
      readonly kind: "thenable"
      readonly resolving: Resolving
      readonly then: Value
      readonly thenable: Obj
      readonly functions: Array<Value>
    }
  | { readonly kind: "handler"; readonly derived: Resolving; readonly handler: Callable; readonly argument: Value }
  | {
      readonly kind: "finally"
      readonly made: Resolving
      readonly cleanup: Callable
      readonly site: AstNode | undefined
      readonly outcome: Completion
    }

/**
 * NewPromiseResolveThenableJob: the work that calls the thenable's `then`. Adopting a native promise through the
 * intrinsic `then` takes the same jobs as calling it, and keeps the rejection as thrown so its diagnostic survives.
 */
export const adoptThenable = <R>(
  ctx: Interpreter<R>,
  promise: PromiseObj,
  thenable: Obj,
  then: Value,
): JobCall | void => {
  const vm = ctx.vm
  const resolving = vm.scheduler.resolving(promise)
  if (then === vm.scheduler.intrinsicThen && thenable instanceof PromiseObj) {
    vm.scheduler.then(thenable, { kind: "settle", target: resolving })
    return
  }
  const proto = ctx.builtins.Function
  const resolve = new Resolver(proto, "", resolving, "resolve")
  const reject = new Resolver(proto, "", resolving, "reject")
  return { kind: "thenable", resolving, then, thenable, functions: [resolve, reject] }
}

// A `then`/`catch` reaction calls program code: the handler runs as a job, and its result or failure settles the
// derived promise. A missing handler passes the outcome through.
const handle = <R>(
  ctx: Interpreter<R>,
  reaction: Extract<Reaction, { readonly kind: "handler" }>,
  settled: Completion,
): JobCall | void => {
  const handler = settled.ok ? reaction.onFulfilled : reaction.onRejected
  const derived = reaction.derived
  if (handler === undefined || (!settled.ok && settled.error instanceof Interruption)) {
    return settleWith(derived, settled)
  }
  const argument = settled.ok ? (settled.value as Value) : materialize(ctx, settled.error)
  return { kind: "handler", derived, handler, argument }
}

const promiseStatics = ["all", "allSettled", "race", "any", "resolve", "reject", "withResolvers", "try"] as const

const invokePromiseMethod = <R>(
  ctx: Interpreter<R>,
  name: (typeof promiseStatics)[number],
  args: Array<Value>,
  site: AstNode | undefined,
) => {
  if (name === "resolve") return ctx.vm.scheduler.promiseResolve(args[0])
  if (name === "reject") {
    const made = capability(ctx, site)
    made.reject(new Throw(args[0]))
    return made.promise
  }
  if (name === "withResolvers") {
    const made = capability(ctx, site)
    const functions = resolvingFunctions(ctx, made)
    return record(ctx.builtins.Object, { promise: made.promise, resolve: functions.resolve, reject: functions.reject })
  }
  if (name === "try") {
    if (typeofValue(args[0]) !== "function") {
      throw typeError(`Promise.try expects a function, received ${describeValue(args[0])}.`)
    }
    return new Push("Promise.try", [capability(ctx, site), args[0], args.slice(1)])
  }
  return new Push("Promise combinator", [capability(ctx, site), name, args[0]])
}

// Promise.all, allSettled, race, and any: the prelude iterates the input (`$vmCombine`), resolving each element to a
// promise observed through a reaction, so the result settles in the job where the deciding element's reaction runs,
// or at once for an empty input. A failure while iterating rejects the result.

// One member settled. Once the result settles early, the remaining members' reactions can do nothing: they are
// detached so a member that stays pending for the rest of the program does not keep them.
const combine = <R>(
  ctx: Interpreter<R>,
  reaction: Extract<Reaction, { readonly kind: "combinator" }>,
  settled: Completion,
) => {
  if (reaction.called) return
  reaction.called = true
  const combination = reaction.combination
  const made = combination.made
  const name = combination.name
  if (name === "race" || (!settled.ok && settled.error instanceof Interruption)) {
    settleWith(made, settled)
    return detachAll(ctx, combination)
  }
  if (name === "all") {
    if (!settled.ok) {
      made.reject(settled.error)
      return detachAll(ctx, combination)
    }
    combination.values[reaction.index] = settled.value as Value
    return finishCombination(ctx, combination)
  }
  if (name === "any") {
    if (settled.ok) {
      made.resolve(settled.value as Value)
      return detachAll(ctx, combination)
    }
    combination.reasons[reaction.index] = materialize(ctx, settled.error)
    return finishCombination(ctx, combination)
  }
  combination.values[reaction.index] = settled.ok
    ? record(ctx.builtins.Object, { status: "fulfilled", value: settled.value as Value })
    : record(ctx.builtins.Object, { status: "rejected", reason: materialize(ctx, settled.error) })
  finishCombination(ctx, combination)
}

const detachAll = <R>(ctx: Interpreter<R>, combination: Combination) => {
  for (const [item, reaction] of combination.attached) ctx.vm.scheduler.detach(item, reaction)
}

export const finishCombination = <R>(ctx: Interpreter<R>, combination: Combination) => {
  if (--combination.remaining > 0) return
  if (combination.name === "any") {
    combination.made.reject(
      new Throw(createAggregateErrorValue(ctx, combination.reasons, "All promises were rejected")),
    )
    return
  }
  combination.made.resolve(new Arr(ctx.builtins.Array, combination.values))
}

const instanceMethod = <R>(
  ctx: Interpreter<R>,
  name: "then" | "catch" | "finally",
  thisValue: Value,
  args: Array<Value>,
  site: AstNode | undefined,
): Value => {
  const method = `Promise.prototype.${name}`
  const promise = receiver(PromiseObj, thisValue, method)
  if (name === "finally") return chainFinally(ctx, promise, reactionHandler(args[0], method), site)
  const onFulfilled = name === "then" ? reactionHandler(args[0], method) : undefined
  const onRejected = reactionHandler(name === "then" ? args[1] : args[0], method)
  const made = capability(ctx, site)
  ctx.vm.scheduler.then(promise, { kind: "handler", onFulfilled, onRejected, derived: made })
  return made.promise
}

// Promise.prototype.finally: the cleanup runs as a reaction, then the original outcome passes through once the
// cleanup's own result settles; a failing cleanup wins.
const chainFinally = <R>(
  ctx: Interpreter<R>,
  source: PromiseObj,
  cleanup: Callable | undefined,
  site: AstNode | undefined,
): PromiseObj => {
  const made = capability(ctx, site)
  ctx.vm.scheduler.then(
    source,
    cleanup === undefined ? { kind: "settle", target: made } : { kind: "finally", cleanup, target: made, site },
  )
  return made.promise
}

const cleanUp = <R>(
  _ctx: Interpreter<R>,
  reaction: Extract<Reaction, { readonly kind: "finally" }>,
  settled: Completion,
): JobCall | void => {
  const made = reaction.target
  if (!settled.ok && settled.error instanceof Interruption) return made.reject(settled.error)
  return { kind: "finally", made, cleanup: reaction.cleanup, site: reaction.site, outcome: settled }
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

const constructPromise = <R>(ctx: Interpreter<R>, executor: Value, site: AstNode | undefined) => {
  if (!(executor instanceof Fn)) {
    throw typeError("new Promise(...) expects an executor function (e.g. new Promise((resolve, reject) => { ... })).")
  }
  const made = capability(ctx, site)
  const functions = resolvingFunctions(ctx, made)
  return new Push("Promise executor", [made, executor, [functions.resolve, functions.reject]])
}

/**
 * Lets a synchronous object result also be awaited or chained like a Promise. It inherits non-enumerable
 * then/catch/finally that settle with a plain copy, so data views never show them and awaiting does not recurse.
 */
export const promiseLike = <R>(ctx: Interpreter<R>, value: Value): Value => {
  if (!(value instanceof Obj) || value.proto !== ctx.builtins.Object) return value
  changed(value)
  value.proto = ctx.builtins.PromiseLike
  return value
}

const promiseLikeMethods = <R>(ctx: Interpreter<R>) => {
  const settled = (thisValue: Value, name: string) => {
    const source = receiver(Obj, thisValue, name)
    const copy = new Obj(ctx.builtins.Object)
    for (const [key, slot] of source.props) copy.props.set(key, { ...slot })
    return ctx.vm.scheduler.promiseResolve(copy)
  }
  methods(
    ctx.builtins,
    ctx.builtins.PromiseLike,
    (["then", "catch", "finally"] as const).map((name) => [
      name,
      name === "then" ? 2 : 1,
      (thisValue, args, site) => instanceMethod(ctx, name, settled(thisValue, name), args, site),
    ]),
  )
}

export const promiseGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Promise
  const promise = constructor(builtins, proto, {
    name: "Promise",
    length: 1,
    call: requiresNew("Promise"),
    construct: (args, _, site) => constructPromise(ctx, args[0], site),
  })
  // Combinators are not callbacks: `[p].map(Promise.resolve)` must ask for an arrow function.
  for (const name of promiseStatics) {
    define(
      promise,
      name,
      native(builtins, {
        name,
        length: 1,
        call: (_, args, site) => invokePromiseMethod(ctx, name, args, site),
        callback: false,
      }),
      hidden,
    )
  }
  methods(builtins, proto, [
    ["then", 2, (thisValue, args, site) => instanceMethod(ctx, "then", thisValue, args, site)],
    ["catch", 1, (thisValue, args, site) => instanceMethod(ctx, "catch", thisValue, args, site)],
    ["finally", 1, (thisValue, args, site) => instanceMethod(ctx, "finally", thisValue, args, site)],
  ])
  promiseLikeMethods(ctx)
  return promise
}
