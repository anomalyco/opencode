import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

function selectLanguage(sdk: any, modelID: string, useChat: boolean) {
  if (useChat && sdk.chat) return sdk.chat(modelID)
  if (sdk.responses) return sdk.responses(modelID)
  if (sdk.messages) return sdk.messages(modelID)
  if (sdk.chat) return sdk.chat(modelID)
  return sdk.languageModel(modelID)
}

export const AzurePlugin = PluginV2.define({
  id: PluginV2.ID.make("azure"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== ProviderV2.ID.azure) return
        const configured = evt.provider.options.aisdk.provider.resourceName
        const resourceName =
          typeof configured === "string" && configured.trim() !== "" ? configured : process.env.AZURE_RESOURCE_NAME
        if (resourceName) evt.provider.options.aisdk.provider.resourceName = resourceName
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/azure") return
        if (evt.model.providerID === ProviderV2.ID.azure) {
          if (
            !evt.options.resourceName &&
            !evt.options.baseURL &&
            (evt.model.endpoint.type !== "aisdk" || !evt.model.endpoint.url)
          ) {
            throw new Error(
              "AZURE_RESOURCE_NAME is missing, set it using env var or reconnecting the azure provider and setting it",
            )
          }
        }
        const mod = yield* Effect.promise(() => import("@ai-sdk/azure"))
        evt.sdk = mod.createAzure(evt.options)
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.azure) return
        evt.language = selectLanguage(evt.sdk, evt.model.apiID, Boolean(evt.options.useCompletionUrls))
      }),
    }
  }),
})

export const AzureCognitiveServicesPlugin = PluginV2.define({
  id: PluginV2.ID.make("azure-cognitive-services"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== ProviderV2.ID.make("azure-cognitive-services")) return
        const resourceName = process.env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
        if (resourceName)
          evt.provider.options.aisdk.provider.baseURL = `https://${resourceName}.cognitiveservices.azure.com/openai`
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== ProviderV2.ID.make("azure-cognitive-services")) return
        evt.language = selectLanguage(evt.sdk, evt.model.apiID, Boolean(evt.options.useCompletionUrls))
      }),
    }
  }),
})
