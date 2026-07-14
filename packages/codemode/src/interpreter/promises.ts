import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import type { Diagnostic } from "../codemode.js"
import type { SafeObject } from "../tool-runtime.js"
import {
  type AstNode,
  CodeModeFunction,
  InterpreterRuntimeError,
  ProgramThrow,
  PromiseCapabilityFunction,
  PromiseInstanceMethodReference,
  PromiseMethodReference,
} from "./model.js"
import { caughtErrorValue, normalizeError } from "./errors.js"
import { applyCollectionCallback, isSupportedCallback, type CallbackRunner, type SupportedCallback } from "./methods.js"
import { typeofValue } from "./references.js"
import { spreadItems } from "../stdlib/collections.js"
import { createAggregateErrorValue } from "../stdlib/value.js"
import { CodeModePromise } from "../values.js"

// Observation only controls rejection reporting; program completion interrupts all promise work.
export class PromiseRuntime<R> {
  private readonly active = new Set<CodeModePromise>()
  private readonly ids = new WeakMap<CodeModePromise, number>()
  private readonly observed = new WeakSet<CodeModePromise>()
  private readonly failures = new Map<number, Diagnostic>()
  private nextID = 0

  constructor(private readonly scope: Scope.Scope) {}

  create(effect: Effect.Effect<unknown, unknown, R>): Effect.Effect<CodeModePromise, never, R> {
    return Effect.suspend(() => {
      // Allocate before forking so reruns get distinct IDs and diagnostics retain creation order.
      const id = this.nextID++
      return Effect.map(Effect.forkIn(effect, this.scope, { startImmediately: true }), (fiber) => {
        const promise = new CodeModePromise(fiber)
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
  markObserved(promise: CodeModePromise): void {
    this.observed.add(promise)
    const id = this.ids.get(promise)
    this.ids.delete(promise)
    if (id !== undefined) this.failures.delete(id)
  }

  await(promise: CodeModePromise): Effect.Effect<Exit.Exit<unknown, unknown>> {
    return Fiber.await(promise.fiber)
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

export const selfResolutionError = (node?: AstNode): InterpreterRuntimeError =>
  new InterpreterRuntimeError("Chaining cycle detected: a promise cannot resolve with itself.", node).as("TypeError")

export const invokePromiseMethod = <R>(
  runner: CallbackRunner<R>,
  promises: PromiseRuntime<R>,
  ref: PromiseMethodReference,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  if (ref.name === "resolve") {
    const value = args[0]
    return value instanceof CodeModePromise ? Effect.succeed(value) : promises.create(Effect.succeed(value))
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
  const items = Array.from(spread)

  for (const item of items) {
    if (item instanceof CodeModePromise) promises.markObserved(item)
  }

  switch (ref.name) {
    case "all": {
      const observations = items.map((item) =>
        item instanceof CodeModePromise ? Effect.flatten(promises.await(item)) : Effect.succeed(item),
      )
      return promises.create(settleAfterTurn(Effect.all(observations, { concurrency: "unbounded" })))
    }
    case "allSettled": {
      const observations = items.map((item) =>
        item instanceof CodeModePromise ? promises.await(item) : Effect.succeed(Exit.succeed(item)),
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
                // Teardown interruption is not a program-level rejection.
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
        item instanceof CodeModePromise ? promises.await(item) : Effect.succeed(Exit.succeed(item)),
      )
      return promises.create(settleAfterTurn(Effect.flatten(Effect.raceAll(observations))))
    }
    case "any": {
      const flipped = items.map((item) =>
        item instanceof CodeModePromise
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
): Effect.Effect<CodeModePromise, never, R> => {
  const method = `Promise.prototype.${ref.name}`
  promises.markObserved(ref.promise)
  if (ref.name === "finally") {
    return chainFinally(runner, promises, ref.promise, reactionHandler(args[0], method, node), method, node)
  }
  const onFulfilled = ref.name === "then" ? reactionHandler(args[0], method, node) : undefined
  const onRejected = reactionHandler(ref.name === "then" ? args[1] : args[0], method, node)
  return chainReaction(runner, promises, ref.promise, onFulfilled, onRejected, method, node)
}

export const constructPromise = <R>(
  runner: CallbackRunner<R>,
  promises: PromiseRuntime<R>,
  executor: unknown,
  node: AstNode,
): Effect.Effect<CodeModePromise, unknown, R> => {
  if (!(executor instanceof CodeModeFunction)) {
    throw new InterpreterRuntimeError(
      "new Promise(...) expects an executor function (e.g. new Promise((resolve, reject) => { ... })).",
      node,
    ).as("TypeError")
  }
  return Effect.gen(function* () {
    const deferred = Deferred.makeUnsafe<unknown, unknown>()
    const box: { own?: CodeModePromise } = {}
    const promise = yield* promises.create(
      Effect.flatMap(Deferred.await(deferred), (value) => {
        if (!(value instanceof CodeModePromise)) return Effect.succeed(value)
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

// Settle one reaction turn after the deciding member, after its existing reactions.
const settleAfterTurn = <A, E, R>(body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.exit(body), (exit) => Effect.andThen(Effect.yieldNow, exit))

class PromiseAnyFulfilled {
  constructor(readonly value: unknown) {}
}

const reactionHandler = (value: unknown, method: string, node: AstNode): SupportedCallback | undefined => {
  if (isSupportedCallback(value)) return value
  if (typeofValue(value) === "function") {
    throw new InterpreterRuntimeError(
      `${method} cannot use this callable as a handler; wrap it in an arrow function, e.g. (value) => tools.ns.tool(value).`,
      node,
    )
  }
  return undefined
}

// Teardown bypasses handlers; settled reactions yield once so handlers never run inline.
const reactionExit = <R>(
  promises: PromiseRuntime<R>,
  source: CodeModePromise,
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
  source: CodeModePromise,
  onFulfilled: SupportedCallback | undefined,
  onRejected: SupportedCallback | undefined,
  method: string,
  node: AstNode,
): Effect.Effect<CodeModePromise, never, R> => {
  const box: { derived?: CodeModePromise } = {}
  const body = Effect.gen(function* () {
    const exit = yield* reactionExit(promises, source)
    const handler = Exit.isSuccess(exit) ? onFulfilled : onRejected
    if (handler === undefined) return yield* exit
    const input = Exit.isSuccess(exit) ? exit.value : caughtErrorValue(Cause.squash(exit.cause))
    const result = yield* applyCollectionCallback(runner, handler, method, node)([input])
    if (result === box.derived) return yield* Effect.fail(selfResolutionError(node))
    if (result instanceof CodeModePromise) return yield* runner.settlePromise(result)
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
  source: CodeModePromise,
  cleanup: SupportedCallback | undefined,
  method: string,
  node: AstNode,
): Effect.Effect<CodeModePromise, never, R> =>
  promises.create(
    Effect.gen(function* () {
      const exit = yield* reactionExit(promises, source)
      if (cleanup !== undefined) {
        const result = yield* applyCollectionCallback(runner, cleanup, method, node)([])
        if (result instanceof CodeModePromise) yield* runner.settlePromise(result)
      }
      return yield* exit
    }),
  )
