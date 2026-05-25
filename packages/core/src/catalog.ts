export * as Catalog from "./catalog"

import { Context, Effect, HashMap, Layer, Option, Order, pipe, Schema, Array, Scope, Stream } from "effect"
import { produce, type Draft } from "immer"
import { ModelV2 } from "./model"
import { PluginV2 } from "./plugin"
import { ProviderV2 } from "./provider"
import { Location } from "./location"
import { EventV2 } from "./event"

export type ProviderRecord = {
  provider: ProviderV2.Info
  models: Map<ModelV2.ID, ModelV2.Info>
}

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

export const Event = {
  ModelUpdated: EventV2.define({
    type: "catalog.model.updated",
    schema: {
      model: ModelV2.Info,
    },
  }),
}

export type Context = {
  data: readonly ProviderRecord[]
  updateProvider: (providerID: ProviderV2.ID, fn: (provider: Draft<ProviderV2.Info>) => void) => void
  updateModel: (providerID: ProviderV2.ID, modelID: ModelV2.ID, fn: (model: Draft<ModelV2.Info>) => void) => void
  provider: {
    update: (providerID: ProviderV2.ID, fn: (provider: Draft<ProviderV2.Info>) => void) => void
    remove: (providerID: ProviderV2.ID) => void
  }
  model: {
    update: (providerID: ProviderV2.ID, modelID: ModelV2.ID, fn: (model: Draft<ModelV2.Info>) => void) => void
    remove: (providerID: ProviderV2.ID, modelID: ModelV2.ID) => void
  }
}

export type Loader = (update: (ctx: Context) => void) => Effect.Effect<void>

export interface Interface {
  readonly loader: () => Effect.Effect<Loader, never, Scope.Scope>
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
    readonly setDefault: (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
    ) => Effect.Effect<void, ProviderNotFoundError | ModelNotFoundError>
    readonly small: (providerID: ProviderV2.ID) => Effect.Effect<Option.Option<ModelV2.Info>>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Catalog") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    yield* Location.Service
    let records = HashMap.empty<ProviderV2.ID, ProviderRecord>()
    let loaders: { update: (ctx: Context) => void }[] = []
    let defaultModel: { providerID: ProviderV2.ID; modelID: ModelV2.ID } | undefined
    const plugin = yield* PluginV2.Service
    const events = yield* EventV2.Service
    const scope = yield* Scope.Scope

    const resolve = (model: ModelV2.Info) => {
      const provider = Option.getOrThrow(HashMap.get(records, model.providerID)).provider
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
      const match = HashMap.get(records, providerID)
      if (!match.valueOrUndefined) return yield* new ProviderNotFoundError({ providerID })
      return match.value
    }

    const normalizeEndpoint = (item: Draft<ProviderV2.Info> | Draft<ModelV2.Info>) => {
      if (item.endpoint.type !== "aisdk" || typeof item.options.aisdk.provider.baseURL !== "string") return
      item.endpoint.url = item.options.aisdk.provider.baseURL
      delete item.options.aisdk.provider.baseURL
    }

    const clone = (input: HashMap.HashMap<ProviderV2.ID, ProviderRecord>) =>
      HashMap.fromIterable(
        HashMap.toEntries(input).map(([key, value]) => [key, { ...value, models: new Map(value.models) }] as const),
      )

    const context = (draft: {
      records: HashMap.HashMap<ProviderV2.ID, ProviderRecord>
      data: ProviderRecord[]
    }): Context => {
      const result: Context = {
        data: draft.data,
        updateProvider: (providerID, fn) => result.provider.update(providerID, fn),
        updateModel: (providerID, modelID, fn) => result.model.update(providerID, modelID, fn),
        provider: {
          update: (providerID, fn) => {
            const current = Option.getOrUndefined(HashMap.get(draft.records, providerID))
            const provider = produce(current?.provider ?? ProviderV2.Info.empty(providerID), (draft) => {
              fn(draft)
              normalizeEndpoint(draft)
            })
            const next = {
              provider,
              models: current?.models ?? new Map<ModelV2.ID, ModelV2.Info>(),
            }
            draft.records = HashMap.set(draft.records, providerID, next)
            const index = draft.data.findIndex((item) => item.provider.id === providerID)
            if (index === -1) draft.data.push(next)
            else draft.data[index] = next
          },
          remove: (providerID) => {
            draft.records = HashMap.remove(draft.records, providerID)
            const index = draft.data.findIndex((item) => item.provider.id === providerID)
            if (index !== -1) draft.data.splice(index, 1)
          },
        },
        model: {
          update: (providerID, modelID, fn) => {
            const current = Option.getOrThrow(HashMap.get(draft.records, providerID))
            const model = produce(current.models.get(modelID) ?? ModelV2.Info.empty(providerID, modelID), (draft) => {
              fn(draft)
              normalizeEndpoint(draft)
            })
            const next = {
              provider: current.provider,
              models: new Map(current.models).set(modelID, new ModelV2.Info({ ...model, id: modelID, providerID })),
            }
            draft.records = HashMap.set(draft.records, providerID, next)
            const index = draft.data.findIndex((item) => item.provider.id === providerID)
            if (index === -1) draft.data.push(next)
            else draft.data[index] = next
          },
          remove: (providerID, modelID) => {
            const current = Option.getOrUndefined(HashMap.get(draft.records, providerID))
            if (!current) return
            const next = {
              provider: current.provider,
              models: new Map(current.models),
            }
            next.models.delete(modelID)
            draft.records = HashMap.set(draft.records, providerID, next)
            const index = draft.data.findIndex((item) => item.provider.id === providerID)
            if (index !== -1) draft.data[index] = next
          },
        },
      }
      return result
    }

