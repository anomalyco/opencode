import os from "os"
import { InstallationVersion } from "../../installation/version"
import { Effect } from "effect"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

const providerID = ProviderV2.ID.make("cloudflare-workers-ai")

export const CloudflareWorkersAIPlugin = PluginV2.define({
  id: PluginV2.ID.make("cloudflare-workers-ai"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        const item = evt.provider.get(providerID)
        if (!item) return
        evt.provider.update(item.provider.id, (provider) => {
          if (provider.api.type !== "aisdk") return
          if (provider.api.url) return
          const accountId = resolveAccountId(provider.request.body)
          if (accountId) provider.api.url = workersEndpoint(accountId)
        })
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        if (evt.package !== "@ai-sdk/openai-compatible") return

        const accountId = resolveAccountId(evt.options)
        if (!hasWorkersEndpoint(evt.model.api) && !accountId) return
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible(
          sdkOptions({
            ...evt.options,
            baseURL: evt.options.baseURL ?? (accountId ? workersEndpoint(accountId) : undefined),
          }) as any,
        )
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        evt.language = evt.sdk.languageModel(evt.model.api.id)
      }),
    }
  }),
})

function resolveAccountId(options: Record<string, unknown>) {
  return process.env.CLOUDFLARE_ACCOUNT_ID ?? stringOption(options, "accountId")
}

function workersEndpoint(accountId: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
}

function hasWorkersEndpoint(api: ProviderV2.Api) {
  return api.type === "aisdk" && Boolean(api.url)
}

function sdkOptions(options: Record<string, any>) {
  return {
    ...options,
    baseURL: expandAccountId(options.baseURL),
    apiKey: process.env.CLOUDFLARE_API_KEY ?? options.apiKey,
    headers: {
      "User-Agent": `opencode/${InstallationVersion} cloudflare-workers-ai (${os.platform()} ${os.release()}; ${os.arch()})`,
      ...options.headers,
    },
    name: providerID,
  }
}

function expandAccountId(baseURL: unknown) {
  if (typeof baseURL !== "string") return baseURL
  return baseURL.replaceAll("${CLOUDFLARE_ACCOUNT_ID}", process.env.CLOUDFLARE_ACCOUNT_ID ?? "${CLOUDFLARE_ACCOUNT_ID}")
}

function stringOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "string" ? options[key] : undefined
}
