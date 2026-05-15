import { Context, Effect, Exit, Fiber } from "effect"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import { Instance } from "@/project/instance"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceID } from "@/control-plane/schema"
import { LocalContext } from "@/util/local-context"
import { InstanceRef, WorkspaceRef } from "./instance-ref"
import { attachWith } from "./run-service"

export interface Shape {
  readonly promise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>
  readonly fork: <A, E, R>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>
  readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>
  readonly bind: <Args extends readonly unknown[], Result>(fn: (...args: Args) => Result) => (...args: Args) => Result
}

function restore<R>(instance: InstanceContext | undefined, workspace: WorkspaceID | undefined, fn: () => R): R {
  if (instance && workspace !== undefined) {
    return WorkspaceContext.restore(workspace, () => Instance.restore(instance, fn))
  }
  if (instance) return Instance.restore(instance, fn)
  if (workspace !== undefined) return WorkspaceContext.restore(workspace, fn)
  return fn()
}

function captureSync() {
  const fiber = Fiber.getCurrent()
  const value = fiber ? Context.getReferenceUnsafe(fiber.context, InstanceRef) : undefined
  const instance =
    value ??
    (() => {
      try {
        return Instance.current
      } catch (err) {
        if (!(err instanceof LocalContext.NotFound)) throw err
      }
    })()
  const workspace =
    (fiber ? Context.getReferenceUnsafe(fiber.context, WorkspaceRef) : undefined) ?? WorkspaceContext.workspaceID
  return { instance, workspace }
}

export const bind = <Args extends readonly unknown[], Result>(fn: (...args: Args) => Result) => {
  const captured = captureSync()
  return (...args: Args) => restore(captured.instance, captured.workspace, () => fn(...args))
}

/**
 * Bridge from Effect into a Promise-returning JS callback while installing
 * legacy `Instance.context` and `WorkspaceContext` AsyncLocalStorage for
 * the duration of the callback. Effect's `InstanceRef`/`WorkspaceRef` do
 * not propagate across async/await boundaries inside `Effect.promise(() =>
 * async fn)` callbacks that re-enter Effect via `AppRuntime.runPromise`,
 * but Node's AsyncLocalStorage does. Use this whenever an Effect crosses
 * into JS that may itself spawn new Effect runtimes (workspace adapters,
 * legacy plugins, etc.).
 *
 * Mirrors `Effect.promise` but restores legacy ALS first.
 */
export const fromPromise = <T>(fn: () => Promise<T> | T): Effect.Effect<T> =>
  Effect.gen(function* () {
    const instance = yield* InstanceRef
    const workspace = yield* WorkspaceRef
    return yield* Effect.promise(() => Promise.resolve(restore(instance, workspace, () => fn())))
  })

export function make(): Effect.Effect<Shape> {
  return Effect.gen(function* () {
    const ctx = yield* Effect.context()
    const value = yield* InstanceRef
    const captured = captureSync()
    const instance = value ?? captured.instance
    const workspace = (yield* WorkspaceRef) ?? captured.workspace
    const attach = <A, E, R>(effect: Effect.Effect<A, E, R>) => attachWith(effect, { instance, workspace })
    const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      attach(effect).pipe(Effect.provide(ctx)) as Effect.Effect<A, E, never>

    return {
      promise: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        restore(instance, workspace, () => Effect.runPromise(wrap(effect))),
      fork: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        restore(instance, workspace, () => Effect.runFork(wrap(effect))),
      run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.callback<A, E>((resume) => {
          restore(instance, workspace, () =>
            Effect.runPromiseExit(wrap(effect)).then((exit) =>
              resume(Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause)),
            ),
          )
        }),
      bind:
        <Args extends readonly unknown[], Result>(fn: (...args: Args) => Result) =>
        (...args: Args) =>
          restore(instance, workspace, () => fn(...args)),
    } satisfies Shape
  })
}

export * as EffectBridge from "./bridge"
