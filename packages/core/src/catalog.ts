export * as Catalog from "./catalog"

import { Context, Effect, Layer, Option, Order, pipe, Schema, Array, Scope, Stream } from "effect"
import { castDraft, enableMapSet, type Draft } from "immer"
import { ModelV2 } from "./model"
import { PluginV2 } from "./plugin"
import { ProviderV2 } from "./provider"
import { Location } from "./location"
import { EventV2 } from "./event"
import { Policy } from "./policy"
import { State } from "./state"

export type ProviderRecord = {
  provider: ProviderV2.Info
  models: Map<ModelV2.ID, ModelV2.Info>
}

export type DefaultModel = { providerID: ProviderV2.ID; modelID: ModelV2.ID }

export class ProviderNotFoundError extends Schema.TaggedErrorClass<ProviderNotFoundError>()(
  "CatalogV2.ProviderNotFound",
  {
    providerID: ProviderV2.ID,
  },
) {}

export class ModelNotFoundError extends Schema.TaggedErrorClass<ModelNotFoundError>()("CatalogV2.ModelNotFound", {
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
}) {}

export const PolicyActions = Schema.Literals(["provider.use"])

export const Event = {
  ModelUpdated: EventV2.define({
    type: "catalog.model.updated",
    schema: {
      model: ModelV2.Info,
    },
  }),
}

type Data = {
  providers: Map<ProviderV2.ID, ProviderRecord>
  defaultModel?: DefaultModel
}

export type Editor = {
  provider: {
    list: () => readonly ProviderRecord[]
    get: (providerID: ProviderV2.ID) => ProviderRecord | undefined
    update: (providerID: ProviderV2.ID, fn: (provider: Draft<ProviderV2.Info>) => void) => void
    remove: (providerID: ProviderV2.ID) => void
  }
  model: {
    get: (providerID: ProviderV2.ID, modelID: ModelV2.ID) => ModelV2.Info | undefined
    update: (providerID: ProviderV2.ID, modelID: ModelV2.ID, fn: (model: Draft<ModelV2.Info>) => void) => void
    remove: (providerID: ProviderV2.ID, modelID: ModelV2.ID) => void
    default: {
      get: () => DefaultModel | undefined
      set: (providerID: ProviderV2.ID, modelID: ModelV2.ID) => void
    }
  }
}

