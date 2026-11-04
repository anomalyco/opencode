import type { Interpreter } from "../interpreter/interpreter.js"
import type { ScopeStack } from "../interpreter/scope.js"
import { type AstNode, GeneratorReturn, type GeneratorRequestKind, Throw, typeError } from "../interpreter/model.js"
import {
  get,
  GeneratorObj,
  iteratorResult,
  Opaque,
  type Obj,
  type PromiseObj,
  type Step,
  type Value,
} from "../interpreter/objects.js"
import {
  builtinCursor,
  type CustomIterator,
  requireIteratorMethod,
  requireIteratorObject,
} from "../interpreter/operations.js"
import { capability } from "../interpreter/promises.js"
import {
  abrupt,
  Await,
  type Completion,
  Enter,
  type GeneratorRequest,
  Interruption,
  normal,
  Yield,
} from "../interpreter/signals.js"
import { Frame, kind, type Out, PENDING } from "./frame.js"
import { type Iter, isCustom, iteratorClose, iteratorStep, openIterator } from "./iteration.js"
import type { Reaction, Resolving } from "./scheduler.js"
import type { MachineTask } from "./task.js"

// Generators, `yield*`, and the async-from-sync iterator adapter, as frames. A generator's suspended body is the slice
// of frames from its `GeneratorBody` boundary up, kept on the generator object; `next`/`return`/`throw` put it back on
// the stack that calls them, and a `yield` cuts it off again.

const result = <R>(ctx: Interpreter<R>, value: Value, done: boolean) => iteratorResult(ctx.builtins.Object, value, done)

// The phases of a generator boundary: waiting for the body's result, the body ended by a `return()` request or (async)
// by a throw, and finished.
const RETURNED = 1
const THREW = 2
const FINISHED = 3

/**
 * The frames a new generator starts from: its boundary, then the body's own frame (`body`), which runs once the first
 * request puts them on a stack.
 */
export const generatorFrames = (generator: GeneratorObj, body: Frame): Array<Frame> => [
  new Frame(GeneratorBody, body.node, 0, body.scope, [generator, undefined, undefined]),
  body,
]

// Slots: the generator, what the call that resumed the body receives once it suspends or ends (an async generator's
// request promise), and the value or failure the body ended with.
function generatorBodyStep(task: MachineTask, frame: Frame, _node: AstNode, input: unknown): Value {
  const slots = frame.slots
  const phase = frame.phase
  frame.phase = FINISHED
  const generator = slots[0] as GeneratorObj
  const value = (phase === RETURNED ? slots[2] : input) as Value
  if (!generator.asynchronous) {
    generator.state = "completed"
    return result(task.ctx, value, true)
  }
  completeStep(task.ctx, generator, phase === THREW ? abrupt(slots[2]) : normal(value), true)
  drainQueue(task.ctx, generator)
  return slots[1] as Value
}

/**
 * Where a generator's body splits off the stack when it yields, and how its end answers the request that ran it. A
 * synchronous generator's caller receives the iterator result; an async generator's receives its request's promise,
 * which also is what an `await` in the body gives it.
 */
export const GeneratorBody = kind("GeneratorBody", generatorBodyStep, {
  unwind: (_task, frame, error) => {
    if (frame.phase === FINISHED) return false
    if (error instanceof GeneratorReturn) {
      frame.phase = RETURNED
      frame.slots[2] = error.value
      return true
    }
    const generator = frame.slots[0] as GeneratorObj
    if (!generator.asynchronous) {
      generator.state = "completed"
      return false
    }
    frame.phase = THREW
    frame.slots[2] = error
    return true
  },
  cut: (frame) => ((frame.slots[0] as GeneratorObj).asynchronous ? normal(frame.slots[1]) : undefined),
  counts: () => true,
  yielded: (task, index, value) => {
    const frame = task.stack[index]!
    const generator = frame.slots[0] as GeneratorObj
    if (!generator.asynchronous) {
      generator.frames = task.split(index)
      generator.state = "suspendedYield"
      return normal(result(task.ctx, value, false))
    }
    // AsyncGeneratorYield: answer the oldest request, and keep running if another is already waiting.
    completeStep(task.ctx, generator, normal(value), false)
    const next = generator.queue[0]
    if (next !== undefined) return normal(next.request)
    generator.frames = task.split(index)
    generator.state = "suspendedYield"
    return normal(frame.slots[1])
  },
})

