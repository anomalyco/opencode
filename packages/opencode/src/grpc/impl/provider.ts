import { create } from "@bufbuild/protobuf"
import type { JsonObject } from "@bufbuild/protobuf"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import {
  ProviderSchema,
  ModelSchema,
  ModelApiSchema,
  ModelCapabilitiesSchema,
  ModelCostSchema,
  ModelCostTierSchema,
  ModelLimitSchema,
  ModelModalitiesSchema,
  ListProvidersResponseSchema,
  OAuthAuthorizeResponseSchema,
  OAuthCallbackResponseSchema,
  type ListProvidersRequest,
  type GetProviderAuthRequest,
  type OAuthAuthorizeRequest,
  type OAuthCallbackRequest,
} from "../gen/opencode/v1/provider_pb"

function toProtoModel(model: Provider.Model) {
  const capabilities = create(ModelCapabilitiesSchema, {
    temperature: model.capabilities.temperature,
    reasoning: model.capabilities.reasoning,
    attachment: model.capabilities.attachment,
    toolcall: model.capabilities.toolcall,
    input: create(ModelModalitiesSchema, {
      text: model.capabilities.input.text,
      audio: model.capabilities.input.audio,
      image: model.capabilities.input.image,
      video: model.capabilities.input.video,
      pdf: model.capabilities.input.pdf,
    }),
    output: create(ModelModalitiesSchema, {
      text: model.capabilities.output.text,
      audio: model.capabilities.output.audio,
      image: model.capabilities.output.image,
      video: model.capabilities.output.video,
      pdf: model.capabilities.output.pdf,
    }),
    interleaved: typeof model.capabilities.interleaved === "boolean" ? model.capabilities.interleaved : false,
  })

  const cost = create(ModelCostSchema, {
    input: model.cost.input,
    output: model.cost.output,
    cacheRead: model.cost.cache.read,
    cacheWrite: model.cost.cache.write,
    ...(model.cost.experimentalOver200K
      ? {
          experimentalOver200k: create(ModelCostTierSchema, {
            input: model.cost.experimentalOver200K.input,
            output: model.cost.experimentalOver200K.output,
            cacheRead: model.cost.experimentalOver200K.cache.read,
            cacheWrite: model.cost.experimentalOver200K.cache.write,
          }),
        }
      : {}),
  })

  const limit = create(ModelLimitSchema, {
    context: BigInt(model.limit.context),
    output: BigInt(model.limit.output),
    ...(model.limit.input !== undefined ? { input: BigInt(model.limit.input) } : {}),
  })

  return create(ModelSchema, {
    id: model.id,
    providerId: model.providerID,
    api: create(ModelApiSchema, {
      id: model.api.id,
      url: model.api.url,
      npm: model.api.npm,
    }),
    name: model.name,
    family: model.family,
    capabilities,
    cost,
    limit,
    status: model.status,
    options: model.options as JsonObject,
    headers: model.headers,
    releaseDate: (model as any).release_date ?? "",
    variants: model.variants as JsonObject | undefined,
  })
}

function toProtoProvider(provider: Provider.Info) {
  const models: Record<string, ReturnType<typeof toProtoModel>> = {}
  for (const [id, model] of Object.entries(provider.models)) {
    models[id] = toProtoModel(model)
  }

  return create(ProviderSchema, {
    id: provider.id,
    name: provider.name,
    source: provider.source,
    env: provider.env,
    key: provider.key,
    options: provider.options as JsonObject,
    models,
  })
}

export const provider = {
  async list(_req: ListProvidersRequest) {
    const config = await Config.get()
    const disabled = new Set(config.disabled_providers ?? [])
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

    const allProviders = await ModelsDev.get()
    const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
    for (const [key, value] of Object.entries(allProviders)) {
      if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
        filteredProviders[key] = value
      }
    }

    const connected = await Provider.list()
    const providers = Object.assign(
      Object.fromEntries(
        Object.entries(filteredProviders).map(([key, value]) => [key, Provider.fromModelsDevProvider(value)]),
      ),
      connected,
    )

    const defaultModels: Record<string, string> = {}
    for (const [key, item] of Object.entries(providers)) {
      defaultModels[key] = Provider.sort(Object.values(item.models))[0].id
    }

    return create(ListProvidersResponseSchema, {
      providers: Object.values(providers).map(toProtoProvider),
      defaultModels,
      connected: Object.keys(connected),
    })
  },

  async getAuth(_req: GetProviderAuthRequest) {
    const methods = await ProviderAuth.methods()
    return {
      methods: methods as unknown as JsonObject,
    }
  },

  async oauthAuthorize(req: OAuthAuthorizeRequest) {
    const result = await ProviderAuth.authorize({
      providerID: req.providerId,
      method: req.method,
    })
    return create(OAuthAuthorizeResponseSchema, {
      url: result?.url,
      method: result?.method,
    })
  },

  async oauthCallback(req: OAuthCallbackRequest) {
    await ProviderAuth.callback({
      providerID: req.providerId,
      method: req.method,
      code: req.code,
    })
    return create(OAuthCallbackResponseSchema, { success: true })
  },
}
