import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import type { Diagnostic } from "../codemode.js"
import { MAX_PENDING_PROMISES } from "./limits.js"
import { CallSite, Throw, rangeError, typeError } from "./model.js"
import { Callable, define, get, hidden, Arr, Fn, Obj, PromiseObj, record, type Value } from "./objects.js"
import { constructor, fn, methods, native, receiver, requiresNew } from "./native.js"
import { createAggregateErrorValue, locate, materialize, normalizeError } from "./errors.js"
import { describeValue, typeofValue } from "./references.js"
import { applyCollectionCallback, isSupportedCallback } from "./callback.js"
import type { Interpreter } from "./interpreter.js"

// A `resolve`/`reject` handed to an executor or thenable: calling it settles the capability.
const capability = <R>(ctx: Interpreter<R>, name: string, settle: (value: Value) => void) =>
  fn(ctx.builtins, name, 1, (_, args) => {
    settle(args[0])
    return undefined
  })

type Waiter = {
  readonly fiber: Fiber.Fiber<unknown, unknown>
  readonly resume: (effect: Effect.Effect<void>) => void
  next?: Waiter
  removed: boolean
}

// Program fibers that synchronous starts and handbacks may nest on the host stack. Deeper ones start and resume
// through the scheduler, so deep recursion through async calls cannot overflow the host stack.
const MAX_NESTING = 100

type Handback = {
  readonly fiber: Fiber.Fiber<unknown, unknown>
  returned: boolean
  resume?: (effect: Effect.Effect<void>) => void
}

/**
 * The right to run program code. JavaScript runs one job at a time: code between two awaits finishes before another
 * job starts. Effect preempts a busy fiber so timeouts and host work still run, so only the fiber holding the turn may
 * run program code. A synchronous call into another fiber (an async function's body up to its first await, a
 * generator step) lends that fiber the turn and gets it back when the callee suspends or ends. An await gives the turn
 * to the next waiting job and queues to take it back. Work that only settles a promise or runs host code leaves
 * without it, so tool calls stay concurrent and resolvers settle in the call, as in JavaScript.
 */
export class Turn {
  private holder: Fiber.Fiber<unknown, unknown> | undefined
  // Callers waiting for a callee to hand the turn back, innermost last.
  private readonly handbacks: Array<Handback> = []
  // Jobs waiting to take the turn, in the order they became ready.
  private first: Waiter | undefined
  private last: Waiter | undefined
  private nesting = 0

  // Take the turn when it is free, after the jobs already waiting.
  readonly take: Effect.Effect<void> = Effect.withFiber((fiber) => {
    if (this.holder === undefined) {
      this.holder = fiber
      return Effect.void
    }
    return Effect.callback<void>((resume) => {
      const waiter: Waiter = { fiber, resume, removed: false }
      if (this.last === undefined) this.first = waiter
      else this.last.next = waiter
      this.last = waiter
      // Interrupted while waiting, or after the turn was granted but before it ran.
      return Effect.sync(() => {
        if (this.holder === fiber) this.release(fiber)
        else waiter.removed = true
      })
    })
  })

