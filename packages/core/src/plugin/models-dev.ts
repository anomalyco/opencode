import { DateTime, Effect, Scope, Stream } from "effect"
import { Catalog } from "../catalog"
import { Connector } from "../connector"
import { Credential } from "../credential"
import { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { ModelRequest } from "../model-request"
import { ModelsDev } from "../models-dev"
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

function variants(model: ModelsDev.Model, packageName?: string) {
  const existing = Object.entries(model.experimental?.modes ?? {}).map(([id, item]) => {
    const request = ModelRequest.normalizeAiSdkOptions(packageName, item.provider?.body ?? {})
    return variant(id, { headers: { ...(item.provider?.headers ?? {}) }, ...request })
  })
  if (existing.length > 0) return existing
  return fallbackReasoningVariants(model, packageName)
}

function variant(id: string, input: Partial<ModelRequest.Request> = {}): ModelV2.Info["variants"][number] {
  return {
    id: ModelV2.VariantID.make(id),
    headers: input.headers ?? {},
    body: input.body ?? {},
    generation: input.generation ?? {},
    options: input.options ?? {},
  }
}

function fallbackReasoningVariants(model: ModelsDev.Model, packageName?: string) {
  if (!model.reasoning) return []
  const id = model.id.toLowerCase()

  if (id.includes("gemini")) return geminiVariants(model, packageName)
  if (id.includes("claude")) return claudeVariants(model, packageName)
  if (/(?:^|[/.-])(?:gpt-|o[1-9])/.test(id)) return openaiVariants(id, packageName)
  return []
}

function openaiVariants(id: string, packageName?: string) {
  return reasoningEffortVariants(openaiEfforts(id), packageName)
}

function openaiEfforts(id: string) {
  if (/(?:^|\/)gpt-5[.-]?pro(?:[.-]|$)/.test(id)) return ["high"]
  if (/(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/.test(id)) return ["medium", "high", "xhigh"]
  const version = Number(/(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/.exec(id)?.[1]) || undefined
  if (version === 1) return ["low", "medium", "high"]
  if (version !== undefined && version >= 2) return ["low", "medium", "high", "xhigh"]
  if (id.includes("gpt-5")) return ["low", "medium", "high", "xhigh"]
  return ["low", "medium", "high"]
}

function reasoningEffortVariants(efforts: string[], packageName?: string) {
  return efforts.map((effort) => variant(effort, ModelRequest.normalizeAiSdkOptions(packageName, { reasoningEffort: effort })))
}

function geminiVariants(model: ModelsDev.Model, packageName?: string) {
  const id = model.id.toLowerCase()
  if (packageName !== "@ai-sdk/google" && packageName !== "@ai-sdk/google-vertex") {
    return reasoningEffortVariants(["low", "medium", "high"], packageName)
  }
  if (id.includes("2.5")) {
    return [
      variant("high", { body: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16_000 } } }),
      variant(
        "max",
        {
          body: {
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: id.includes("pro") && !id.includes("flash") ? 32_768 : 24_576,
            },
          },
        },
      ),
    ]
  }
  const efforts = id.includes("flash") ? ["minimal", "low", "medium", "high"] : ["low", "medium", "high"]
  return efforts.map((effort) =>
    variant(effort, { body: { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } } }),
  )
}

function claudeVariants(model: ModelsDev.Model, packageName?: string) {
  const id = model.id.toLowerCase()
  if (packageName !== "@ai-sdk/anthropic" && packageName !== "@ai-sdk/google-vertex/anthropic") {
    return reasoningEffortVariants(["low", "medium", "high"], packageName)
  }
  if (id.includes("opus-4.7") || id.includes("fable-5")) {
    return anthropicAdaptiveVariants(["low", "medium", "high", "xhigh", "max"], true)
  }
  if (["opus-4.6", "opus-4-6", "sonnet-4.6", "sonnet-4-6"].some((value) => id.includes(value))) {
    return anthropicAdaptiveVariants(["low", "medium", "high", "max"])
  }
  return [
    variant(
      "high",
      { options: { thinking: { type: "enabled", budgetTokens: Math.min(16_000, Math.floor(model.limit.output / 2 - 1)) } } },
    ),
    variant(
      "max",
      { options: { thinking: { type: "enabled", budgetTokens: Math.min(31_999, model.limit.output - 1) } } },
    ),
  ]
}

function anthropicAdaptiveVariants(efforts: string[], summarized = false) {
  return efforts.map((effort) =>
    variant(
      effort,
      {
        options: {
          thinking: { type: "adaptive", ...(summarized ? { display: "summarized" } : {}) },
          effort,
        },
      },
    ),
  )
}

export const ModelsDevPlugin = PluginV2.define({
  id: PluginV2.ID.make("models-dev"),
  effect: Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const connectors = yield* Connector.Service
    const modelsDev = yield* ModelsDev.Service
    const events = yield* EventV2.Service
    const scope = yield* Scope.Scope
    const transform = yield* catalog.transform()
    const connectorTransform = yield* connectors.transform()
    const refresh = Effect.fn("ModelsDevPlugin.refresh")(function* () {
      const data = yield* modelsDev.get()
      yield* connectorTransform((connectors) => {
        for (const item of Object.values(data)) {
          if (item.env.length === 0) continue
          const connectorID = Connector.ID.make(item.id)
          connectors.update(connectorID, (connector) => (connector.name = item.name))
          connectors.method.update({
            connectorID,
            method: new Connector.KeyMethod({
              id: Connector.MethodID.make("api-key"),
              type: "key",
              label: "API Key",
            }),
            authorize: (key: string) => Effect.succeed(new Credential.Key({ type: "key", key })),
          })
        }
      })
      yield* transform((catalog) => {
        for (const item of Object.values(data)) {
          const providerID = ProviderV2.ID.make(item.id)
          catalog.provider.update(providerID, (provider) => {
            provider.name = item.name
            provider.env = [...item.env]
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
      })
    })
    yield* refresh()
    yield* events.subscribe(ModelsDev.Event.Refreshed).pipe(
      Stream.runForEach(() => refresh()),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