// Puts the suspended body back on the calling stack and continues it with `request`.
const resume = (generator: GeneratorObj, request: GeneratorRequest): Enter => {
  generator.state = "executing"
  const frames = generator.frames
  generator.frames = []
  return new Enter(frames, normal(request))
}

/** Generator.prototype.next/return/throw: the body runs on the caller's stack until it yields, returns, or throws. */
export const generatorStep = <R>(
  ctx: Interpreter<R>,
  generator: GeneratorObj,
  kind: GeneratorRequestKind,
  value: Value,
): Value | Enter => {
  if (generator.state === "executing") throw typeError("Generator is already running.")
  if (generator.state === "suspendedStart" && kind !== "next") generator.state = "completed"
  if (generator.state === "completed") {
    if (kind === "throw") throw new Throw(value)
    return result(ctx, kind === "return" ? value : undefined, true)
  }
  return resume(generator, { kind, value })
}

/**
 * AsyncGenerator.prototype.next/return/throw: queue the request with its promise, and run the body now if it is
 * waiting for one. A request that arrives while the body runs is answered when the body reaches it.
 */
export const generatorRequest = <R>(
  ctx: Interpreter<R>,
  thisValue: Value,
  kind: GeneratorRequestKind,
  value: Value,
): Value | Enter => {
  const machine = ctx.machine
  const promise = machine.newPromise()
  const resolving = machine.resolving(promise)
  if (!(thisValue instanceof GeneratorObj) || !thisValue.asynchronous) {
    resolving.reject(typeError(`AsyncGenerator.prototype.${kind} called on incompatible receiver.`))
    return promise
  }
  const generator = thisValue
  const state = generator.state
  if (kind === "next" && state === "completed") {
    resolving.resolve(result(ctx, undefined, true))
    return promise
  }
  if (kind === "throw") {
    if (state === "suspendedStart") generator.state = "completed"
    if (generator.state === "completed") {
      resolving.reject(new Throw(value))
      return promise
    }
  }
  const queued = { kind, value }
  generator.queue.push({ request: queued, resolving })
  if (kind === "return" && (state === "suspendedStart" || state === "completed")) {
    generator.state = "awaiting-return"
    awaitReturn(ctx, generator)
    return promise
  }
  if (state !== "suspendedStart" && state !== "suspendedYield") return promise
  generator.frames[0]!.slots[1] = promise
  return resume(generator, queued)
}

// AsyncGeneratorCompleteStep: answer the oldest request.
const completeStep = <R>(ctx: Interpreter<R>, generator: GeneratorObj, completion: Completion, done: boolean) => {
  const next = generator.queue.shift()!
  if (completion.ok) next.resolving.resolve(result(ctx, completion.value as Value, done))
  else next.resolving.reject(completion.error)
}

// AsyncGeneratorDrainQueue: once the body has ended, answer the remaining requests in order.
const drainQueue = <R>(ctx: Interpreter<R>, generator: GeneratorObj) => {
  generator.state = "draining"
  while (true) {
    const next = generator.queue[0]
    if (next === undefined) {
      generator.state = "completed"
      return
    }
    if (next.request.kind === "return") {
      generator.state = "awaiting-return"
      return awaitReturn(ctx, generator)
    }
    completeStep(
      ctx,
      generator,
      next.request.kind === "throw" ? abrupt(new Throw(next.request.value)) : normal(undefined),
      true,
    )
  }
}

// AsyncGeneratorAwaitReturn: a `return(value)` on an ended or unstarted generator settles once `value` does.
const awaitReturn = <R>(ctx: Interpreter<R>, generator: GeneratorObj) => {
  const machine = ctx.machine
  try {
    machine.then(machine.promiseResolve(generator.queue[0]!.request.value), { kind: "awaitReturn", generator })
  } catch (error) {
    finishAwaitReturn(ctx, generator, abrupt(error))
  }
}

/** The `awaitReturn` reaction: answers the `return` request with how its value settled, then drains the queue. */
export const finishAwaitReturn = <R>(ctx: Interpreter<R>, generator: GeneratorObj, completion: Completion) => {
  completeStep(ctx, generator, completion, true)
  drainQueue(ctx, generator)
}

