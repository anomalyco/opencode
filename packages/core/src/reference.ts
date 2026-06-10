export * as Reference from "./reference"

import { Context, Effect, Layer, Schema, Scope } from "effect"
import { castDraft } from "immer"
import { Global } from "./global"
import { EventV2 } from "./event"
import { Repository } from "./repository"
import { RepositoryCache } from "./repository-cache"
import { AbsolutePath } from "./schema"
import { State } from "./state"

export class LocalSource extends Schema.Class<LocalSource>("Reference.LocalSource")({
  type: Schema.Literal("local"),
  path: AbsolutePath,
  description: Schema.String.pipe(Schema.optional),
  hidden: Schema.Boolean.pipe(Schema.optional),
}) {}

export class GitSource extends Schema.Class<GitSource>("Reference.GitSource")({
  type: Schema.Literal("git"),
  repository: Schema.String,
  branch: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
  hidden: Schema.Boolean.pipe(Schema.optional),
}) {}

export const Source = Schema.Union([LocalSource, GitSource]).pipe(Schema.toTaggedUnion("type"))
export type Source = typeof Source.Type

export const Event = {
  Updated: EventV2.define({ type: "reference.updated", schema: {} }),
}

export class Info extends Schema.Class<Info>("Reference.Info")({
  name: Schema.String,
  path: AbsolutePath,
  description: Schema.String.pipe(Schema.optional),
  hidden: Schema.Boolean.pipe(Schema.optional),
  source: Source,
}) {}

type Data = {
  sources: Map<string, Source>
}

type Editor = {
  add(name: string, source: Source): void
  remove(name: string): void
  list(): readonly [string, Source][]
}

export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Reference") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const events = yield* EventV2.Service
    const cache = yield* RepositoryCache.Service
    const scope = yield* Scope.Scope
    const materialized = new Map<string, Info>()
    const state = State.create<Data, Editor>({
      initial: () => ({ sources: new Map() }),
      editor: (draft) => ({
        add: (name, source) => draft.sources.set(name, castDraft(source)),
        remove: (name) => draft.sources.delete(name),
        list: () => Array.from(draft.sources.entries()) as [string, Source][],
      }),
      finalize: (editor) =>
        Effect.gen(function* () {
          materialized.clear()
          const seen = new Map<string, string | undefined>()
          for (const [name, source] of editor.list()) {
            if (source.type === "local") {
              materialized.set(
                name,
                new Info({
                  name,
                  path: source.path,
                  description: source.description,
                  hidden: source.hidden,
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
            const target = Repository.cachePath(global.repos, repository)
            if (seen.has(target) && seen.get(target) !== source.branch) continue
            seen.set(target, source.branch)
            materialized.set(
              name,
              new Info({
                name,
                path: AbsolutePath.make(target),
                description: source.description,
                hidden: source.hidden,
                source,
              }),
            )
            yield* cache.ensure({ reference: repository, branch: source.branch, refresh: true }).pipe(
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
      list: Effect.fn("Reference.list")(function* () {
        return Array.from(materialized.values())
      }),
    })
  }),
)

export const locationLayer = layer
