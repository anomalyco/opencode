export * as Reference from "./reference.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Scope, Types } from "effect"
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
  sources: Map<string, Types.DeepMutable<Source>>
}

type Draft = {
  add(name: string, source: Source): void
  remove(name: string): void
  list(): readonly [string, Source][]
}

export interface Interface extends State.Transformable<Draft> {
  readonly list: () => Effect.Effect<Info[]>
  /** Schedules daily refresh checks in the Location scope without waiting for Git. */
  readonly refresh: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Reference") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const bus = yield* Bus.Service
    const cache = yield* RepositoryCache.Service
    const scope = yield* Scope.Scope
    const materialized = new Map<string, Info>()
    const refresh = Effect.fn("Reference.refresh")(function* () {
      yield* Effect.forEach(
        Array.from(materialized.values()),
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
      ).pipe(Effect.forkIn(scope), Effect.asVoid)
    })
    const state = State.create<Data, Draft>({
      name: "reference",
      initial: () => ({ sources: new Map() }),
      draft: (draft) => ({
        add: (name, source) => draft.sources.set(name, source as Types.DeepMutable<Source>),
        remove: (name) => draft.sources.delete(name),
        list: () => Array.from(draft.sources.entries()) as [string, Source][],
      }),
      finalize: (draft) =>
        Effect.gen(function* () {
          materialized.clear()
          for (const [name, source] of draft.list()) {
            const info = {
              name,
              source,
              ...(source.description === undefined ? {} : { description: source.description }),
              ...(source.hidden === undefined ? {} : { hidden: source.hidden }),
            }
            if (source.type === "local") {
              materialized.set(name, Info.make({ ...info, path: source.path }))
              continue
            }
            const repository = Repository.parse(source.repository)
            if (!repository || !Repository.isRemote(repository)) continue
            if (source.branch) {
              try {
                Repository.validateBranch(source.branch)
              } catch {
                continue
              }
            }
            materialized.set(
              name,
              Info.make({
                ...info,
                path: AbsolutePath.make(Repository.cachePath(global.repos, repository, source.branch)),
              }),
            )
          }
          yield* refresh()
          yield* bus.publish(Reference.Event.Updated, {})
        }),
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      refresh,
      list: Effect.fn("Reference.list")(function* () {
        return Array.from(materialized.values())
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Global.node, Bus.node, RepositoryCache.node],
})
