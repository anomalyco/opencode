export * as TaskGraphJobs from "./task-graph-jobs"

import { Deferred, Effect, Exit, Ref, Scope } from "effect"
import { BackgroundJob } from "./background-job"
import { Identifier } from "./id/id"
import { TaskGraph } from "./task-graph"

/**
 * TaskGraphJobs — Fase 4 (agent-first). Bridge from TaskGraph to BackgroundJob:
 * every eligible node runs as its own job so fan-out work is observable in
 * `BackgroundJob.list` and cancellable through the same
 * `metadata.parentSessionId` cascade used for sessions (`run-state`).
 *
 * Semantics:
 * - `run` validates the graph first (invalid graphs start no jobs), then
 *   drains it one wave at a time through jobs of type `task-graph-node`
 *   tagged with `nodeId`, `dependsOn`, and — when given — `parentSessionId`.
 * - BackgroundJob persists text output and error text only, so the typed node
 *   result travels beside the job in a local slot: outcomes keep the node's
 *   original A/E while the job records a readable text rendering.
 * - Cancelling a node job externally (session cascade) interrupts that node
 *   and aborts the drain. The drain's scope owns every node job: interrupting
 *   the drain closes the scope, and the cancel finalizer is registered
 *   *before* the job starts, so a running job is always cancelled during the
 *   drain's own unwinding. A finalizer that runs before the start arms a
 *   post-start cancel instead, so a job can never be born orphaned.
 */

export interface Options extends TaskGraph.RunOptions {
  readonly parentSessionID?: string
}

// Plain function instead of Effect.fn: the generic A/E body collapses
// inference under Effect.fn (see the same note in ./task-graph).
export function run<A, E>(jobs: BackgroundJob.Interface, specs: readonly TaskGraph.Spec<A, E>[], options?: Options) {
  return Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      return yield* TaskGraph.run(
        specs.map((spec) => ({ ...spec, run: viaJob(jobs, spec, options, scope) })),
        options,
      )
    }),
  )
}

// Runs one node as a background job. The job status mirrors the node
// (completed/error/cancelled) while the local slot carries the typed exit.
const viaJob = <A, E>(
  jobs: BackgroundJob.Interface,
  spec: TaskGraph.Spec<A, E>,
  options: Options | undefined,
  scope: Scope.Scope,
) =>
  Effect.gen(function* () {
    const slot = yield* Deferred.make<Exit.Exit<A, E>>()
    const id = Identifier.ascending("job")
    const closed = yield* Ref.make(false)
    // Register the cancel before starting, atomically with the start: an
    // interrupted drain cancels the job while unwinding, and if the scope
    // already closed, the armed flag makes the post-start step cancel the
    // job it just created instead of leaking it.
    yield* Effect.uninterruptible(
      Scope.addFinalizer(scope, Ref.set(closed, true).pipe(Effect.andThen(jobs.cancel(id)))).pipe(
        Effect.andThen(
          jobs.start({
            id,
            type: "task-graph-node",
            title: spec.id,
            metadata: {
              ...(options?.parentSessionID ? { parentSessionId: options.parentSessionID } : {}),
              nodeId: spec.id,
              dependsOn: [...(spec.dependsOn ?? [])],
            },
            run: Effect.exit(spec.run).pipe(
              Effect.tap((exit) => Deferred.succeed(slot, exit)),
              // Re-fail so a failed node settles the job as error, not completed;
              // success renders to the text the registry can persist.
              Effect.flatMap((exit) =>
                Exit.isSuccess(exit) ? Effect.succeed(String(exit.value)) : Effect.failCause(exit.cause),
              ),
            ),
          }),
        ),
        Effect.andThen(
          Ref.get(closed).pipe(Effect.flatMap((isClosed) => (isClosed ? jobs.cancel(id) : Effect.succeed(undefined)))),
        ),
      ),
    )
    const result = yield* jobs.wait({ id })
    if (result.info === undefined) return yield* Effect.die(new Error(`task-graph job ${id} is missing`))
    if (result.info.status === "cancelled") return yield* Effect.interrupt
    const exit = yield* Deferred.await(slot)
    if (Exit.isSuccess(exit)) return exit.value
    return yield* Effect.failCause(exit.cause)
  })
