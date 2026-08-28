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
  materialized: Map<string, Info>
}

type Draft = {
  add(name: string, source: Source): void
  remove(name: string): void
  list(): readonly [string, Source][]
}

export interface Interface extends State.Transformable<Draft> {
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
    const state: State.Interface<Data, Draft> = State.create<Data, Draft>({
      name: "reference",
      initial: () => ({ sources: new Map(), materialized: new Map() }),
      draft: (draft) => ({
        add: (name, source) => draft.sources.set(name, source as Types.DeepMutable<Source>),
        remove: (name) => draft.sources.delete(name),
        list: () => Array.from(draft.sources.entries()) as [string, Source][],
      }),
      prepare: (data) => {
        for (const [name, source] of data.sources) {
          if (source.type === "local") {
            data.materialized.set(
              name,
              Info.make({
                name,
                path: source.path,
                ...(source.description === undefined ? {} : { description: source.description }),
                ...(source.hidden === undefined ? {} : { hidden: source.hidden }),
                source,
              }),
            )
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
          data.materialized.set(
            name,
            Info.make({
              name,
              path: AbsolutePath.make(Repository.cachePath(global.repos, repository, source.branch)),
              ...(source.description === undefined ? {} : { description: source.description }),
              ...(source.hidden === undefined ? {} : { hidden: source.hidden }),
              source,
            }),
          )
        }
      },
      notify: () =>
        Effect.gen(function* () {
          for (const info of state.get().materialized.values()) {
            const source = info.source
            if (source.type !== "git") continue
            yield* cache
              .ensure({
                reference: Repository.parseRemote(source.repository),
                branch: source.branch,
                refresh: true,
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to materialize reference", {
                    name: info.name,
                    repository: source.repository,
                    cause,
                  }),
                ),
                Effect.forkIn(scope),
              )
          }
          yield* bus.publish(Reference.Event.Updated, {})
        }),
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      list: Effect.fn("Reference.list")(function* () {
        return Array.from(state.get().materialized.values())
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Global.node, Bus.node, RepositoryCache.node],
})
