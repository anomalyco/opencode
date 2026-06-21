import { define } from "@opencode-ai/plugin/v2/effect"
import { Effect, Stream } from "effect"
import { ModelV2 } from "../model"
import { ModelRequest } from "../model-request"
import { ModelsDev } from "../models-dev"
import { ProviderV2 } from "../provider"

function released(date: string) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? time : 0
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

function variants(model: ModelsDev.Model, packageName?: string) {
  return Object.entries(model.experimental?.modes ?? {}).map(([id, item]) => {
    const request = ModelRequest.normalizeAiSdkOptions(packageName, item.provider?.body ?? {})
    return {
      id: ModelV2.VariantID.make(id),
      headers: { ...(item.provider?.headers ?? {}) },
      ...request,
    }
  })
}

export const ModelsDevPlugin = define({
  id: "models-dev",
  effect: Effect.fn(function* (ctx) {
    const modelsDev = yield* ModelsDev.Service
    yield* ctx.integration.transform(
      Effect.fn(function* (integrations) {
        const data = yield* modelsDev.get()
        for (const item of Object.values(data)) {
          if (item.env.length === 0) continue
          const integrationID = item.id
          integrations.update(integrationID, (integration) => (integration.name = item.name))
          integrations.method.update({
            integrationID,
            method: { type: "key" },
          })
          integrations.method.update({
            integrationID,
            method: { type: "env", names: [...item.env] },
          })
        }
      }),
    )
    yield* ctx.catalog.transform(
      Effect.fn(function* (catalog) {
        const data = yield* modelsDev.get()
        for (const item of Object.values(data)) {
          const providerID = ProviderV2.ID.make(item.id)
          catalog.provider.update(providerID, (provider) => {
            provider.name = item.name
            provider.api = item.npm
              ? {
                  type: "aisdk",
                  package: item.npm,
                  url: item.api,
                }
              : {
                  type: "native",
                  url: item.api,
                  settings: {},
                }
          })

          for (const model of Object.values(item.models)) {
            const modelID = ModelV2.ID.make(model.id)
            catalog.model.update(providerID, modelID, (draft) => {
              draft.name = model.name
              draft.family = model.family ? ModelV2.Family.make(model.family) : undefined
              draft.api = model.provider?.npm
                ? {
                    id: draft.api.id,
                    type: "aisdk",
                    package: model.provider?.npm,
                    url: model.provider.api,
                  }
                : {
                    id: draft.api.id,
                    type: "native",
                    url: model.provider?.api,
                    settings: {},
                  }
              draft.capabilities = {
                tools: model.tool_call,
                input: [...(model.modalities?.input ?? [])],
                output: [...(model.modalities?.output ?? [])],
              }
              draft.variants = variants(model, model.provider?.npm ?? item.npm)
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
          }
        }
      }),
    )
    yield* ctx.event.subscribe("models-dev.refreshed").pipe(
      Stream.runForEach(() => ctx.integration.rebuild().pipe(Effect.andThen(ctx.catalog.rebuild()))),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
