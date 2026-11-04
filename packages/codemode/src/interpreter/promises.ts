import { type AstNode, Throw, typeError } from "./model.js"
import {
  Callable,
  define,
  get,
  hidden,
  Arr,
  Fn,
  Obj,
  PromiseObj,
  record,
  Resolver,
  type Step,
  type Value,
} from "./objects.js"
import { constructor, methods, native, receiver, requiresNew } from "./native.js"
import { createAggregateErrorValue, materialize } from "./errors.js"
import { describeValue, typeofValue } from "./references.js"
import { isSupportedCallback } from "./callback.js"
import type { Interpreter } from "./interpreter.js"
import { type Completion, Interruption, Push } from "./signals.js"
import { type Frame, kind, type Kind, PENDING } from "../machine/frame.js"
import { type Iter, iterate, iteratorStep } from "../machine/iteration.js"
import type { MachineTask } from "../machine/task.js"
import type { Combination, Reaction, Resolving } from "../machine/scheduler.js"
import { finishAwaitReturn } from "../machine/generators.js"

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
  ctx.machine.resolving(ctx.machine.newPromise(), site)

/** Settles `resolving` with a completion: a fulfillment value is resolved, so a thenable is adopted. */
const settleWith = (resolving: Resolving, completion: Completion) =>
  completion.ok ? resolving.resolve(completion.value as Value) : resolving.reject(completion.error)

/**
 * Runs a settled promise's reaction as a job: it finishes at once, or returns the frame that runs the program code it
 * calls.
 */
export const react = <R>(
  ctx: Interpreter<R>,
  reaction: Exclude<Reaction, { readonly kind: "await" | "asyncFromSync" }>,
  settled: Completion,
): JobFrame | void => {
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
      return finishAwaitReturn(ctx, reaction.generator, settled)
  }
}

/** A job's frame: its kind and slots. */
export type JobFrame = { readonly kind: Kind; readonly slots: Array<unknown> }

/**
 * NewPromiseResolveThenableJob: the work that calls the thenable's `then`. Adopting a native promise through the
 * intrinsic `then` takes the same jobs as calling it, and keeps the rejection as thrown so its diagnostic survives.
 */
export const adoptThenable = <R>(
  ctx: Interpreter<R>,
  promise: PromiseObj,
  thenable: Obj,
  then: Value,
): JobFrame | void => {
  const machine = ctx.machine
  const resolving = machine.resolving(promise)
  if (then === machine.intrinsicThen && thenable instanceof PromiseObj) {
    machine.then(thenable, { kind: "settle", target: resolving })
    return
  }
  const proto = ctx.builtins.Function
  const resolve = new Resolver(proto, "", resolving, "resolve")
  const reject = new Resolver(proto, "", resolving, "reject")
  return { kind: ThenableJob, slots: [resolving, then, thenable, [resolve, reject]] }
}

// The phase a job or a promise-returning built-in is in once what it settles has taken a failure.
const SETTLED = -2

/**
 * A frame that calls program code once and settles `slots[0]` (a `Resolving`) with how it ends: `done` decides what a
 * normal completion does, and a failure rejects it. As a job it counts toward the depth limit; as a built-in its
 * result is the promise.
 */
const settling = (
  name: string,
  call: (slots: Array<unknown>) => readonly [callable: Value, thisValue: Value, args: Array<Value>],
  done: (task: MachineTask, slots: Array<unknown>, result: Value) => void,
  job: boolean,
) =>
  kind(
    name,
    (task, frame: Frame, _node, input) => {
      const slots = frame.slots
      const resolving = slots[0] as Resolving
      if (frame.phase === SETTLED) return job ? undefined : resolving.promise
      let result = input as Value
      if (frame.phase === 0) {
        frame.phase = 1
        const [callable, thisValue, args] = call(slots)
        const called = task.call(callable, thisValue, args, undefined)
        if (called === PENDING) return PENDING
        result = called
      }
      done(task, slots, result)
      return job ? undefined : resolving.promise
    },
    {
      unwind: (_task, frame, error) => {
        if (frame.phase === SETTLED) return false
        ;(frame.slots[0] as Resolving).reject(error)
        frame.phase = SETTLED
        return true
      },
      counts: () => job,
    },
  )

