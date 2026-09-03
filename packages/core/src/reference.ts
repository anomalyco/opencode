export * as Reference from "./reference.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Scope } from "effect"
import { Reference } from "@opencode-ai/schema/reference"
import { Global } from "@opencode-ai/util/global"
import { Bus } from "./bus.js"
import { Repository } from "./repository.js"
import { RepositoryCache } from "./repository-cache.js"
import { AbsolutePath } from "./schema.js"
import { State } from "./state.js"

export const LocalSource = Reference.LocalSource
export type LocalSource = Reference.LocalSource

export const GitSource = Reference.GitSource
export type GitSource = Reference.GitSource

export const Source = Reference.Source
export type Source = Reference.Source

export { Event } from "@opencode-ai/schema/reference"

export const Info = Reference.Info
export type Info = Reference.Info

type Data = {
  sources: Map<string, Source>
}

type Editor = {
  add(name: string, source: Source): void
  remove(name: string): void
  list(): readonly [string, Source][]
  get(name: string): Source | undefined
}

export interface Interface extends State.Transformable<Editor> {
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Reference") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const bus = yield* Bus.Service
    const cache = yield* RepositoryCache.Service
    const scope = yield* Scope.Scope
    const list = (): Info[] =>
      Array.from(state.get().sources).flatMap(([name, source]) => {
        const info = {
          name,
          source,
          ...(source.description === undefined ? {} : { description: source.description }),
          ...(source.hidden === undefined ? {} : { hidden: source.hidden }),
        }
        if (source.type === "local") return [Info.make({ ...info, path: source.path })]
        const repository = Repository.parse(source.repository)
        if (!repository || !Repository.isRemote(repository)) return []
        if (source.branch) {
          try {
            Repository.validateBranch(source.branch)
          } catch {
            return []
          }
        }
        return [
          Info.make({
            ...info,
            path: AbsolutePath.make(Repository.cachePath(global.repos, repository, source.branch)),
          }),
        ]
      })
    const refresh = Effect.fn("Reference.refresh")(function* () {
      yield* Effect.forEach(
        list(),
        (reference) =>
          Effect.gen(function* () {
            if (reference.source.type !== "git") return
            yield* cache.ensure({
              reference: Repository.parseRemote(reference.source.repository),
              branch: reference.source.branch,
              refresh: "daily",
            })
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to materialize reference", { name: reference.name, cause }),
            ),
          ),
        { concurrency: 4, discard: true },
      )
    })
    const state = State.create<Data, Editor>({
      name: "reference",
      initial: () => ({ sources: new Map() }),
      editor: (editor) => ({
        add: (name, source) => editor.sources.set(name, source),
        remove: (name) => editor.sources.delete(name),
        list: () => Array.from(editor.sources),
        get: (name) => editor.sources.get(name),
      }),
      notify: () =>
        Effect.gen(function* () {
          yield* refresh().pipe(Effect.forkIn(scope))
          yield* bus.publish(Reference.Event.Updated, {})
        }),
    })

    // Check independently of session activity; the shared cache throttles Git work daily.
    yield* Effect.sleep("1 hour").pipe(Effect.andThen(refresh()), Effect.forever, Effect.forkScoped)

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      list: Effect.fn("Reference.list")(function* () {
        return list()
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Global.node, Bus.node, RepositoryCache.node],
})
