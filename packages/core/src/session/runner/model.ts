export * as SessionRunnerModel from "./model"

import { type Model } from "@opencode-ai/llm"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
import * as OpenAICompatibleChat from "@opencode-ai/llm/protocols/openai-compatible-chat"
import * as OpenAIResponses from "@opencode-ai/llm/protocols/openai-responses"
import { Auth, type AnyRoute } from "@opencode-ai/llm/route"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { produce } from "immer"
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

export class UnsupportedApiError extends Schema.TaggedErrorClass<UnsupportedApiError>()(
  "SessionRunnerModel.UnsupportedApiError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    api: Schema.String,
  },
) {}

export type Error =
  | Catalog.ProviderNotFoundError
  | Catalog.ModelNotFoundError
  | ModelNotSelectedError
  | UnsupportedApiError

export interface Interface {
  readonly resolve: (session: SessionSchema.Info) => Effect.Effect<Model, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunnerModel") {}

/** Test or embedding seam for supplying a model resolver directly. */
export const layerWith = (resolve: Interface["resolve"]) => Layer.succeed(Service, Service.of({ resolve }))

const apiKey = (model: ModelV2.Info, provider?: ProviderV2.Info) => {
  const value = model.request.body.apiKey ?? model.api.settings?.apiKey
  if (typeof value === "string") return Auth.value(value)
  return provider?.enabled !== false && provider?.enabled.via === "env" ? Auth.config(provider.enabled.name) : undefined
}

const withDefaults = (model: ModelV2.Info, route: AnyRoute) =>
  route.with({
    provider: model.providerID,
    endpoint: model.api.url === undefined ? undefined : { baseURL: model.api.url },
    headers: model.request.headers,
    http: {
      body: Object.fromEntries(Object.entries(model.request.body).filter(([key]) => key !== "apiKey")),
    },
    limits: { context: model.limit.context, output: model.limit.output },
  })

const withVariant = (model: ModelV2.Info, variantID: ModelV2.VariantID | undefined) => {
  const id = variantID === "default" || variantID === undefined ? model.request.variant : variantID
  const variant = model.variants.find((item) => item.id === id)
  if (!variant) return model
  return produce(model, (draft) => {
    Object.assign(draft.request.headers, variant.headers)
    Object.assign(draft.request.body, variant.body)
  })
}

const apiName = (model: ModelV2.Info) =>
  model.api.type === "aisdk" ? `${model.api.type}:${model.api.package}` : model.api.type

export const fromCatalogModel = (
  model: ModelV2.Info,
  provider?: ProviderV2.Info,
): Effect.Effect<Model, UnsupportedApiError> => {
  const key = apiKey(model, provider)
  if (model.api.type === "aisdk" && model.api.package === "@ai-sdk/openai") {
    return Effect.succeed(
      withDefaults(model, OpenAIResponses.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: model.api.id }),
    )
  }
  if (model.api.type === "aisdk" && model.api.package === "@ai-sdk/anthropic") {
    return Effect.succeed(
      withDefaults(model, AnthropicMessages.route)
        .with({ auth: key === undefined ? Auth.none : Auth.header("x-api-key", key) })
        .model({ id: model.api.id }),
    )
  }
  if (model.api.type === "aisdk" && model.api.package === "@ai-sdk/openai-compatible" && model.api.url) {
    return Effect.succeed(
      withDefaults(model, OpenAICompatibleChat.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: model.api.id }),
    )
  }
  return Effect.fail(
    new UnsupportedApiError({
      providerID: model.providerID,
      modelID: model.id,
      api: apiName(model),
    }),
  )
}

export const resolve = (session: SessionSchema.Info, model: ModelV2.Info, provider?: ProviderV2.Info) =>
  fromCatalogModel(withVariant(model, session.model?.variant), provider)

export const supported = (model: ModelV2.Info) =>
  model.api.type === "aisdk" &&
  (model.api.package === "@ai-sdk/openai" ||
    model.api.package === "@ai-sdk/anthropic" ||
    (model.api.package === "@ai-sdk/openai-compatible" && model.api.url !== undefined))

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
          : (Option.getOrUndefined(preferred.pipe(Option.filter(supported))) ??
            (yield* catalog.model.available()).find(supported))
        if (!selected) return yield* new ModelNotSelectedError({ sessionID: session.id })
        return yield* resolve(session, selected, yield* catalog.provider.get(selected.providerID))
      }),
    })
  }),
)
