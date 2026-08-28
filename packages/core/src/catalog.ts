export * as Catalog from "./catalog.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Array, Context, Effect, Layer, Order, pipe } from "effect"
import { Catalog } from "@opencode-ai/schema/catalog"
import { Model } from "./model.js"
import { Provider } from "./provider.js"
import { Bus } from "./bus.js"
import { State } from "./state.js"
import { Integration } from "./integration.js"

export type ProviderRecord = {
  provider: Provider.MutableInfo
  models: Map<Model.ID, Model.MutableInfo>
}

export type DefaultModel = { providerID: Provider.ID; modelID: Model.ID }

export { Event } from "@opencode-ai/schema/catalog"

type Data = {
  providers: Map<Provider.ID, ProviderRecord>
  defaultModel?: DefaultModel
}

export type Draft = {
  provider: {
    list: () => readonly ProviderRecord[]
    get: (providerID: Provider.ID) => ProviderRecord | undefined
    update: (providerID: Provider.ID, fn: (provider: Provider.MutableInfo) => void) => void
    remove: (providerID: Provider.ID) => void
  }
  model: {
    get: (providerID: Provider.ID, modelID: Model.ID) => Model.Info | undefined
    update: (providerID: Provider.ID, modelID: Model.ID, fn: (model: Model.MutableInfo) => void) => void
    remove: (providerID: Provider.ID, modelID: Model.ID) => void
    default: {
      get: () => DefaultModel | undefined
      set: (providerID: Provider.ID, modelID: Model.ID) => void
    }
  }
}

