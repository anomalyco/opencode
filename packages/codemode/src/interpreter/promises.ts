import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import type { Diagnostic } from "../codemode.js"
import type { SafeObject } from "../tool-runtime.js"
import {
  type AstNode,
  CodeModeFunction,
  CoercionFunction,
  InterpreterRuntimeError,
  ProgramThrow,
  PromiseCapabilityFunction,
  PromiseInstanceMethodReference,
  PromiseMethodReference,
  UriFunction,
} from "./model.js"
import { caughtErrorValue, normalizeError } from "./errors.js"
import { applyCollectionCallback, type CallbackRunner } from "./methods.js"
import { typeofValue } from "./references.js"
import { spreadItems } from "../stdlib/collections.js"
import { createAggregateErrorValue } from "../stdlib/value.js"
import { SandboxPromise } from "../values.js"

// Promise work lives until the program returns, while observation only controls whether a
// settled rejection is reported. Neither extends execution: completion interrupts all work.
export class PromiseRuntime<R> {
  private readonly active = new Set<SandboxPromise>()
  private readonly ids = new WeakMap<SandboxPromise, number>()
  private readonly observed = new WeakSet<SandboxPromise>()
  private readonly failures = new Map<number, Diagnostic>()
  private nextID = 0

  constructor(private readonly scope: Scope.Scope) {}

