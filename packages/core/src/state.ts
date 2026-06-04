export * as State from "./state"

import { Effect, Scope, Semaphore } from "effect"
import type { Draft, Objectish } from "immer"

/**
 * A replayable contribution applied to an editor during rebuild.
 *
 * Transforms are intentionally synchronous and mutation-shaped: domain editors
 * hide the draft representation while preserving concise plugin/config code.
 */
export type Transform<Editor> = (editor: Editor) => void
export type MakeEditor<State extends Objectish, Editor> = (draft: Draft<State>) => Editor

export interface Options<State extends Objectish, Editor> {
  /** Creates the base value for initial state and every scoped-transform rebuild. */
  readonly initial: () => State
  /** Wraps the mutable draft in a domain-specific editor. */
  readonly editor: MakeEditor<State, Editor>
  /**
   * Completes every committed edit.
   *
   * For rebuilds, this runs after all active transforms have been replayed and
   * before the rebuilt state becomes visible. For direct updates, this runs
   * after the current state has already been edited. The optional reason is
   * caller-defined metadata for exceptional update origins.
   */
  readonly finalize?: (editor: Editor, reason?: string) => Effect.Effect<void>
}

export interface Interface<State extends Objectish, Editor> {
  readonly get: () => State
  /**
   * Registers a scoped transform slot and returns the slot updater.
   *
   * Acquiring the slot has no visible effect until the returned updater is
   * called. Each updater call replaces that slot's transform, then rebuilds the
   * materialized state from `initial()` by replaying all active transforms in
   * registration order. Closing the owning Scope removes the slot and rebuilds.
   */
  readonly transform: () => Effect.Effect<(transform: Transform<Editor>) => Effect.Effect<void>, never, Scope.Scope>
  /**
   * Mutates the current materialized state directly.
   *
   * This is not replayable contribution state: a later rebuild starts again
   * from `initial()` plus active transforms, so direct edits must be reserved
   * for current-state adjustments that are intentionally outside the transform
   * fold.
   */
  readonly update: (update: (editor: Editor) => Effect.Effect<void>, reason?: string) => Effect.Effect<void>
}

export function create<State extends Objectish, Editor>(options: Options<State, Editor>): Interface<State, Editor> {
  let state = options.initial()
  let transforms: { update: Transform<Editor> }[] = []
  const semaphore = Semaphore.makeUnsafe(1)

  const commit = Effect.fn("State.commit")(function* (next: State, reason?: string) {
    const api = options.editor(next as Draft<State>)
    if (options.finalize) yield* options.finalize(api, reason)
    state = next
  })

  const rebuild = Effect.fn("State.rebuild")(function* () {
    const next = options.initial()
    const api = options.editor(next as Draft<State>)
    for (const transform of transforms)
      yield* Effect.sync(() => transform.update(api)).pipe(Effect.withSpan("State.rebuild.update", {}))
    yield* commit(next)
  }, semaphore.withPermit)

  return {
    get: () => state,
    transform: Effect.fn("State.transform")(function* () {
      const transform = { update: (_editor: Editor) => {} }
      transforms = [...transforms, transform]
      const scope = yield* Scope.Scope
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          transforms = transforms.filter((item) => item !== transform)
        }).pipe(Effect.andThen(rebuild())),
      )
      return Effect.fnUntraced(function* (update: Transform<Editor>) {
        transform.update = update
        yield* rebuild()
      })
    }),
    update: Effect.fn("State.update")(function* (update, reason) {
      const api = options.editor(state as Draft<State>)
      yield* update(api)
      if (options.finalize) yield* options.finalize(api, reason)
    }, semaphore.withPermit),
  }
}