export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly provider: {
    readonly get: (providerID: ProviderV2.ID) => Effect.Effect<ProviderV2.Info, ProviderNotFoundError>
    readonly all: () => Effect.Effect<ProviderV2.Info[]>
    readonly available: () => Effect.Effect<ProviderV2.Info[]>
  }
  readonly model: {
    readonly get: (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
    ) => Effect.Effect<ModelV2.Info, ProviderNotFoundError | ModelNotFoundError>
    readonly all: () => Effect.Effect<ModelV2.Info[]>
    readonly available: () => Effect.Effect<ModelV2.Info[]>
    readonly default: () => Effect.Effect<Option.Option<ModelV2.Info>>
    readonly small: (providerID: ProviderV2.ID) => Effect.Effect<Option.Option<ModelV2.Info>>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Catalog") {}

enableMapSet()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    yield* Location.Service
    const plugin = yield* PluginV2.Service
    const events = yield* EventV2.Service
    const policy = yield* Policy.Service
    const scope = yield* Scope.Scope

    const resolve = (model: ModelV2.Info) => {
      const provider = state.get().providers.get(model.providerID)!.provider
      const endpoint =
        model.endpoint.type === "unknown"
          ? provider.endpoint
          : model.endpoint.type === "aisdk" && provider.endpoint.type === "aisdk" && !model.endpoint.url
            ? { ...model.endpoint, url: provider.endpoint.url }
            : model.endpoint
      const options = {
        headers: {
          ...provider.options.headers,
          ...model.options.headers,
        },
        body: {
          ...provider.options.body,
          ...model.options.body,
        },
        aisdk: {
          provider: {
            ...provider.options.aisdk.provider,
            ...model.options.aisdk.provider,
          },
          request: model.options.aisdk.request,
        },
        variant: model.options.variant,
      }
      return new ModelV2.Info({
        ...model,
        endpoint,
        options,
      })
    }

    function* getRecord(providerID: ProviderV2.ID) {
      const match = state.get().providers.get(providerID)
      if (!match) return yield* new ProviderNotFoundError({ providerID })
      return match
    }

    const normalizeEndpoint = (item: Draft<ProviderV2.Info> | Draft<ModelV2.Info>) => {
      if (item.endpoint.type !== "aisdk" || typeof item.options.aisdk.provider.baseURL !== "string") return
      item.endpoint.url = item.options.aisdk.provider.baseURL
      delete item.options.aisdk.provider.baseURL
    }

    const state = State.create<Data, Editor>({
      initial: () => ({ providers: new Map() }),
      editor: (draft) => {
        const result: Editor = {
          provider: {
            list: () => Array.fromIterable(draft.providers.values()) as ProviderRecord[],
            get: (providerID) => draft.providers.get(providerID),
            update: (providerID, fn) => {
              let current = draft.providers.get(providerID)
              if (!current) {
                current = castDraft({
                  provider: ProviderV2.Info.empty(providerID),
                  models: new Map<ModelV2.ID, ModelV2.Info>(),
                })
                draft.providers.set(providerID, current)
              }
              fn(current.provider)
              normalizeEndpoint(current.provider)
            },
            remove: (providerID) => {
              draft.providers.delete(providerID)
            },
          },
          model: {
            get: (providerID, modelID) => draft.providers.get(providerID)?.models.get(modelID),
            update: (providerID, modelID, fn) => {
              result.provider.update(providerID, () => {})
              const record = draft.providers.get(providerID)!
              const model = record.models.get(modelID) ?? castDraft(ModelV2.Info.empty(providerID, modelID))
              if (!record.models.has(modelID)) record.models.set(modelID, model)
              fn(model)
              model.id = modelID
              model.providerID = providerID
              normalizeEndpoint(model)
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
      finalize: Effect.fn("CatalogV2.finalize")(function* (catalog, reason) {
        if (reason !== "plugin.added") yield* plugin.trigger("catalog.transform", catalog, {}).pipe(Effect.asVoid)
        for (const record of [...catalog.provider.list()]) {
          if ((yield* policy.evaluate("provider.use", record.provider.id, "allow")) === "deny") {
            catalog.provider.remove(record.provider.id)
          }
        }
      }),
    })

    yield* events.subscribe(PluginV2.Event.Added).pipe(
      Stream.runForEach((event) =>
        state.update((catalog) => plugin.triggerFor(event.data.id, "catalog.transform", catalog, {}), "plugin.added"),
      ),
      Effect.forkIn(scope, { startImmediately: true }),
    )

    const result: Interface = {
      transform: state.transform,

      provider: {
        get: Effect.fn("CatalogV2.provider.get")(function* (providerID) {
          const record = yield* getRecord(providerID)
          return record.provider
        }),

        all: Effect.fn("CatalogV2.provider.all")(function* () {
          return Array.fromIterable(state.get().providers.values()).map((record) => record.provider)
        }),

        available: Effect.fn("CatalogV2.provider.available")(function* () {
          return Array.fromIterable(state.get().providers.values())
            .map((record) => record.provider)
            .filter((provider) => provider.enabled)
        }),
      },

      model: {
        get: Effect.fn("CatalogV2.model.get")(function* (providerID, modelID) {
          const record = yield* getRecord(providerID)
          const model = record.models.get(modelID)
          if (!model) return yield* new ModelNotFoundError({ providerID, modelID })
          return resolve(model)
        }),

        all: Effect.fn("CatalogV2.model.all")(function* () {
          return pipe(
            Array.fromIterable(state.get().providers.values()),
            Array.flatMap((record) => Array.fromIterable(record.models.values())),
            Array.map(resolve),
            Array.sortWith((item) => item.time.released.epochMilliseconds, Order.flip(Order.Number)),
          )
        }),

        available: Effect.fn("CatalogV2.model.available")(function* () {
          return (yield* result.model.all()).filter((model) => {
            const record = state.get().providers.get(model.providerID)
            return record?.provider.enabled !== false && model.enabled
          })
        }),

        default: Effect.fn("CatalogV2.model.default")(function* () {
          const defaultModel = state.get().defaultModel
          if (defaultModel) {
            const model = yield* result.model.get(defaultModel.providerID, defaultModel.modelID).pipe(Effect.option)
            if (Option.isSome(model) && model.value.enabled) return model
          }

          return pipe(
            yield* result.model.available(),
            Array.sortWith((item) => item.time.released.epochMilliseconds, Order.flip(Order.Number)),
            Array.head,
          )
        }),

        small: Effect.fn("CatalogV2.model.small")(function* (providerID) {
          const record = state.get().providers.get(providerID)
          if (!record) return Option.none<ModelV2.Info>()

          if (providerID === ProviderV2.ID.opencode) {
            const gpt5Nano = record.models.get(ModelV2.ID.make("gpt-5-nano"))
            if (gpt5Nano?.enabled && gpt5Nano.status === "active") return Option.some(resolve(gpt5Nano))
          }

          const candidates = pipe(
            Array.fromIterable(record.models.values()),
            Array.filter(
              (model) =>
                model.providerID === providerID &&
                model.enabled &&
                model.status === "active" &&
                model.capabilities.input.some((item) => item.startsWith("text")) &&
                model.capabilities.output.some((item) => item.startsWith("text")),
            ),
            Array.map((model) => ({
              model,
              cost: model.cost[0] ? model.cost[0].input + model.cost[0].output : 999,
              age: (Date.now() - model.time.released.epochMilliseconds) / (1000 * 60 * 60 * 24 * 30),
              small: SMALL_MODEL_RE.test(`${model.id} ${model.family ?? ""} ${model.name}`.toLowerCase()),
            })),
            Array.filter((item) => item.cost > 0 && item.age <= 18),
          )

          const pick = (items: typeof candidates) => {
            const maxCost = Math.max(...items.map((item) => item.cost), 0.01)
            const maxAge = Math.max(...items.map((item) => item.age), 0.01)
            return pipe(
              items,
              Array.sortWith((item) => (item.cost / maxCost) * 0.8 + (item.age / maxAge) * 0.2, Order.Number),
              Array.map((item) => resolve(item.model)),
              Array.head,
            )
          }

          return pipe(
            candidates,
            Array.filter((item) => item.small),
            (items) => (items.length > 0 ? pick(items) : pick(candidates)),
          )
        }),
      },
    }

    return Service.of(result)
  }),
)

const SMALL_MODEL_RE = /\b(nano|flash|lite|mini|haiku|small|fast)\b/

export const defaultLayer = layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(PluginV2.defaultLayer),
  Layer.provide(Policy.defaultLayer),
)