  create(effect: Effect.Effect<unknown, unknown, R>): Effect.Effect<SandboxPromise, never, R> {
    return Effect.suspend(() => {
      // Allocated at execution time (not construction) so re-run effects cannot share an id,
      // and before the fork so diagnostics order by creation: a forked body that immediately
      // creates promises of its own must sequence after its creator.
      const id = this.nextID++
      return Effect.map(Effect.forkIn(effect, this.scope, { startImmediately: true }), (fiber) => {
        const promise = new SandboxPromise(fiber)
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

  // Synchronous on purpose: JS makes a promise "handled" the moment a construct takes
  // responsibility for it (await, or membership in a combinator call), not when the
  // consuming fiber later runs. Call sites must invoke this at that moment.
  markObserved(promise: SandboxPromise): void {
    this.observed.add(promise)
    const id = this.ids.get(promise)
    this.ids.delete(promise)
    if (id !== undefined) this.failures.delete(id)
  }

  // Pure settlement subscription: never re-runs work and never affects rejection reporting.
  await(promise: SandboxPromise): Effect.Effect<Exit.Exit<unknown, unknown>> {
    return Fiber.await(promise.fiber)
  }

  // Unobserved rejections that already settled, in creation order.
  diagnostics(): Array<Diagnostic> {
    return [...this.failures].sort(([left], [right]) => left - right).map(([, failure]) => failure)
  }

  // Interrupts everything still running and reports rejections that settled un-awaited.
  // The loop re-checks because a straggler can create promises before its interrupt lands.
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

export const selfResolutionError = (node?: AstNode): InterpreterRuntimeError =>
  new InterpreterRuntimeError("Chaining cycle detected: a promise cannot resolve with itself.", node).as("TypeError")

// Combinators accept any array mixing promise values and plain data (tool calls already run
// eagerly on their own fibers); each returns a real promise whose join runs on its own
// scope-owned fiber. The concurrency cap stays where the work is: the fork semaphore.
export const invokePromiseMethod = <R>(
  runner: CallbackRunner<R>,
  promises: PromiseRuntime<R>,
  ref: PromiseMethodReference,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  if (ref.name === "resolve") {
    // Promise.resolve of a promise is that promise (JS flattens). Pre-settled values still
    // fork a scope-owned fiber so every promise shares one lifecycle.
    const value = args[0]
    return value instanceof SandboxPromise ? Effect.succeed(value) : promises.create(Effect.succeed(value))
  }
  if (ref.name === "reject") {
    return promises.create(Effect.fail(new ProgramThrow(args[0])))
  }

  const spread = spreadItems(args[0])
  if (spread === undefined) {
    return promises.create(
      Effect.fail(
        new InterpreterRuntimeError(
          `Promise.${ref.name} expects an array of promises or plain values (e.g. Promise.${ref.name}(items.map((item) => tools.ns.tool(item)))).`,
          node,
        ).as("TypeError"),
      ),
    )
  }
  // Densify: JS combinator iteration reads sparse holes as undefined members; .map would skip them.
  const items = Array.from(spread)

  // JS makes combinator members "handled" synchronously at the call - their rejections
  // belong to the aggregate from this moment, even ones settling before it runs.
  for (const item of items) {
    if (item instanceof SandboxPromise) promises.markObserved(item)
  }

  switch (ref.name) {
    case "all": {
      // Rejects on the first failure; sibling fibers stay execution-owned and keep running, as in JS.
      const observations = items.map((item) =>
        item instanceof SandboxPromise ? Effect.flatten(promises.await(item)) : Effect.succeed(item),
      )
      return promises.create(settleAfterTurn(Effect.all(observations, { concurrency: "unbounded" })))
    }
    case "allSettled": {
      const observations = items.map((item) =>
        item instanceof SandboxPromise ? promises.await(item) : Effect.succeed(Exit.succeed(item)),
      )
      return promises.create(
        settleAfterTurn(
          Effect.gen(function* () {
            const outcomes: Array<unknown> = []
            for (const observation of observations) {
              const exit = yield* observation
              if (Exit.isSuccess(exit)) {
                outcomes.push(
                  Object.assign(Object.create(null) as SafeObject, { status: "fulfilled", value: exit.value }),
                )
                continue
              }
              if (Cause.hasInterruptsOnly(exit.cause)) {
                // Execution teardown (timeout/host interruption), not a program-level rejection.
                return yield* Effect.failCause(exit.cause)
              }
              outcomes.push(
                Object.assign(Object.create(null) as SafeObject, {
                  status: "rejected",
                  reason: caughtErrorValue(Cause.squash(exit.cause)),
                }),
              )
            }
            return outcomes
          }),
        ),
      )
    }
    case "race": {
      if (items.length === 0) {
        return promises.create(
          Effect.fail(
            new InterpreterRuntimeError(
              "Promise.race([]) would never settle; provide at least one promise or value.",
              node,
            ),
          ),
        )
      }
      const observations = items.map((item) =>
        item instanceof SandboxPromise ? promises.await(item) : Effect.succeed(Exit.succeed(item)),
      )
      // First settlement (fulfilled OR rejected) wins; losing work stays execution-owned
      // and is interrupted at normal completion (already observed) or by teardown.
      return promises.create(settleAfterTurn(Effect.flatten(Effect.raceAll(observations))))
    }
    case "any": {
      // De Morgan dual of Promise.all: members are flipped so the first fulfillment
      // short-circuits fail-fast Effect.all, and all-rejected completes with the reasons
      // in input order for the AggregateError.
      const flipped = items.map((item) =>
        item instanceof SandboxPromise
          ? Effect.flatMap(promises.await(item), (exit) => {
              if (Exit.isSuccess(exit)) return Effect.fail(new PromiseAnyFulfilled(exit.value))
              if (Cause.hasInterruptsOnly(exit.cause)) return Effect.failCause(exit.cause)
              return Effect.succeed(caughtErrorValue(Cause.squash(exit.cause)))
            })
          : Effect.fail(new PromiseAnyFulfilled(item)),
      )
      const body = Effect.all(flipped, { concurrency: "unbounded" }).pipe(
        Effect.flatMap((reasons) =>
          Effect.fail(new ProgramThrow(createAggregateErrorValue(reasons, "All promises were rejected"))),
        ),
        Effect.catch((error) =>
          error instanceof PromiseAnyFulfilled ? Effect.succeed(error.value) : Effect.fail(error),
        ),
      )
      return promises.create(settleAfterTurn(body))
    }
  }
}

export const invokePromiseInstanceMethod = <R>(
  runner: CallbackRunner<R>,
  promises: PromiseRuntime<R>,
  ref: PromiseInstanceMethodReference,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<SandboxPromise, never, R> => {
  const method = `Promise.prototype.${ref.name}`
  promises.markObserved(ref.promise)
  if (ref.name === "finally") {
    return chainFinally(runner, promises, ref.promise, reactionHandler(args[0], method, node), method, node)
  }
  const onFulfilled = ref.name === "then" ? reactionHandler(args[0], method, node) : undefined
  const onRejected = reactionHandler(ref.name === "then" ? args[1] : args[0], method, node)
  return chainReaction(runner, promises, ref.promise, onFulfilled, onRejected, method, node)
}

// new Promise(executor): the promise's fiber awaits a Deferred that resolve/reject settle
// exactly once. The executor runs synchronously; its throw rejects the promise unless it
// already settled (JS swallows post-settlement executor throws).
export const constructPromise = <R>(
  runner: CallbackRunner<R>,
  promises: PromiseRuntime<R>,
  executor: unknown,
  node: AstNode,
): Effect.Effect<SandboxPromise, unknown, R> => {
  if (!(executor instanceof CodeModeFunction)) {
    throw new InterpreterRuntimeError(
      "new Promise(...) expects an executor function (e.g. new Promise((resolve, reject) => { ... })).",
      node,
    ).as("TypeError")
  }
  return Effect.gen(function* () {
    const deferred = Deferred.makeUnsafe<unknown, unknown>()
    const box: { own?: SandboxPromise } = {}
    const promise = yield* promises.create(
      Effect.flatMap(Deferred.await(deferred), (value) => {
        if (!(value instanceof SandboxPromise)) return Effect.succeed(value)
        if (value === box.own) return Effect.fail(selfResolutionError(node))
        return runner.settlePromise(value)
      }),
    )
    box.own = promise
    const resolve = new PromiseCapabilityFunction((value) => {
      Deferred.doneUnsafe(deferred, Exit.succeed(value))
    })
    const reject = new PromiseCapabilityFunction((value) => {
      Deferred.doneUnsafe(deferred, Exit.fail(new ProgramThrow(value)))
    })
    const executed = yield* Effect.exit(runner.invokeFunction(executor, [resolve, reject]))
    if (!Exit.isSuccess(executed)) {
      if (Cause.hasInterruptsOnly(executed.cause)) return yield* Effect.failCause(executed.cause)
      Deferred.doneUnsafe(deferred, Exit.fail(Cause.squash(executed.cause)))
    }
    return promise
  })
}

// V8 parity: a combinator settles one reaction turn after the deciding member, never
// before reactions already attached to it.
const settleAfterTurn = <A, E, R>(body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.exit(body), (exit) => Effect.andThen(Effect.yieldNow, exit))

// Short-circuit marker for Promise.any: the first fulfillment travels the error channel of
// the flipped members so fail-fast Effect.all stops observing on it.
class PromiseAnyFulfilled {
  constructor(readonly value: unknown) {}
}

type ReactionHandler = CodeModeFunction | CoercionFunction | UriFunction | PromiseCapabilityFunction

// Non-callables are ignored as in JS: `.then(undefined, f)` relies on the passthrough.
const reactionHandler = (value: unknown, method: string, node: AstNode): ReactionHandler | undefined => {
  if (
    value instanceof CodeModeFunction ||
    value instanceof CoercionFunction ||
    value instanceof UriFunction ||
    value instanceof PromiseCapabilityFunction
  ) {
    return value
  }
  if (typeofValue(value) === "function") {
    throw new InterpreterRuntimeError(
      `${method} handlers must be plain functions; wrap other callables in an arrow function, e.g. (value) => tools.ns.tool(value).`,
      node,
    )
  }
  return undefined
}

// Teardown interruption propagates without running handlers; a real settlement defers
// one reaction turn so handlers never run inline.
const reactionExit = <R>(
  promises: PromiseRuntime<R>,
  source: SandboxPromise,
): Effect.Effect<Exit.Exit<unknown, unknown>, unknown, R> =>
  Effect.gen(function* () {
    const exit = yield* promises.await(source)
    if (!Exit.isSuccess(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
    yield* Effect.yieldNow
    return exit
  })

const chainReaction = <R>(
  runner: CallbackRunner<R>,
  promises: PromiseRuntime<R>,
  source: SandboxPromise,
  onFulfilled: ReactionHandler | undefined,
  onRejected: ReactionHandler | undefined,
  method: string,
  node: AstNode,
): Effect.Effect<SandboxPromise, never, R> => {
  const box: { derived?: SandboxPromise } = {}
  const body = Effect.gen(function* () {
    const exit = yield* reactionExit(promises, source)
    const handler = Exit.isSuccess(exit) ? onFulfilled : onRejected
    if (handler === undefined) return yield* exit
    const input = Exit.isSuccess(exit) ? exit.value : caughtErrorValue(Cause.squash(exit.cause))
    const result = yield* applyCollectionCallback(runner, handler, method, node)([input])
    if (result === box.derived) return yield* Effect.fail(selfResolutionError(node))
    if (result instanceof SandboxPromise) return yield* runner.settlePromise(result)
    return result
  })
  return Effect.map(promises.create(body), (derived) => {
    box.derived = derived
    return derived
  })
}

const chainFinally = <R>(
  runner: CallbackRunner<R>,
  promises: PromiseRuntime<R>,
  source: SandboxPromise,
  cleanup: ReactionHandler | undefined,
  method: string,
  node: AstNode,
): Effect.Effect<SandboxPromise, never, R> =>
  promises.create(
    Effect.gen(function* () {
      const exit = yield* reactionExit(promises, source)
      if (cleanup !== undefined) {
        const result = yield* applyCollectionCallback(runner, cleanup, method, node)([])
        if (result instanceof SandboxPromise) yield* runner.settlePromise(result)
      }
      return yield* exit
    }),
  )