const noThrow = (node: AstNode | undefined) =>
  typeError("The delegated iterator does not provide a throw() method.", node)

/** `yield*`: delegates to the iterable's iterator, forwarding each request, until it is done. */
export const delegate = (task: MachineTask, value: Value, node: AstNode, asynchronous: boolean): Out<Value> =>
  delegateStep(task, undefined, node, value, asynchronous)

// The phases of `yield*`: open the iterator (0), have the opened program iterator; for a synchronous built-in iterator,
// step it, have the step, have the request a yield resumed with, and close it after a return or throw request; for any
// other iterator, call the method for the current request (the loop top), have its result, have it awaited, have the
// request, have a return request's value awaited, have a missing `return` method's value awaited, and close it when it
// has no `throw` method.
const OPENED = 1
const B_STEP = 2
const B_STEPPED = 3
const B_RESUMED = 4
const B_RETURN_CLOSED = 5
const B_THROW_CLOSED = 6
const CALL = 7
const CALLED = 8
const AWAITED = 9
const RESUMED = 10
const RETURN_AWAITED = 11
const RETURNING = 12
const THROW_CLOSED = 13

// Slots: the iterator, whether the generator is async, the request kind and the value it carries.
function delegateStep(
  task: MachineTask,
  frame: Frame | undefined,
  node: AstNode,
  input: unknown,
  asynchronous = frame?.slots[1] as boolean,
): Out<Value> {
  const mark = task.stack.length
  const slots = frame?.slots ?? [undefined, asynchronous, "next", undefined]
  const park = (phase: number): typeof PENDING => task.park(frame, mark, Delegate, node, phase, slots)
  let phase = frame?.phase ?? 0
  if (phase === 0) {
    const builtin = builtinCursor(task.ctx.builtins, input as Value)
    if (builtin !== undefined && !asynchronous) {
      slots[0] = builtin
      phase = B_STEP
    } else {
      const custom = builtin === undefined ? openIterator(task, input as Value, node, asynchronous) : undefined
      if (custom === PENDING) return park(OPENED)
      input = custom ?? builtin
      phase = OPENED
    }
  }
  if (phase === OPENED) {
    const opened = input as Iter | undefined
    if (opened === undefined) throw typeError("yield* requires a compatible iterable value.", node)
    // An async generator delegates to a synchronous iterator through CreateAsyncFromSyncIterator, as JS does.
    slots[0] = asynchronous && !(isCustom(opened) && opened.asynchronous) ? asyncFromSync(task, opened, node) : opened
    phase = CALL
  }
  if (phase >= B_STEP && phase <= B_THROW_CLOSED) {
    const iterator = slots[0] as Iter
    while (true) {
      if (phase === B_STEP) {
        const step = iteratorStep(task, iterator, node)
        if (step === PENDING) return park(B_STEPPED)
        input = step
        phase = B_STEPPED
      }
      if (phase === B_STEPPED) {
        const step = input as Step
        if (step.done) return undefined
        task.request(new Yield(step.value), node)
        return park(B_RESUMED)
      }
      if (phase === B_RETURN_CLOSED) throw new GeneratorReturn(slots[3] as Value)
      if (phase === B_THROW_CLOSED) throw noThrow(node)
      const request = input as GeneratorRequest
      if (request.kind === "next") {
        phase = B_STEP
        continue
      }
      slots[3] = request.value
      const next = request.kind === "return" ? B_RETURN_CLOSED : B_THROW_CLOSED
      if (iteratorClose(task, iterator, node) === PENDING) return park(next)
      phase = next
    }
  }
  const iterator = slots[0] as CustomIterator
  while (true) {
    if (phase === RESUMED) {
      const request = input as GeneratorRequest
      slots[2] = request.kind
      slots[3] = request.value
      if (request.kind === "return" && asynchronous) {
        task.request(new Await(request.value, undefined), node)
        return park(RETURN_AWAITED)
      }
      phase = CALL
    }
    if (phase === RETURN_AWAITED) {
      slots[3] = input
      phase = CALL
    }
    if (phase === RETURNING) throw new GeneratorReturn(input as Value)
    if (phase === THROW_CLOSED) throw noThrow(node)
    const kind = slots[2] as GeneratorRequestKind
    if (phase === CALL) {
      const method = kind === "next" ? iterator.next : get(iterator.iterator, kind)
      if (method === undefined || method === null) {
        if (kind === "return") {
          if (!asynchronous) throw new GeneratorReturn(slots[3] as Value)
          task.request(new Await(slots[3] as Value, node), node)
          return park(RETURNING)
        }
        if (iteratorClose(task, iterator, node) === PENDING) return park(THROW_CLOSED)
        throw noThrow(node)
      }
      const called = task.call(
        requireIteratorMethod(method, `Iterator ${kind}`, node),
        iterator.iterator,
        [slots[3] as Value],
        node,
      )
      if (called === PENDING) return park(CALLED)
      input = called
      phase = CALLED
    }
    if (phase === CALLED && iterator.asynchronous) {
      task.request(new Await(input as Value, node), node)
      return park(AWAITED)
    }
    const object = requireIteratorObject(input as Value, `Iterator ${kind}() result`, node)
    const done = Boolean(get(object, "done"))
    const value = get(object, "value")
    if (done) {
      if (kind === "return") throw new GeneratorReturn(value)
      return value
    }
    // Delegated values are yielded as they are; an async generator's inner promise already settled them.
    task.request(new Yield(value), node)
    return park(RESUMED)
  }
}