  // Run `effect` holding the turn, as the program's main job does.
  hold<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.withFiber((fiber) =>
      Effect.andThen(this.take, effect).pipe(Effect.ensuring(Effect.sync(() => this.release(fiber)))),
    )
  }

  // Give up the turn, back to the innermost caller waiting for it or to the next waiting job.
  release(fiber: Fiber.Fiber<unknown, unknown>): void {
    if (this.holder !== fiber) return
    const back = this.handbacks.pop()
    if (back !== undefined) {
      this.holder = back.fiber
      this.handBack(back)
      return
    }
    let next = this.first
    while (next !== undefined && next.removed) next = next.next
    this.first = next?.next
    if (this.first === undefined) this.last = undefined
    this.holder = next?.fiber
    // Resume in the scheduler, as a yield would: release can run inside another fiber's step.
    if (next !== undefined) next.fiber.currentDispatcher.scheduleTask(() => next.resume(Effect.void), 0)
  }

  // Wait without the turn, then queue for it like any job that became ready. An interrupted fiber stops without it.
  suspend<A, E, R>(wait: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.withFiber((fiber) => {
        this.release(fiber)
        return Effect.flatMap(Effect.exit(restore(wait)), (exit) =>
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? exit : Effect.andThen(restore(this.take), exit),
        )
      }),
    )
  }

  // Wait without the turn and finish without it, for work that only settles a promise or runs host code.
  leave<A, E, R>(wait: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.withFiber((fiber) => {
      this.release(fiber)
      return wait
    })
  }

  // Run `start`, which wakes a fiber parked with `park`, and continue once it hands the turn back.
  handOff<A, E, R>(start: Effect.Effect<A, E, R>): Effect.Effect<void, E, R> {
    return Effect.withFiber((fiber) => {
      const back: Handback = { fiber, returned: false }
      this.handbacks.push(back)
      return Effect.andThen(this.nest(start), awaitHandback(back))
    })
  }

  // Wait without the turn for a caller to hand it over with `handOff`.
  park<A, E, R>(wait: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.withFiber((fiber) => {
        this.release(fiber)
        // The wake runs inside the caller's step; when that is deep, yield so the body continues on its own stack.
        return Effect.tap(restore(wait), () => {
          this.holder = fiber
          return this.nesting > MAX_NESTING ? Effect.yieldNow : Effect.void
        })
      }),
    )
  }

  // Fork a fiber that runs program code. It starts with the caller's turn, and the caller continues once the fiber
  // suspends or ends; the fiber gives up the turn whenever it ends.
  fork<A, E, R>(effect: Effect.Effect<A, E, R>, scope: Scope.Scope): Effect.Effect<Fiber.Fiber<A, E>, never, R> {
    return Effect.withFiber((caller) => {
      const back: Handback = { fiber: caller, returned: false }
      this.handbacks.push(back)
      let started = false
      const body = Effect.withFiber((fiber) => {
        started = true
        this.holder = fiber
        return effect
      })
      const forked =
        this.nesting < MAX_NESTING
          ? this.nest(Effect.forkIn(body, scope, { startImmediately: true }))
          : Effect.forkIn(body, scope)
      return Effect.flatMap(forked, (fiber) => {
        fiber.addObserver(() => {
          if (started) return this.release(fiber)
          // Forked into a closing scope: it never took the turn, so the caller keeps it.
          const index = this.handbacks.lastIndexOf(back)
          if (index >= 0) this.handbacks.splice(index, 1)
          this.handBack(back)
        })
        // A callee that suspends without blocking hands the turn back before `forkIn` returns.
        return back.returned ? Effect.succeed(fiber) : Effect.as(awaitHandback(back), fiber)
      })
    })
  }

  private handBack(back: Handback): void {
    back.returned = true
    const resume = back.resume
    if (resume === undefined) return
    if (this.nesting >= MAX_NESTING) return back.fiber.currentDispatcher.scheduleTask(() => resume(Effect.void), 0)
    this.nesting++
    try {
      resume(Effect.void)
    } finally {
      this.nesting--
    }
  }

  // Run `effect`, which can run another program fiber inside the current step, counting the nesting.
  private nest<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.suspend(() => {
      this.nesting++
      return Effect.ensuring(
        effect,
        Effect.sync(() => {
          this.nesting--
        }),
      )
    })
  }
}

// The check runs when the caller suspends: it can be preempted after deciding to wait.
const awaitHandback = (back: Handback) =>
  Effect.callback<void>((resume) => {
    if (back.returned) resume(Effect.void)
    else back.resume = resume
  })

// Observation only controls rejection reporting; program completion interrupts all promise work.
export class Pending<R> {
  readonly turn = new Turn()
  private readonly active = new Set<PromiseObj>()
  private readonly ids = new WeakMap<PromiseObj, number>()
  private readonly observed = new WeakSet<PromiseObj>()
  private readonly failures = new Map<number, Diagnostic>()
  private nextID = 0

  constructor(
    private readonly scope: Scope.Scope,
    private readonly proto: Obj,
  ) {}

  // Resolution bodies need the promise's own identity to reject `resolve(promise)` self-resolution.
  createWithSelf(
    body: (self: { promise?: PromiseObj }) => Effect.Effect<Value, unknown, R>,
  ): Effect.Effect<PromiseObj, never, R> {
    const self: { promise?: PromiseObj } = {}
    return Effect.map(this.create(body(self)), (promise) => {
      self.promise = promise
      return promise
    })
  }

  // A promise whose work runs program code, on the turn. Host work that runs no program code uses `createHost`.
  create(effect: Effect.Effect<Value, unknown, R>): Effect.Effect<PromiseObj, never, R> {
    return this.register(effect, (body) => this.turn.fork(body, this.scope))
  }

