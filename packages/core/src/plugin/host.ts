export * as PluginHost from "./host"

import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { PluginHost as Interface } from "@opencode-ai/plugin/v2/effect"
import type { Event as SDKEvent, ModelV2Info } from "@opencode-ai/sdk/v2/types"
import { Effect, Schema, Stream } from "effect"
import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { EventV2 } from "../event"
import { FileSystem } from "../filesystem"
import { Global } from "../global"
import { Integration } from "../integration"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { Npm } from "../npm"
import { PluginV2 } from "../plugin"
import { ProviderV2 } from "../provider"
import { Reference } from "../reference"
import { SkillV2 } from "../skill"

type EventMap = { [Item in SDKEvent as Item["type"]]: Item }
type SDKHook = (event: {
  readonly model: ModelV2Info
  readonly package: string
  readonly options: Record<string, any>
  sdk?: any
}) => Effect.Effect<void> | void
type LanguageHook = (event: {
  readonly model: ModelV2Info
  readonly sdk: any
  readonly options: Record<string, any>
  language?: LanguageModelV3
}) => Effect.Effect<void> | void

export const make = Effect.fn("PluginHost.make")(function* () {
  const agents = yield* AgentV2.Service
  const catalog = yield* Catalog.Service
  const commands = yield* CommandV2.Service
  const events = yield* EventV2.Service
  const filesystem = yield* FileSystem.Service
  const global = yield* Global.Service
  const integration = yield* Integration.Service
  const location = yield* Location.Service
  const npm = yield* Npm.Service
  const plugin = yield* PluginV2.Service
  const reference = yield* Reference.Service
  const skill = yield* SkillV2.Service

  return {
    agent: {
      get: (id) => agents.get(AgentV2.ID.make(id)),
      default: agents.default,
      list: agents.all,
      rebuild: agents.rebuild,
      transform: (callback) =>
        agents.transform((draft) =>
          callback({
            list: draft.list,
            get: (id) => draft.get(AgentV2.ID.make(id)),
            default: (id) => draft.default(id === undefined ? undefined : AgentV2.ID.make(id)),
            update: (id, update) => draft.update(AgentV2.ID.make(id), update),
            remove: (id) => draft.remove(AgentV2.ID.make(id)),
          }),
        ),
    },
    aisdk: {
      hook: (name, callback) => {
        if (name === "sdk") {
          const run = callback as SDKHook
          return plugin.hook("aisdk.sdk", (event) => {
            const output = {
              model: event.model,
              package: event.package,
              options: event.options,
              sdk: event.sdk,
            }
            const result = run(output)
            return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
              Effect.tap(() => Effect.sync(() => (event.sdk = output.sdk))),
            )
          })
        }
        const run = callback as LanguageHook
        return plugin.hook("aisdk.language", (event) => {
          const output = {
            model: event.model,
            sdk: event.sdk,
            options: event.options,
            language: event.language,
          }
          const result = run(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.language = output.language))),
          )
        })
      },
    },
    catalog: {
      provider: {
        get: (id) => catalog.provider.get(ProviderV2.ID.make(id)),
        list: catalog.provider.all,
        available: catalog.provider.available,
      },
      model: {
        get: (providerID, modelID) => catalog.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
        list: catalog.model.all,
        available: catalog.model.available,
        default: catalog.model.default,
        small: (providerID) => catalog.model.small(ProviderV2.ID.make(providerID)),
      },
      rebuild: catalog.rebuild,
      transform: (callback) =>
        catalog.transform((draft) =>
          callback({
            provider: {
              list: draft.provider.list,
              get: (id) => draft.provider.get(ProviderV2.ID.make(id)),
              update: (id, update) => draft.provider.update(ProviderV2.ID.make(id), update),
              remove: (id) => draft.provider.remove(ProviderV2.ID.make(id)),
            },
            model: {
              get: (providerID, modelID) => draft.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              update: (providerID, modelID, update) =>
                draft.model.update(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID), update),
              remove: (providerID, modelID) =>
                draft.model.remove(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              default: {
                get: draft.model.default.get,
                set: (providerID, modelID) =>
                  draft.model.default.set(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              },
            },
          }),
        ),
    },
    command: {
      get: commands.get,
      list: commands.list,
      rebuild: commands.rebuild,
      transform: commands.transform,
    },
    event: {
      subscribe: <Type extends keyof EventMap>(type: Type): Stream.Stream<EventMap[Type]> =>
        Stream.unwrap(
          Effect.sync(() => {
            const definition = EventV2.registry.get(type)
            if (!definition) throw new Error(`Unknown event type: ${type}`)
            const encode = Schema.encodeUnknownSync(definition.data as Schema.Codec<unknown, unknown, never, never>)
            return events.subscribe(definition).pipe(
              Stream.map(
                (event) =>
                  ({
                    id: event.id,
                    type: event.type,
                    properties: encode(event.data),
                  }) as unknown as EventMap[Type],
              ),
            )
          }),
        ),
    },
    filesystem: {
      read: (input) => filesystem.read(Schema.decodeUnknownSync(FileSystem.ReadInput)(input)),
      list: (input) => filesystem.list(Schema.decodeUnknownSync(FileSystem.ListInput)(input ?? {})),
      find: (input) => filesystem.find(Schema.decodeUnknownSync(FileSystem.FindInput)(input)),
      glob: (input) => filesystem.glob(Schema.decodeUnknownSync(FileSystem.GlobInput)(input)),
    },
    integration: {
      get: (id) => integration.get(Integration.ID.make(id)),
      list: integration.list,
      rebuild: integration.rebuild,
      transform: (callback) =>
        integration.transform((draft) =>
          callback({
            list: draft.list,
            get: (id) => draft.get(Integration.ID.make(id)),
            update: (id, update) => draft.update(Integration.ID.make(id), update),
            remove: (id) => draft.remove(Integration.ID.make(id)),
            method: {
              list: (id) => draft.method.list(Integration.ID.make(id)),
              update: (input) => {
                if (input.method.type === "env") {
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { type: "env", names: input.method.names },
                  })
                  return
                }
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: { type: "key", label: input.method.label },
                })
              },
              remove: (id, method) =>
                draft.method.remove(Integration.ID.make(id), Schema.decodeUnknownSync(Integration.Method)(method)),
            },
          }),
        ),
    },
    location,
    npm,
    path: {
      home: global.home,
      data: global.data,
      cache: global.cache,
      config: global.config,
      state: global.state,
      temp: global.tmp,
    },
    reference: {
      list: reference.list,
      rebuild: reference.rebuild,
      transform: (callback) =>
        reference.transform((draft) =>
          callback({
            add: (name, source) => draft.add(name, Schema.decodeUnknownSync(Reference.Source)(source)),
            remove: draft.remove,
            list: draft.list,
          }),
        ),
    },
    skill: {
      sources: skill.sources,
      list: skill.list,
      rebuild: skill.rebuild,
      transform: (callback) =>
        skill.transform((draft) =>
          callback({
            source: (source) => draft.source(Schema.decodeUnknownSync(SkillV2.Source)(source)),
            list: draft.list,
          }),
        ),
    },
  } satisfies Interface
})