const Delegate = kind("YieldDelegate", (task, frame: Frame, node: AstNode, input) =>
  delegateStep(task, frame, node, input),
)

/**
 * CreateAsyncFromSyncIterator's object: an async iterator over a synchronous one, for `for await` and an async
 * generator's `yield*`. Its methods are the `%AsyncFromSyncIterator%` intrinsics, so it is plain data.
 */
export class AsyncFromSyncIterator extends Opaque {
  override readonly tag = "AsyncFromSyncIterator"
  constructor(
    proto: Obj,
    /** The synchronous iterator it drives. */
    readonly sync: Iter,
    /** Where it was made, so a failure that rejects one of its promises is located there. */
    readonly site: AstNode,
  ) {
    super(proto)
  }
  override get describe() {
    return "an iterator"
  }
}

/** CreateAsyncFromSyncIterator: an async iterator record over `sync`. */
export const asyncFromSync = (task: MachineTask, sync: Iter, node: AstNode): CustomIterator => {
  const adapter = new AsyncFromSyncIterator(task.ctx.builtins.AsyncFromSyncIterator, sync, node)
  return { iterator: adapter, next: get(adapter, "next"), asynchronous: true }
}

// The phases of an adapter method: start (0), have the synchronous iterator's result object, have a built-in iterator's
// step, closed without a `return` method, closed without a `throw` method, and rejected by a failure.
const A_RESULT = 1
const A_STEP = 2
const A_RETURNED = 3
const A_THREW = 4
const A_REJECTED = 5

/**
 * `%AsyncFromSyncIterator%.next/return/throw`: each returns a promise that settles a job after the synchronous result's
 * value does; a rejected value closes the synchronous iterator first (not for `return`). `return` calls the synchronous
 * iterator's own `return`, or settles at once when it has none; `throw` without a `throw` method closes it and rejects.
 */
function adapterStep(task: MachineTask, frame: Frame, _node: AstNode | undefined, input: unknown): Out<Value> {
  const slots = frame.slots
  const adapter = slots[0] as AsyncFromSyncIterator
  const kind = slots[1] as GeneratorRequestKind
  const args = slots[2] as Array<Value>
  const site = adapter.site
  const sync = adapter.sync
  let phase = frame.phase
  if (phase === A_REJECTED) return (slots[3] as Resolving).promise
  if (phase === 0) {
    const made = capability(task.ctx, site)
    slots[3] = made
    const custom = isCustom(sync) ? sync : undefined
    const method = kind === "next" ? custom?.next : custom ? get(custom.iterator, kind) : undefined
    if (kind === "next" && custom === undefined) {
      frame.phase = A_STEP
      const step = iteratorStep(task, sync, site)
      if (step === PENDING) return PENDING
      input = step
      phase = A_STEP
    } else if (method === undefined || method === null) {
      if (kind === "return" && custom !== undefined) {
        made.resolve(result(task.ctx, args[0], true))
        return made.promise
      }
      phase = kind === "return" ? A_RETURNED : A_THREW
      frame.phase = phase
      if (iteratorClose(task, sync, site) === PENDING) return PENDING
    } else {
      frame.phase = A_RESULT
      const called = task.call(
        kind === "next" ? method : requireIteratorMethod(method, `Iterator ${kind}`, site),
        custom!.iterator,
        args,
        site,
      )
      if (called === PENDING) return PENDING
      input = called
      phase = A_RESULT
    }
  }
  const made = slots[3] as Resolving
  if (phase === A_RETURNED) {
    made.resolve(result(task.ctx, args[0], true))
    return made.promise
  }
  if (phase === A_THREW) {
    made.reject(noThrow(site))
    return made.promise
  }
  let step = input as Step
  if (phase === A_RESULT) {
    const object = requireIteratorObject(input as Value, `Iterator ${kind}() result`, site)
    step = { done: Boolean(get(object, "done")), value: get(object, "value") }
  }
  settle(task, adapter, step, kind !== "return", made)
  return made.promise
}