export interface Interface extends State.Transformable<Draft> {
  readonly provider: {
    readonly get: (providerID: Provider.ID) => Effect.Effect<Provider.Info | undefined>
    readonly all: () => Effect.Effect<Provider.Info[]>
    readonly available: () => Effect.Effect<Provider.Info[]>
  }
  readonly model: {
    readonly get: (providerID: Provider.ID, modelID: Model.ID) => Effect.Effect<Model.Info | undefined>
    readonly all: () => Effect.Effect<Model.Info[]>
    readonly available: () => Effect.Effect<Model.Info[]>
    readonly default: () => Effect.Effect<Model.Info | undefined>
    readonly small: (providerID: Provider.ID) => Effect.Effect<Model.Info | undefined>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Catalog") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const integrations = yield* Integration.Service

    const available = (provider: Provider.Info, integration: Integration.Info | undefined) => {
      if (provider.activation === "disabled") return false
      if (provider.activation === "enabled") return true
      if (integration?.connections.length) return true
      return provider.integrationID === undefined && !integration
    }

    const projectModel = (model: Model.Info, provider: Provider.Info) => {
      return {
        ...model,
        package: model.package ?? provider.package,
        settings: Provider.mergeOverlay(provider.settings, model.settings),
        headers: Provider.mergeHeaders(provider.headers, model.headers),
        body: Provider.mergeOverlay(provider.body, model.body),
      } satisfies Model.Info
    }

    const state = State.create<Data, Draft>({
      name: "catalog",
      initial: () => ({ providers: new Map() }),
      draft: (draft) => {
        const result: Draft = {
          provider: {
            list: () => Array.fromIterable(draft.providers.values()) as ProviderRecord[],
            get: (providerID) => draft.providers.get(providerID),
            update: (providerID, fn) => {
              let current = draft.providers.get(providerID)
              if (!current) {
                current = {
                  provider: Provider.Info.empty(providerID) as Provider.MutableInfo,
                  models: new Map<Model.ID, Model.MutableInfo>(),
                }
                draft.providers.set(providerID, current)
              }
              fn(current.provider)
            },
            remove: (providerID) => {
              draft.providers.delete(providerID)
            },
          },
          model: {
            get: (providerID, modelID) => draft.providers.get(providerID)?.models.get(modelID),
            update: (providerID, modelID, fn) => {
              let record = draft.providers.get(providerID)
              if (!record) {
                record = {
                  provider: Provider.Info.empty(providerID) as Provider.MutableInfo,
                  models: new Map<Model.ID, Model.MutableInfo>(),
                }
                draft.providers.set(providerID, record)
              }
              const model = record.models.get(modelID) ?? (Model.Info.default(providerID, modelID) as Model.MutableInfo)
              if (!record.models.has(modelID)) record.models.set(modelID, model)
              fn(model)
              model.id = modelID
              model.providerID = providerID
            },
            remove: (providerID, modelID) => {
              draft.providers.get(providerID)?.models.delete(modelID)
            },
            default: {
              get: () => draft.defaultModel,
              set: (providerID, modelID) => {
                draft.defaultModel = { providerID, modelID }
              },
            },
          },
        }
        return result
      },
      finalize: Effect.fn("Catalog.finalize")(function* () {
        yield* bus.publish(Catalog.Event.Updated, {})
      }),
    })
    const result: Interface = {
      transform: state.transform,
      reload: state.reload,

      provider: {
        get: Effect.fn("Catalog.provider.get")(function* (providerID) {
          return (yield* state.read()).providers.get(providerID)?.provider
        }),

        all: Effect.fn("Catalog.provider.all")(function* () {
          return Array.fromIterable((yield* state.read()).providers.values()).map((record) => record.provider)
        }),

        available: Effect.fn("Catalog.provider.available")(function* () {
          const active = new Map((yield* integrations.list()).map((integration) => [integration.id, integration]))
          return (yield* result.provider.all()).filter((provider) =>
            available(provider, active.get(provider.integrationID ?? Integration.ID.make(provider.id))),
          )
        }),
      },

      model: {
        get: Effect.fn("Catalog.model.get")(function* (providerID, modelID) {
          const record = (yield* state.read()).providers.get(providerID)
          if (!record) return
          const model = record.models.get(modelID)
          return model && projectModel(model, record.provider)
        }),

        all: Effect.fn("Catalog.model.all")(function* () {
          const data = yield* state.read()
          return pipe(
            Array.fromIterable(data.providers.values()),
            Array.flatMap((record) => {
              return Array.fromIterable(record.models.values()).map((model) => projectModel(model, record.provider))
            }),
            Array.sortWith((item) => item.time.released, Order.flip(Order.Number)),
          )
        }),

        available: Effect.fn("Catalog.model.available")(function* () {
          const active = new Map((yield* integrations.list()).map((integration) => [integration.id, integration]))
          const data = yield* state.read()
          const models: Model.Info[] = []
          for (const record of data.providers.values()) {
            if (
              !available(
                record.provider,
                active.get(record.provider.integrationID ?? Integration.ID.make(record.provider.id)),
              )
            ) {
              continue
            }
            for (const model of record.models.values()) {
              if (!model.enabled) continue
              models.push(projectModel(model, record.provider))
            }
          }
          return pipe(
            models,
            Array.sortWith((item) => item.time.released, Order.flip(Order.Number)),
          )
        }),

        default: Effect.fn("Catalog.model.default")(function* () {
          const data = yield* state.read()
          const defaultModel = data.defaultModel
          if (defaultModel) {
            const record = data.providers.get(defaultModel.providerID)
            const model = record?.models.get(defaultModel.modelID)
            if (record && model?.enabled) {
              const integration = yield* integrations.get(
                record.provider.integrationID ?? Integration.ID.make(record.provider.id),
              )
              if (available(record.provider, integration)) return projectModel(model, record.provider)
            }
          }

          return (yield* result.model.available())[0]
        }),

        small: Effect.fn("Catalog.model.small")(function* (providerID) {
          const record = (yield* state.read()).providers.get(providerID)
          if (!record) return
          const models = pipe(
            Array.fromIterable(record.models.values()),
            Array.filter(
              (model) =>
                model.providerID === providerID &&
                model.enabled &&
                model.status === "active" &&
                model.capabilities.input.some((item) => item.startsWith("text")) &&
                model.capabilities.output.some((item) => item.startsWith("text")),
            ),
            Array.sortWith((model) => model.time.released, Order.flip(Order.Number)),
          )
          for (const family of SMALL_MODEL_FAMILY_PRIORITY) {
            const selected = models.find((model) => model.family === family)
            if (selected) return projectModel(selected, record.provider)
          }
        }),
      },
    }

    return Service.of(result)
  }),
)

const SMALL_MODEL_FAMILY_PRIORITY = ["gpt-luna", "gemini-flash-lite", "gemini-flash", "claude-haiku"]

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, Integration.node] })
