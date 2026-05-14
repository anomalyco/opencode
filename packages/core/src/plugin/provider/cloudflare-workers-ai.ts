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
      "provider.update": Effect.fn(function* (evt) {
        if (evt.provider.id !== providerID) return
        if (evt.provider.endpoint.type !== "aisdk") return
        if (evt.provider.endpoint.url) return

        const accountId = resolveAccountId(evt.provider.options.aisdk.provider)
        if (accountId) evt.provider.endpoint.url = workersEndpoint(accountId)
      }),
      "aisdk.sdk": Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        if (evt.package !== "@ai-sdk/openai-compatible") return

        if (!hasWorkersEndpoint(evt.model.endpoint)) return
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible(sdkOptions(evt.options) as any)
      }),
      "aisdk.language": Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        evt.language = evt.sdk.languageModel(evt.model.apiID)
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

function hasWorkersEndpoint(endpoint: ProviderV2.Endpoint) {
  return endpoint.type === "aisdk" && Boolean(endpoint.url)
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
