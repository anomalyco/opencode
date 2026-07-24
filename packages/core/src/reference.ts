export * as Reference from "./reference"

import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Schedule, Scope, Types } from "effect"
import { Reference } from "@opencode-ai/schema/reference"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { EventV2 } from "./event"
import { Repository } from "./repository"
import { RepositoryCache } from "./repository-cache"
import { AbsolutePath } from "./schema"
import { State } from "./state"

export const LocalSource = Reference.LocalSource
export type LocalSource = Reference.LocalSource

export const GitSource = Reference.GitSource
export type GitSource = Reference.GitSource

export const Source = Reference.Source
export type Source = Reference.Source

export const Event = Reference.Event

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
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Reference") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const events = yield* EventV2.Service
    const cache = yield* RepositoryCache.Service
    const fs = yield* FSUtil.Service
    const scope = yield* Scope.Scope
    const materialized = new Map<string, Info>()

    // Guards late fork completions: a reload bumps the generation, so a clone
    // finishing for a replaced configuration never resurrects its reference.
    let generation = 0
    const announce = (expected: number, name: string, entry: Info) =>
      Effect.suspend(() => {
        if (expected !== generation || materialized.has(name)) return Effect.void
        materialized.set(name, entry)
        return events.publish(Event.Updated, {})
      })
    const state = State.create<Data, Draft>({
      initial: () => ({ sources: new Map() }),
      draft: (draft) => ({
        add: (name, source) => draft.sources.set(name, source as Types.DeepMutable<Source>),
        remove: (name) => draft.sources.delete(name),
        list: () => Array.from(draft.sources.entries()) as [string, Source][],
      }),
      finalize: (draft) =>
        Effect.gen(function* () {
          const current = ++generation
          materialized.clear()
          for (const [name, source] of draft.list()) {
            if (source.type === "local") {
              materialized.set(
                name,
                new Info({
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
            const entry = new Info({
              name,
              path: AbsolutePath.make(Repository.cachePath(global.repos, repository, source.branch)),
              ...(source.description === undefined ? {} : { description: source.description }),
              ...(source.hidden === undefined ? {} : { hidden: source.hidden }),
              source,
            })
            // A checkout already on disk serves immediately; a missing one is
            // announced only after materialization succeeds, so consumers
            // never see a path that does not exist.
            if (yield* fs.existsSafe(entry.path)) materialized.set(name, entry)
            yield* cache.ensure({ reference: repository, branch: source.branch, refresh: true }).pipe(
              Effect.retry({
                while: (error) =>
                  error._tag === "RepositoryCacheCloneFailedError" || error._tag === "RepositoryCacheFetchFailedError",
                schedule: Schedule.exponential(2000).pipe(Schedule.jittered),
                times: 3,
              }),
              Effect.flatMap(() => announce(current, name, entry)),
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to materialize reference", {
                  name,
                  repository: source.repository,
                  cause,
                }),
              ),
              Effect.forkIn(scope),
            )
          }
          yield* events.publish(Event.Updated, {})
        }),
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      list: Effect.fn("Reference.list")(function* () {
        return Array.from(materialized.values())
      }),
    })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Global.node, EventV2.node, RepositoryCache.node, FSUtil.node],
})