// Slots: what settles the promise, `then`, the thenable, and the resolving functions.
const ThenableJob = settling(
  "PromiseResolveThenableJob",
  (slots) => [slots[1] as Value, slots[2] as Value, slots[3] as Array<Value>],
  () => undefined,
  true,
)

// A `then`/`catch` reaction calls program code: the handler runs as a job, and its result or failure settles the
// derived promise. A missing handler passes the outcome through.
const handle = <R>(
  ctx: Interpreter<R>,
  reaction: Extract<Reaction, { readonly kind: "handler" }>,
  settled: Completion,
): JobFrame | void => {
  const handler = settled.ok ? reaction.onFulfilled : reaction.onRejected
  const derived = reaction.derived
  if (handler === undefined || (!settled.ok && settled.error instanceof Interruption)) {
    return settleWith(derived, settled)
  }
  const argument = settled.ok ? (settled.value as Value) : materialize(ctx, settled.error)
  return { kind: HandlerJob, slots: [derived, handler, argument] }
}

// Slots: the derived promise's resolving, the handler, and its argument.
const HandlerJob = settling(
  "PromiseReactionJob",
  (slots) => [slots[1] as Value, undefined, [slots[2] as Value]],
  (_task, slots, result) => (slots[0] as Resolving).resolve(result),
  true,
)

const promiseStatics = ["all", "allSettled", "race", "any", "resolve", "reject", "withResolvers", "try"] as const

const invokePromiseMethod = <R>(
  ctx: Interpreter<R>,
  name: (typeof promiseStatics)[number],
  args: Array<Value>,
  site: AstNode | undefined,
) => {
  const machine = ctx.machine
  if (name === "resolve") return machine.promiseResolve(args[0])
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
    return new Push(PromiseTry, [capability(ctx, site), args[0], args.slice(1)])
  }
  return new Push(Combinator, [capability(ctx, site), name, args[0], undefined, undefined])
}

// Slots: what settles the promise, the function, and its arguments.
const PromiseTry = settling(
  "Promise.try",
  (slots) => [slots[1] as Value, undefined, slots[2] as Array<Value>],
  (_task, slots, result) => (slots[0] as Resolving).resolve(result),
  false,
)

// Promise.all, allSettled, race, and any: each element is resolved to a promise and observed through a reaction, so
// the result settles in the job where the deciding element's reaction runs, or at once for an empty input. A failure
// while iterating rejects the result. Slots: what settles the result, the combinator, the iterable, its iterator, and
// the state the members' reactions share.
const Combinator = kind(
  "Promise combinator",
  (task, frame: Frame, node, input) => {
    const slots = frame.slots
    const made = slots[0] as Resolving
    const name = slots[1] as Combination["name"]
    if (frame.phase === SETTLED) return made.promise
    if (frame.phase === 0) {
      frame.phase = 1
      const opened = iterate(task, slots[2] as Value, node as AstNode)
      if (opened === PENDING) return PENDING
      input = opened
    }
    if (frame.phase === 1) {
      if (input === undefined) {
        throw typeError(`Promise.${name} expects a synchronous iterable, received ${describeValue(slots[2] as Value)}.`)
      }
      slots[3] = input
      slots[4] = { name, made, values: [], reasons: [], remaining: 1, attached: [] } satisfies Combination
    } else if (!take(task, slots[4] as Combination, input as Step)) return made.promise
    frame.phase = 2
    while (true) {
      const step = iteratorStep(task, slots[3] as Iter, node as AstNode)
      if (step === PENDING) return PENDING
      if (!take(task, slots[4] as Combination, step)) return made.promise
    }
  },
  {
    unwind: (_task, frame, error) => {
      if (frame.phase === SETTLED) return false
      ;(frame.slots[0] as Resolving).reject(error)
      frame.phase = SETTLED
      return true
    },
  },
)

