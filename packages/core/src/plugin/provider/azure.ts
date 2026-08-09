import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Form } from "@opencode-ai/schema/form"
import { Provider } from "../../provider"
import { iife } from "../../util/iife"
import { configuredSettings } from "./configured"

function selectLanguage(sdk: any, modelID: string, useChat: boolean) {
  if (useChat && sdk.chat) return sdk.chat(modelID)
  if (sdk.responses) return sdk.responses(modelID)
  if (sdk.messages) return sdk.messages(modelID)
  if (sdk.chat) return sdk.chat(modelID)
  return sdk.languageModel(modelID)
}

export const AzurePlugin = define({
  id: "opencode.provider.azure",
  effect: Effect.fn(function* (ctx) {
    const configured = yield* configuredSettings(Provider.ID.azure)
    const form = iife(() => {
      if (resolveResourceName(configured) || typeof configured?.baseURL === "string") return
      return Form.Fields.make([
        {
          type: "string",
          key: "resourceName",
          title: "Enter Azure Resource Name",
          placeholder: "e.g. my-models",
          required: true,
        },
      ])
    })
    yield* ctx.integration.transform((draft) => {
      draft.method.update({
        integrationID: Provider.ID.azure,
        method: {
          type: "key",
          label: "API key",
          form,
        },
      })
    })
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (item.provider.id !== Provider.ID.azure && Provider.packageName(item.provider.package) !== "@ai-sdk/azure")
          continue
        const resourceName = resolveResourceName(item.provider.settings)
        if (!resourceName) continue
        evt.provider.update(item.provider.id, (provider) => {
          provider.settings = {
            ...provider.settings,
            resourceName,
            ...(typeof provider.settings?.baseURL === "string"
              ? { baseURL: expandResourceName(provider.settings.baseURL, resourceName) }
              : {}),
          }
        })
        for (const model of item.models.values()) {
          evt.model.update(item.provider.id, model.id, (draft) => {
            if (typeof draft.settings?.baseURL !== "string") return
            draft.settings.baseURL = expandResourceName(
              draft.settings.baseURL,
              resolveResourceName(draft.settings, resourceName) ?? resourceName,
            )
          })
        }
      }
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "@ai-sdk/azure") return
        if (evt.model.providerID === Provider.ID.azure) {
          if (
            !evt.options.resourceName &&
            !evt.options.baseURL &&
            (!Provider.isAISDK(evt.model.package) || typeof evt.model.settings?.baseURL !== "string")
          ) {
            throw new Error("Azure resource name is missing; set AZURE_RESOURCE_NAME or configure resourceName/baseURL")
          }
        }
        const mod = yield* Effect.promise(() => import("@ai-sdk/azure"))
        evt.sdk = mod.createAzure(evt.options)
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== Provider.ID.azure) return
        evt.language = selectLanguage(
          evt.sdk,
          evt.model.modelID ?? evt.model.id,
          Boolean(evt.options.useCompletionUrls),
        )
      }),
    )
  }),
})

function resolveResourceName(settings: Readonly<Record<string, unknown>> | undefined, fallback?: string) {
  const configured = settings?.resourceName
  if (typeof configured === "string" && configured.trim() !== "") return configured
  return fallback ?? process.env.AZURE_RESOURCE_NAME ?? process.env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
}

function expandResourceName(baseURL: string, resourceName: string) {
  return baseURL
    .replaceAll("${AZURE_RESOURCE_NAME}", resourceName)
    .replaceAll("${AZURE_COGNITIVE_SERVICES_RESOURCE_NAME}", resourceName)
}
