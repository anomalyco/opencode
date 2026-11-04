import { fn, type Method, methods, receiver } from "./native.js"
import { AsyncIteratorSymbol, type GeneratorRequestKind, IteratorSymbol, Throw, typeError } from "./model.js"
import { define, hidden, GeneratorObj, iteratorResult, type Value } from "./objects.js"
import type { Interpreter } from "./interpreter.js"
import {
  abrupt,
  type Boundary,
  type Completion,
  Enter,
  type Entry,
  type Eval,
  type GeneratorRequest,
  normal,
} from "./runner.js"

/** `next`/`return`/`throw` on the generator prototypes; async generators answer with promises. */
export const generatorGlobals = <R>(ctx: Interpreter<R>): void => {
  const builtins = ctx.builtins
  const sync = (kind: GeneratorRequestKind): Method => [
    kind,
    1,
    (thisValue, args) => {
      const method = `Generator.prototype.${kind}`
      const generator = receiver(GeneratorObj, thisValue, method)
      if (generator.asynchronous) throw typeError(`${method} called on incompatible receiver an async generator.`)
      return step(ctx, generator, kind, args[0])
    },
  ]
  const async = (kind: GeneratorRequestKind): Method => [
    kind,
    1,
    (thisValue, args) => request(ctx, thisValue, kind, args[0]),
  ]
  methods(builtins, builtins.Generator, [sync("next"), sync("return"), sync("throw")])
  methods(builtins, builtins.AsyncGenerator, [async("next"), async("return"), async("throw")])
  define(
    builtins.Iterator,
    IteratorSymbol,
    fn(builtins, "[Symbol.iterator]", 0, (thisValue) => thisValue),
    hidden,
  )
  define(
    builtins.AsyncIterator,
    AsyncIteratorSymbol,
    fn(builtins, "[Symbol.asyncIterator]", 0, (thisValue) => thisValue),
    hidden,
  )
}

const result = <R>(ctx: Interpreter<R>, value: Value, done: boolean) => iteratorResult(ctx.builtins.Object, value, done)

// Puts the suspended body back on the stack and continues it with `request`; the boundary answers the caller when
// the body next yields or ends.
const resume = <R>(ctx: Interpreter<R>, generator: GeneratorObj, request: GeneratorRequest): Enter => {
  const started = generator.state !== "suspendedStart"
  generator.state = "executing"
  if (!started) {
    return new Enter([{ body: generator.body, boundary: new GeneratorBoundary(ctx, generator) }], normal(undefined))
  }
  const entries = generator.entries!
  generator.entries = undefined
  return new Enter(entries, normal(request))
}

// A synchronous generator step: the body runs on the caller's stack until it yields, returns, or throws.
function* step<R>(ctx: Interpreter<R>, generator: GeneratorObj, kind: GeneratorRequestKind, value: Value): Eval<Value> {
  if (generator.state === "executing") throw typeError("Generator is already running.")
  if (generator.state === "suspendedStart" && kind !== "next") generator.state = "completed"
  if (generator.state === "completed") {
    if (kind === "throw") throw new Throw(value)
    return result(ctx, kind === "return" ? value : undefined, true)
  }
  return (yield resume(ctx, generator, { kind, value })) as Value
}

// AsyncGenerator.prototype.next/return/throw: queue the request with its promise, and run the body now if it is
// waiting for one. A request that arrives while the body runs is answered when the body reaches it.
function* request<R>(ctx: Interpreter<R>, thisValue: Value, kind: GeneratorRequestKind, value: Value): Eval<Value> {
  const runner = ctx.runner
  const promise = runner.newPromise()
  const resolving = runner.resolving(promise)
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
  if (state === "suspendedStart" || state === "suspendedYield") yield resume(ctx, generator, queued)
  return promise
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
  const runner = ctx.runner
  const finish = (completion: Completion) => {
    completeStep(ctx, generator, completion, true)
    drainQueue(ctx, generator)
  }
  try {
    runner.then(runner.promiseResolve(generator.queue[0]!.request.value), finish)
  } catch (error) {
    finish(abrupt(error))
  }
}

/** Where a generator body splits off the stack when it yields, and how its end answers the request that ran it. */
class GeneratorBoundary<R> implements Boundary {
  readonly generator = true
  readonly async: boolean

  constructor(
    private readonly ctx: Interpreter<R>,
    private readonly target: GeneratorObj,
  ) {
    this.async = target.asynchronous
  }

  finish(completion: Completion): Completion {
    const generator = this.target
    if (!generator.asynchronous) {
      generator.state = "completed"
      return completion.ok ? normal(result(this.ctx, completion.value as Value, true)) : completion
    }
    completeStep(this.ctx, generator, completion, true)
    drainQueue(this.ctx, generator)
    return normal(undefined)
  }

  suspended(): Completion {
    return normal(undefined)
  }

  yielded(value: Value, split: () => Array<Entry>): Completion {
    const generator = this.target
    if (!generator.asynchronous) {
      generator.entries = split()
      generator.state = "suspendedYield"
      return normal(result(this.ctx, value, false))
    }
    // AsyncGeneratorYield: answer the oldest request, and keep running if another is already waiting.
    completeStep(this.ctx, generator, normal(value), false)
    const next = generator.queue[0]
    if (next !== undefined) return normal(next.request)
    generator.entries = split()
    generator.state = "suspendedYield"
    return normal(undefined)
  }
}