/** The frame an adapter method runs as: the adapter, which method, and its arguments. */
export const Adapter = kind("AsyncFromSyncIterator", adapterStep, {
  // A failure rejects the method's promise instead; the caller still receives the promise.
  unwind: (_task, frame, error) => {
    const made = frame.slots[3] as Resolving | undefined
    if (made === undefined || frame.phase === A_REJECTED) return false
    made.reject(error)
    frame.phase = A_REJECTED
    return true
  },
})

// AsyncFromSyncIteratorContinuation: settles `made` once the step's value settles.
const settle = (
  task: MachineTask,
  adapter: AsyncFromSyncIterator,
  step: Step,
  closeOnRejection: boolean,
  made: Resolving,
) => {
  const machine = task.machine
  const reaction: Reaction = {
    kind: "asyncFromSync",
    made,
    done: step.done,
    close: closeOnRejection ? adapter.sync : undefined,
    site: adapter.site,
  }
  let wrapper: PromiseObj
  try {
    wrapper = machine.promiseResolve(step.value)
  } catch (error) {
    if (closes(reaction, error)) machine.enqueue({ kind: "reaction", reaction, settled: abrupt(error) })
    else made.reject(error)
    return
  }
  machine.then(wrapper, reaction)
}

type AdapterReaction = Extract<Reaction, { readonly kind: "asyncFromSync" }>

// A rejected value closes the synchronous iterator before rejecting, unless it is done, or the step came from `return`.
const closes = (reaction: AdapterReaction, reason: unknown) =>
  !reaction.done && reaction.close !== undefined && !(reason instanceof Interruption)

/**
 * The `asyncFromSync` reaction: resolves the method's promise with the iterator result, or rejects it, closing the
 * synchronous iterator first when it must. A close that calls program code runs as the frame this returns.
 */
export const adapterSettled = (
  ctx: Interpreter<unknown>,
  reaction: AdapterReaction,
  settled: Completion,
  scopes: ScopeStack,
): Frame | undefined => {
  if (settled.ok) {
    reaction.made.resolve(result(ctx, settled.value as Value, reaction.done))
    return undefined
  }
  if (!closes(reaction, settled.error)) {
    reaction.made.reject(settled.error)
    return undefined
  }
  return new Frame(AdapterClose, reaction.site, 0, scopes, [reaction.close, reaction.made, settled.error])
}

// Slots: the synchronous iterator, the promise to reject, and the reason. Phases: close (0), closed or failed to
// close (1), rejected (2).
function adapterCloseStep(task: MachineTask, frame: Frame, node: AstNode): Out<undefined> {
  const slots = frame.slots
  if (frame.phase === 0) {
    frame.phase = 1
    if (iteratorClose(task, slots[0] as Iter, node) === PENDING) return PENDING
  }
  frame.phase = 2
  ;(slots[1] as Resolving).reject(slots[2])
  return undefined
}

const AdapterClose = kind("AsyncFromSyncClose", adapterCloseStep, {
  // The rejection wins over a failing close.
  unwind: (_task, frame) => {
    if (frame.phase !== 1) return false
    frame.phase = 2
    ;(frame.slots[1] as Resolving).reject(frame.slots[2])
    return true
  },
})