  // Starts now, without the turn, so host work stays concurrent and attaches to host promises at once.
  createHost(effect: Effect.Effect<Value, unknown, R>): Effect.Effect<PromiseObj, never, R> {
    return this.register(effect, (body) => Effect.forkIn(body, this.scope, { startImmediately: true }))
  }

  private register(
    effect: Effect.Effect<Value, unknown, R>,
    fork: (body: Effect.Effect<Value, unknown, R>) => Effect.Effect<Fiber.Fiber<Value, unknown>, never, R>,
  ): Effect.Effect<PromiseObj, never, R> {
    return Effect.flatMap(CallSite, (site) => {
      if (this.active.size >= MAX_PENDING_PROMISES) {
        throw rangeError(
          `Too many pending promises (limit ${MAX_PENDING_PROMISES}); await promises before creating more.`,
        )
      }
      // Allocate before forking so reruns get distinct IDs and diagnostics retain creation order.
      const id = this.nextID++
      const body = Effect.catchDefect(effect, (defect) => Effect.die(locate(defect, site.node)))
      return Effect.map(fork(body), (fiber) => {
        const promise = new PromiseObj(this.proto, fiber)
        this.active.add(promise)
        this.ids.set(promise, id)
        fiber.addObserver((exit) => {
          this.active.delete(promise)
          if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) || this.observed.has(promise)) {
            this.ids.delete(promise)
            return
          }
          const failure = normalizeError(Cause.squash(exit.cause))
          this.failures.set(id, {
            ...failure,
            message: `Unhandled rejection from an un-awaited promise: ${failure.message}`,
          })
        })
        return promise
      })
    })
  }

  // Observation must be recorded when responsibility transfers, before the consumer fiber runs.
  markObserved(promise: PromiseObj): void {
    this.observed.add(promise)
    const id = this.ids.get(promise)
    this.ids.delete(promise)
    if (id !== undefined) this.failures.delete(id)
  }

  await(promise: PromiseObj): Effect.Effect<Exit.Exit<Value, unknown>> {
    return Fiber.await(promise.fiber)
  }

  fork(effect: Effect.Effect<unknown, unknown, R>): Effect.Effect<void, never, R> {
    return Effect.asVoid(this.turn.fork(effect, this.scope))
  }

  diagnostics(): Array<Diagnostic> {
    return [...this.failures].sort(([left], [right]) => left - right).map(([, failure]) => failure)
  }

  // Re-check because a straggler can create promises before its interruption lands.
  interrupt(): Effect.Effect<Array<Diagnostic>> {
    const self = this
    return Effect.gen(function* () {
      while (self.active.size > 0) {
        yield* Fiber.interruptAll([...self.active].map((promise) => promise.fiber))
      }
      return self.diagnostics()
    })
  }
}

export const resolvePromiseValue = <R>(
  ctx: Interpreter<R>,
  value: Value,
  own?: { promise?: PromiseObj },
): Effect.Effect<Value, unknown, R> => {
  if (own?.promise !== undefined && value === own.promise) {
    return Effect.die(typeError("Chaining cycle detected: a promise cannot resolve with itself."))
  }
  if (value instanceof PromiseObj) return ctx.await(value)
  if (!(value instanceof Obj)) return Effect.succeed(value)
  const then = get(value, "then")
  if (typeofValue(then) !== "function") return Effect.succeed(value)

  return Effect.gen(function* () {
    // Promise resolution invokes a thenable's method in a later job.
    yield* ctx.pending.turn.suspend(Effect.yieldNow)
    const deferred = Deferred.makeUnsafe<Value, unknown>()
    const resolve = capability(ctx, "resolve", (result) => Deferred.doneUnsafe(deferred, Exit.succeed(result)))
    const reject = capability(ctx, "reject", (reason) => Deferred.doneUnsafe(deferred, Exit.fail(new Throw(reason))))
    const executed = yield* Effect.exit(ctx.call(then, value, [resolve, reject]))
    if (!Exit.isSuccess(executed)) {
      if (Cause.hasInterruptsOnly(executed.cause)) return yield* Effect.failCause(executed.cause)
      Deferred.doneUnsafe(deferred, Exit.fail(Cause.squash(executed.cause)))
    }
    return yield* resolvePromiseValue(ctx, yield* ctx.pending.turn.leave(Deferred.await(deferred)), own)
  })
}

export const resolvePromise = <R>(ctx: Interpreter<R>, value: Value): Effect.Effect<PromiseObj, never, R> => {
  if (value instanceof PromiseObj) return Effect.succeed(value)
  return ctx.pending.createWithSelf((self) => resolvePromiseValue(ctx, value, self))
}

