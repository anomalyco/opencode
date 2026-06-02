export * as SessionRunnerModel from "./model"

import { type Model, type ProviderOptions } from "@opencode-ai/llm"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import * as OpenAICompatibleChat from "@opencode-ai/llm/protocols/openai-compatible-chat"
import * as OpenAIResponses from "@opencode-ai/llm/protocols/openai-responses"
import { Auth, type AnyRoute } from "@opencode-ai/llm/route"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { produce } from "immer"
import { mergeJsonRecords } from "@opencode-ai/llm"
import { Catalog } from "../../catalog"
import { ModelV2 } from "../../model"
import { PluginBoot } from "../../plugin/boot"
import { ProviderV2 } from "../../provider"
import { SessionSchema } from "../schema"

export class ModelNotSelectedError extends Schema.TaggedErrorClass<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  {
    sessionID: SessionSchema.ID,
  },
) {}

export class UnsupportedEndpointError extends Schema.TaggedErrorClass<UnsupportedEndpointError>()(
  "SessionRunnerModel.UnsupportedEndpointError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    endpoint: Schema.String,
  },
) {}

export type Error = Catalog.ProviderNotFoundError | Catalog.ModelNotFoundError | ModelNotSelectedError | UnsupportedEndpointError

export interface Interface {
  readonly resolve: (session: SessionSchema.Info) => Effect.Effect<Model, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunnerModel") {}

/** Test or embedding seam for supplying a model resolver directly. */
export const layerWith = (resolve: Interface["resolve"]) => Layer.succeed(Service, Service.of({ resolve }))

const apiKey = (model: ModelV2.Info, provider?: ProviderV2.Info) => {
  const value = model.options.aisdk.provider.apiKey
  if (typeof value === "string") return Auth.value(value)
  return provider?.enabled !== false && provider?.enabled.via === "env" ? Auth.config(provider.enabled.name) : undefined
}

const nativeEndpoint = (url: string) => {
  const parsed = new URL(url)
  const path = `${parsed.pathname}${parsed.search}`
  parsed.pathname = "/"
  parsed.search = ""
  parsed.hash = ""
  return { baseURL: parsed.toString(), path }
}

const withDefaults = (model: ModelV2.Info, route: AnyRoute, optionsKey: "openai" | "anthropic") =>
  route.with({
    provider: model.providerID,
    endpoint:
      model.endpoint.type === "unknown"
        ? undefined
        : model.endpoint.type === "aisdk"
          ? { baseURL: model.endpoint.url }
          : nativeEndpoint(model.endpoint.url),
    headers: model.options.headers,
    http: { body: model.options.body },
    limits: { context: model.limit.context, output: model.limit.output },
    providerOptions: { [optionsKey]: model.options.aisdk.request } as ProviderOptions,
  })

const withVariant = (model: ModelV2.Info, variantID: ModelV2.VariantID | undefined) => {
  const id = variantID === "default" || variantID === undefined ? model.options.variant : variantID
  const variant = model.variants.find((item) => item.id === id)
  if (!variant) return model
  return produce(model, (draft) => {
    Object.assign(draft.options.headers, variant.headers)
    Object.assign(draft.options.body, variant.body)
    Object.assign(draft.options.aisdk.provider, variant.aisdk.provider)
    draft.options.aisdk.request = mergeJsonRecords(draft.options.aisdk.request, variant.aisdk.request) ?? {}
  })
}

export const fromCatalogModel = (model: ModelV2.Info, provider?: ProviderV2.Info): Effect.Effect<Model, UnsupportedEndpointError> => {
  const key = apiKey(model, provider)
  const endpoint = model.endpoint
  if (endpoint.type === "openai/responses" && endpoint.websocket) {
    return Effect.fail(
      new UnsupportedEndpointError({ providerID: model.providerID, modelID: model.id, endpoint: "openai/responses:websocket" }),
    )
  }
  if (endpoint.type === "openai/responses" || (endpoint.type === "aisdk" && endpoint.package === "@ai-sdk/openai")) {
    return Effect.succeed(
      withDefaults(model, OpenAIResponses.route, "openai")
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: model.apiID }),
    )
  }
  if (endpoint.type === "anthropic/messages" || (endpoint.type === "aisdk" && endpoint.package === "@ai-sdk/anthropic")) {
    return Effect.succeed(
      withDefaults(model, AnthropicMessages.route, "anthropic")
        .with({ auth: key === undefined ? Auth.none : Auth.header("x-api-key", key) })
        .model({ id: model.apiID }),
    )
  }
  if (endpoint.type === "openai/completions") {
    return Effect.succeed(
      withDefaults(model, model.providerID === ProviderV2.ID.openai ? OpenAIChat.route : OpenAICompatibleChat.route, "openai")
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: model.apiID }),
    )
  }
  if (endpoint.type === "aisdk" && endpoint.package === "@ai-sdk/openai-compatible" && endpoint.url) {
    return Effect.succeed(
      withDefaults(model, OpenAICompatibleChat.route, "openai")
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: model.apiID }),
    )
  }
  return Effect.fail(
    new UnsupportedEndpointError({
      providerID: model.providerID,
      modelID: model.id,
      endpoint: endpoint.type === "aisdk" ? `${endpoint.type}:${endpoint.package}` : endpoint.type,
    }),
  )
}

export const resolve = (session: SessionSchema.Info, model: ModelV2.Info, provider?: ProviderV2.Info) =>
  fromCatalogModel(withVariant(model, session.model?.variant), provider)

export const supported = (model: ModelV2.Info) => {
  const endpoint = model.endpoint
  if (endpoint.type === "openai/responses") return !endpoint.websocket
  if (endpoint.type === "openai/completions" || endpoint.type === "anthropic/messages") return true
  return endpoint.type === "aisdk" &&
    (endpoint.package === "@ai-sdk/openai" ||
      endpoint.package === "@ai-sdk/anthropic" ||
      (endpoint.package === "@ai-sdk/openai-compatible" && endpoint.url !== undefined))
}

/** Resolves models from the catalog belonging to the current Location runtime. */
export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const boot = yield* PluginBoot.Service
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session) {
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        yield* boot.wait()
        const preferred = yield* catalog.model.default()
        const selected = session.model
          ? yield* catalog.model.get(session.model.providerID, session.model.id)
          : Option.getOrUndefined(preferred.pipe(Option.filter(supported))) ?? (yield* catalog.model.available()).find(supported)
        if (!selected) return yield* new ModelNotSelectedError({ sessionID: session.id })
        return yield* resolve(session, selected, yield* catalog.provider.get(selected.providerID))
      }),
    })
  }),
)
