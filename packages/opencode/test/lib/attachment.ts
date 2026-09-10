import { Effect, Scope } from "effect"
import { ProjectV2 } from "@opencode-ai/core/project"
import { InstanceRef } from "../../src/effect/instance-ref"
import type { InstanceContext } from "../../src/project/instance-context"
import { AttachmentCoordinator } from "../../src/session/attachment/coordinator"

/**
 * Instance fixtures for the attachment coordinator.
 *
 * `AttachmentCoordinator.make` allocates its scope/claim registry through `InstanceState`, so it
 * needs a `Scope` to build and an ambient `InstanceRef` to read. `InstanceRef` is a
 * `Context.Reference` defaulting to `undefined`, so a test that supplies only the `Scope` compiles
 * and then dies inside `InstanceState.get`. Typecheck cannot catch that, which is why the Instance
 * is supplied here rather than left to each call site to remember.
 *
 * Two named directories, because the property under test is that they do not see each other. A
 * single-directory helper would let an isolation test pass for the wrong reason — nothing scoped at
 * all also produces "B cannot see A's scope" when B simply never ran.
 */

export const DIRECTORY_A = "/tmp/opencode-attachment-a"
export const DIRECTORY_B = "/tmp/opencode-attachment-b"

export function instance(directory: string): InstanceContext {
  return {
    directory,
    worktree: directory,
    project: {
      id: ProjectV2.ID.global,
      worktree: directory,
      time: { created: 0, updated: 0 },
      sandboxes: [],
    },
  }
}

/** Run a coordinator effect under an exact Instance. */
export const runIn = <A, E>(directory: string, effect: Effect.Effect<A, E, Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provideService(InstanceRef, instance(directory))))

/**
 * The drop-in for `Effect.runPromise` in single-Instance coordinator tests. Every such test runs
 * under one directory, which is what those tests were written to assert against.
 */
export const runAttached = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) => runIn(DIRECTORY_A, effect)

/** Claim the one observer owner for an exact reservation. */
export const claimObserver = Effect.fn("AttachmentTest.claimObserver")(function* (
  scope: AttachmentCoordinator.Scope,
  reservation: AttachmentCoordinator.Reservation,
) {
  const claim = yield* scope.claimObserver(reservation)
  if (claim.type !== "owner") return yield* Effect.die(`attachment observer claim was ${claim.type}`)
})

/** Settle one exact terminal marker after a simulated successful parent prompt. */
export const settleTerminal = Effect.fn("AttachmentTest.settleTerminal")(function* (input: {
  scope: AttachmentCoordinator.Scope
  terminal: AttachmentCoordinator.Terminal
}) {
  yield* input.scope.settleTerminal(input.terminal)
})

/**
 * A coordinator for `TaskPromptOps` fixtures that must supply the required member without
 * exercising attachment behaviour.
 *
 * `locate` answers "no scope", which is the truthful answer for a Session no scope was opened for,
 * and is the one method `task.ts` reaches with the feature flag off. Everything else is reached only
 * with the flag on, so reaching it here means the fixture is exercising attachment behaviour and
 * wants a real coordinator — those methods therefore die with a self-describing message rather than
 * returning something plausible.
 *
 * Loud rather than permissive, deliberately: a stub that quietly returned a fresh scope would let a
 * flag-on test pass while asserting against a coordinator nothing else could observe.
 */
export function inertCoordinator(): AttachmentCoordinator.Interface {
  return {
    locate: () => Effect.succeed(undefined),
    locateBorrowable: () =>
      Effect.die("inertCoordinator: locateBorrowable() reached — this fixture needs a real coordinator"),
    captureFence: () => Effect.succeed(false),
    claimCancellationAtFence: () => Effect.succeed(false),
    open: () => Effect.die("inertCoordinator: open() reached — this fixture needs a real coordinator"),
    claim: () => Effect.die("inertCoordinator: claim() reached — this fixture needs a real coordinator"),
    settleClaim: () => Effect.die("inertCoordinator: settleClaim() reached — this fixture needs a real coordinator"),
    awaitClaim: () => Effect.die("inertCoordinator: awaitClaim() reached — this fixture needs a real coordinator"),
  }
}