const promiseStatics = ["all", "allSettled", "race", "any", "resolve", "reject", "withResolvers", "try"] as const

const invokePromiseMethod = <R>(
  ctx: Interpreter<R>,
  name: (typeof promiseStatics)[number],
  args: Array<Value>,
): Effect.Effect<Value, unknown, R> => {
  if (name === "resolve") {
    return resolvePromise(ctx, args[0])
  }
  if (name === "reject") {
    return ctx.pending.create(Effect.fail(new Throw(args[0])))
  }
  if (name === "withResolvers") {
    return Effect.map(promiseCapability(ctx), (made) =>
      record(ctx.builtins.Object, { promise: made.promise, resolve: made.resolve, reject: made.reject }),
    )
  }
  if (name === "try") {
    if (typeofValue(args[0]) !== "function") {
      throw typeError(`Promise.try expects a function, received ${describeValue(args[0])}.`)
    }
    return Effect.flatMap(Effect.exit(ctx.call(args[0], undefined, args.slice(1))), (called) => {
      if (Exit.isSuccess(called)) return resolvePromise(ctx, called.value)
      if (Cause.hasInterruptsOnly(called.cause)) return Effect.failCause(called.cause)
      return ctx.pending.create(Effect.fail(Cause.squash(called.cause)))
    })
  }

  return ctx.pending.create(
    Effect.gen(function* () {
      const cursor = yield* ctx.iterate(args[0])
      if (cursor === undefined) {
        throw typeError(`Promise.${name} expects a synchronous iterable, received ${describeValue(args[0])}.`)
      }
      const items: Array<PromiseObj> = []
      while (true) {
        const step = yield* cursor.next
        if (step.done) break
        const item = yield* resolvePromise(ctx, step.value)
        ctx.pending.markObserved(item)
        items.push(item)
      }

      if (name === "all") {
        return new Arr(
          ctx.builtins.Array,
          yield* settleAfterTurn(
            ctx,
            Effect.all(
              items.map((item) => Effect.flatten(ctx.pending.await(item))),
              { concurrency: "unbounded" },
            ),
          ),
        )
      }
      if (name === "allSettled") {
        return yield* ctx.pending.turn.suspend(
          Effect.gen(function* () {
            const outcomes: Array<Value> = []
            for (const item of items) {
              const exit = yield* ctx.pending.await(item)
              if (Exit.isSuccess(exit)) {
                outcomes.push(record(ctx.builtins.Object, { status: "fulfilled", value: exit.value }))
                continue
              }
              if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
              outcomes.push(
                record(ctx.builtins.Object, {
                  status: "rejected",
                  reason: materialize(ctx, Cause.squash(exit.cause)),
                }),
              )
            }
            yield* Effect.yieldNow
            return new Arr(ctx.builtins.Array, outcomes)
          }),
        )
      }
      if (name === "race") {
        if (items.length === 0) {
          throw typeError("Promise.race([]) would never settle; provide at least one promise or value.")
        }
        return yield* settleAfterTurn(ctx, Effect.flatten(Effect.raceAll(items.map((item) => ctx.pending.await(item)))))
      }
      const flipped = items.map((item) =>
        Effect.flatMap(ctx.pending.await(item), (exit) => {
          if (Exit.isSuccess(exit)) return Effect.fail(new PromiseAnyFulfilled(exit.value))
          if (Cause.hasInterruptsOnly(exit.cause)) return Effect.failCause(exit.cause)
          return Effect.succeed(materialize(ctx, Cause.squash(exit.cause)))
        }),
      )
      return yield* settleAfterTurn(
        ctx,
        Effect.all(flipped, { concurrency: "unbounded" }).pipe(
          Effect.flatMap((reasons) =>
            Effect.fail(new Throw(createAggregateErrorValue(ctx, reasons, "All promises were rejected"))),
          ),
          Effect.catch((error) =>
            error instanceof PromiseAnyFulfilled ? Effect.succeed(error.value) : Effect.fail(error),
          ),
        ),
      )
    }),
  )
}

const instanceMethod = <R>(
  ctx: Interpreter<R>,
  name: "then" | "catch" | "finally",
  thisValue: Value,
  args: Array<Value>,
): Effect.Effect<PromiseObj, unknown, R> => {
  const method = `Promise.prototype.${name}`
  const promise = receiver(PromiseObj, thisValue, method)
  ctx.pending.markObserved(promise)
  if (name === "finally") {
    return chainFinally(ctx, promise, reactionHandler(args[0], method), method)
  }
  const onFulfilled = name === "then" ? reactionHandler(args[0], method) : undefined
  const onRejected = reactionHandler(name === "then" ? args[1] : args[0], method)
  return chainReaction(ctx, promise, onFulfilled, onRejected, method)
}

