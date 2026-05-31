export * as State from "./state"

import { Effect, Scope, Semaphore } from "effect"
import { createDraft, finishDraft, type Draft, type Objectish } from "immer"

export type Transform<Editor> = (editor: Editor) => void
export type MakeEditor<State extends Objectish, Editor> = (draft: Draft<State>) => Editor

export interface Options<State extends Objectish, Editor> {
  readonly initial: () => State
  readonly editor: MakeEditor<State, Editor>
  /** Completes every committed edit; reason identifies exceptional update origins. */
  readonly finalize?: (editor: Editor, reason?: string) => Effect.Effect<void>
}

export interface Interface<State extends Objectish, Editor> {
  readonly get: () => State
  readonly transform: () => Effect.Effect<(transform: Transform<Editor>) => Effect.Effect<void>, never, Scope.Scope>
  readonly update: (update: (editor: Editor) => Effect.Effect<void>, reason?: string) => Effect.Effect<void>
}

export function create<State extends Objectish, Editor>(options: Options<State, Editor>): Interface<State, Editor> {
  let state = options.initial()
  let transforms: { update: Transform<Editor> }[] = []
  const semaphore = Semaphore.makeUnsafe(1)

  const commit = Effect.fn("State.commit")(function* (draft: Draft<State>, reason?: string) {
    const api = options.editor(draft)
    if (options.finalize) yield* options.finalize(api, reason)
    state = finishDraft(draft) as State
  })

  const rebuild = Effect.fn("State.rebuild")(function* () {
    const draft = createDraft(options.initial())
    const api = options.editor(draft)
    for (const transform of transforms) transform.update(api)
    yield* commit(draft)
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
      const draft = createDraft(state)
      yield* update(options.editor(draft))
      yield* commit(draft, reason)
    }, semaphore.withPermit),
  }
}