    const transform = Effect.fn("CatalogV2.transform")(function* () {
      const draft = { records: clone(records), data: HashMap.toValues(records) }
      yield* plugin.trigger("catalog.transform", context(draft), {})
      records = draft.records
    })

    const rebuild = Effect.fn("CatalogV2.rebuild")(function* () {
      const draft = { records: HashMap.empty<ProviderV2.ID, ProviderRecord>(), data: [] as ProviderRecord[] }
      for (const loader of loaders) loader.update(context(draft))
      yield* plugin.trigger("catalog.transform", context(draft), {})
      records = draft.records
    })

    yield* plugin.added().pipe(
      Stream.runForEach((id) =>
        Effect.gen(function* () {
          const draft = { records: clone(records), data: HashMap.toValues(records) }
          yield* plugin.triggerFor(id, "catalog.transform", context(draft), {})
          records = draft.records
        }),
      ),
      Effect.forkIn(scope, { startImmediately: true }),
    )

    const result: Interface = {
      loader: Effect.fn("CatalogV2.loader")(function* () {
        const loader = { update: (_ctx: Context) => {} }
        loaders = [...loaders, loader]
        const scope = yield* Scope.Scope
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => {
            loaders = loaders.filter((item) => item !== loader)
          }).pipe(Effect.andThen(rebuild())),
        )
        return Effect.fnUntraced(function* (update) {
          loader.update = update
          yield* rebuild()
        })
      }),

      provider: {
        get: Effect.fn("CatalogV2.provider.get")(function* (providerID) {
          const record = yield* getRecord(providerID)
          return record.provider
        }),

        all: Effect.fn("CatalogV2.provider.all")(function* () {
          return globalThis.Array.from(HashMap.values(records)).map((record) => record.provider)
        }),

        available: Effect.fn("CatalogV2.provider.available")(function* () {
          return globalThis.Array.from(HashMap.values(records))
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
            records,
            HashMap.toValues,
            Array.flatMap((record) => globalThis.Array.from(record.models.values())),
            Array.map(resolve),
            Array.sortWith((item) => item.time.released.epochMilliseconds, Order.flip(Order.Number)),
          )
        }),

        available: Effect.fn("CatalogV2.model.available")(function* () {
          return (yield* result.model.all()).filter((model) => {
            const record = Option.getOrUndefined(HashMap.get(records, model.providerID))
            return record?.provider.enabled !== false && model.enabled
          })
        }),

        default: Effect.fn("CatalogV2.model.default")(function* () {
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

        setDefault: Effect.fn("CatalogV2.model.setDefault")(function* (providerID, modelID) {
          yield* result.model.get(providerID, modelID)
          defaultModel = { providerID, modelID }
        }),

        small: Effect.fn("CatalogV2.model.small")(function* (providerID) {
          const record = Option.getOrUndefined(HashMap.get(records, providerID))
          if (!record) return Option.none<ModelV2.Info>()

          if (providerID === ProviderV2.ID.opencode) {
            const gpt5Nano = record.models.get(ModelV2.ID.make("gpt-5-nano"))
            if (gpt5Nano?.enabled && gpt5Nano.status === "active") return Option.some(resolve(gpt5Nano))
          }

          const candidates = pipe(
            globalThis.Array.from(record.models.values()),
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

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(PluginV2.defaultLayer))
