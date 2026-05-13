import { DateTime, Effect } from "effect"
import { Catalog } from "../catalog"
import { ModelV2 } from "../model"
import { ModelsDev } from "../models"
import { PluginV2 } from "../plugin"
import { ProviderV2 } from "../provider"

function released(date: string) {
  const time = Date.parse(date)
  return DateTime.makeUnsafe(Number.isFinite(time) ? time : 0)
}

function cost(input: ModelsDev.Model["cost"]) {
  const base = {
    input: input?.input ?? 0,
    output: input?.output ?? 0,
    cache: {
      read: input?.cache_read ?? 0,
      write: input?.cache_write ?? 0,
    },
  }
  if (!input?.context_over_200k) return [base]
  return [
    base,
    {
      tier: {
        type: "context" as const,
        size: 200_000,
      },
      input: input.context_over_200k.input,
      output: input.context_over_200k.output,
      cache: {
        read: input.context_over_200k.cache_read ?? 0,
        write: input.context_over_200k.cache_write ?? 0,
      },
    },
  ]
}

function variants(model: ModelsDev.Model) {
  return Object.entries(model.experimental?.modes ?? {}).map(([id, item]) => ({
    id: ModelV2.VariantID.make(id),
    headers: { ...(item.provider?.headers ?? {}) },
    body: { ...(item.provider?.body ?? {}) },
    aisdk: {
      provider: {},
      request: {},
    },
  }))
}

export const ModelsDevPlugin = PluginV2.define({
  id: PluginV2.ID.make("models-dev"),
  effect: Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const modelsDev = yield* ModelsDev.Service
    for (const item of Object.values(yield* modelsDev.get())) {
      const providerID = ProviderV2.ID.make(item.id)
      yield* catalog.provider.update(providerID, (provider) => {
        provider.name = item.name
        provider.env = [...item.env]
        provider.endpoint = item.npm
          ? {
              type: "aisdk",
              package: item.npm,
              url: item.api,
            }
          : {
              type: "unknown",
            }
      })

      for (const model of Object.values(item.models)) {
        const modelID = ModelV2.ID.make(model.id)
        yield* catalog.model
          .update(providerID, modelID, (draft) => {
            draft.name = model.name
            draft.family = model.family ? ModelV2.Family.make(model.family) : undefined
            draft.endpoint = model.provider?.npm
              ? {
                  type: "aisdk",
                  package: model.provider?.npm,
                  url: model.provider.api,
                }
              : {
                  type: "unknown",
                }
            draft.capabilities = {
              tools: model.tool_call,
              input: [...(model.modalities?.input ?? [])],
              output: [...(model.modalities?.output ?? [])],
            }
            draft.variants = variants(model)
            draft.time.released = released(model.release_date)
            draft.cost = cost(model.cost)
            draft.status = model.status ?? "active"
            draft.enabled = true
            draft.limit = {
              context: model.limit.context,
              input: model.limit.input,
              output: model.limit.output,
            }
          })
          .pipe(Effect.orDie)
      }
    }
  }).pipe(Effect.provide(ModelsDev.defaultLayer)),
})