// Observes one member; once iteration is done, settles an empty result and reports false.
const take = (task: MachineTask, combination: Combination, step: Step): boolean => {
  const machine = task.machine
  if (step.done) {
    if (combination.name === "race" && combination.attached.length === 0) {
      throw typeError("Promise.race([]) would never settle; provide at least one promise or value.")
    }
    finishCombination(task.ctx, combination)
    return false
  }
  const item = machine.promiseResolve(step.value)
  const reaction: Reaction = { kind: "combinator", combination, index: combination.values.length, called: false }
  combination.values.push(undefined)
  combination.reasons.push(undefined)
  combination.remaining++
  combination.attached.push([item, reaction])
  machine.then(item, reaction)
  return true
}

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
  for (const [item, reaction] of combination.attached) ctx.machine.detach(item, reaction)
}

const finishCombination = <R>(ctx: Interpreter<R>, combination: Combination) => {
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
  ctx.machine.then(promise, { kind: "handler", onFulfilled, onRejected, derived: made })
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
  ctx.machine.then(
    source,
    cleanup === undefined ? { kind: "settle", target: made } : { kind: "finally", cleanup, target: made, site },
  )
  return made.promise
}

const cleanUp = <R>(
  _ctx: Interpreter<R>,
  reaction: Extract<Reaction, { readonly kind: "finally" }>,
  settled: Completion,
): JobFrame | void => {
  const made = reaction.target
  if (!settled.ok && settled.error instanceof Interruption) return made.reject(settled.error)
  return { kind: FinallyJob, slots: [made, reaction.cleanup, reaction.site, settled] }
}

// Slots: what settles the result, the cleanup, the call that chained it, and the original outcome. The spec chains
// `then(valueThunk)` onto the cleanup's promise: one more job before the outcome passes.
const FinallyJob = settling(
  "PromiseFinallyJob",
  (slots) => [slots[1] as Value, undefined, []],
  (task, slots, result) => {
    const machine = task.machine
    const after = machine.promiseResolve(result)
    const derived = capability(task.ctx, slots[2] as AstNode | undefined)
    machine.then(after, { kind: "finallyCleaned", target: derived })
    machine.then(derived.promise, {
      kind: "finallyOutcome",
      target: slots[0] as Resolving,
      outcome: slots[3] as Completion,
    })
  },
  true,
)

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
  return new Push(PromiseExecutor, [made, executor, [functions.resolve, functions.reject]])
}

// Slots: what settles the promise, the executor, and the resolving functions.
const PromiseExecutor = settling(
  "Promise executor",
  (slots) => [slots[1] as Value, undefined, slots[2] as Array<Value>],
  () => undefined,
  false,
)

/**
 * Lets a synchronous object result also be awaited or chained like a Promise. It inherits non-enumerable
 * then/catch/finally that settle with a plain copy, so data views never show them and awaiting does not recurse.
 */
export const promiseLike = <R>(ctx: Interpreter<R>, value: Value): Value => {
  if (!(value instanceof Obj) || value.proto !== ctx.builtins.Object) return value
  value.proto = ctx.builtins.PromiseLike
  return value
}

const promiseLikeMethods = <R>(ctx: Interpreter<R>) => {
  const settled = (thisValue: Value, name: string) => {
    const source = receiver(Obj, thisValue, name)
    const copy = new Obj(ctx.builtins.Object)
    for (const [key, slot] of source.props) copy.props.set(key, { ...slot })
    return ctx.machine.promiseResolve(copy)
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
  const then = get(proto, "then")
  if (then instanceof Callable) ctx.machine.intrinsicThen = then
  promiseLikeMethods(ctx)
  return promise
}