/** NewPromiseCapability: a pending promise with the resolve/reject callables that settle it exactly once. */
const promiseCapability = <R>(ctx: Interpreter<R>) =>
  Effect.gen(function* () {
    const deferred = Deferred.makeUnsafe<Value, unknown>()
    const promise = yield* ctx.pending.createWithSelf((self) =>
      Effect.flatMap(ctx.pending.turn.leave(Deferred.await(deferred)), (value) =>
        resolvePromiseValue(ctx, value, self),
      ),
    )
    const resolve = capability(ctx, "resolve", (value) => Deferred.doneUnsafe(deferred, Exit.succeed(value)))
    const reject = capability(ctx, "reject", (value) => Deferred.doneUnsafe(deferred, Exit.fail(new Throw(value))))
    return { promise, resolve, reject, deferred }
  })

const constructPromise = <R>(ctx: Interpreter<R>, executor: Value): Effect.Effect<PromiseObj, unknown, R> => {
  if (!(executor instanceof Fn)) {
    throw typeError("new Promise(...) expects an executor function (e.g. new Promise((resolve, reject) => { ... })).")
  }
  return Effect.gen(function* () {
    const made = yield* promiseCapability(ctx)
    const executed = yield* Effect.exit(ctx.call(executor, undefined, [made.resolve, made.reject]))
    if (!Exit.isSuccess(executed)) {
      if (Cause.hasInterruptsOnly(executed.cause)) return yield* Effect.failCause(executed.cause)
      Deferred.doneUnsafe(made.deferred, Exit.fail(Cause.squash(executed.cause)))
    }
    return made.promise
  })
}

// Settle one reaction turn after the deciding member, after its existing reactions. That reaction is a job: it queues
// for the turn behind the jobs ready before it and settles holding it.
const settleAfterTurn = <A, E, R>(ctx: Interpreter<R>, body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatten(
    ctx.pending.turn.suspend(Effect.flatMap(Effect.exit(body), (exit) => Effect.as(Effect.yieldNow, exit))),
  )

class PromiseAnyFulfilled {
  constructor(readonly value: Value) {}
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

// Teardown bypasses handlers; settled reactions yield once so handlers never run inline.
const reactionExit = <R>(
  ctx: Interpreter<R>,
  source: PromiseObj,
): Effect.Effect<Exit.Exit<Value, unknown>, unknown, R> =>
  ctx.pending.turn.suspend(
    Effect.gen(function* () {
      const exit = yield* ctx.pending.await(source)
      if (!Exit.isSuccess(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
      yield* Effect.yieldNow
      return exit
    }),
  )

const chainReaction = <R>(
  ctx: Interpreter<R>,
  source: PromiseObj,
  onFulfilled: Callable | undefined,
  onRejected: Callable | undefined,
  method: string,
): Effect.Effect<PromiseObj, never, R> => {
  return ctx.pending.createWithSelf((self) =>
    Effect.gen(function* () {
      const exit = yield* reactionExit(ctx, source)
      const handler = Exit.isSuccess(exit) ? onFulfilled : onRejected
      if (handler === undefined) return yield* exit
      const input = Exit.isSuccess(exit) ? exit.value : materialize(ctx, Cause.squash(exit.cause))
      const result = yield* applyCollectionCallback(ctx, handler, method)([input])
      return yield* resolvePromiseValue(ctx, result, self)
    }),
  )
}

const chainFinally = <R>(
  ctx: Interpreter<R>,
  source: PromiseObj,
  cleanup: Callable | undefined,
  method: string,
): Effect.Effect<PromiseObj, never, R> =>
  ctx.pending.create(
    Effect.gen(function* () {
      const exit = yield* reactionExit(ctx, source)
      if (cleanup !== undefined) {
        const result = yield* applyCollectionCallback(ctx, cleanup, method)([])
        const intermediate = yield* ctx.pending.create(
          Effect.gen(function* () {
            yield* ctx.await(yield* resolvePromise(ctx, result))
            return yield* exit
          }),
        )
        return yield* ctx.await(intermediate)
      }
      return yield* exit
    }),
  )

export const promiseGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const proto = builtins.Promise
  const promise = constructor<R>(builtins, proto, {
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
      native<R>(builtins, {
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
  return promise
}
