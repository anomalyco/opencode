import os from "os"
import { App } from "../../app"
import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Provider } from "../../provider"

const providerID = Provider.ID.make("cloudflare-workers-ai")

export const CloudflareWorkersAIPlugin = define({
  id: "opencode.provider.cloudflare-workers-ai",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((evt) => {
      const item = evt.provider.get(providerID)
      if (!item) return
      evt.provider.update(item.provider.id, (provider) => {
        if (!Provider.isAISDK(provider.package)) return
        const baseURL = resolveBaseURL(provider.settings ?? {})
        if (baseURL) provider.settings = { ...provider.settings, baseURL }
        provider.headers = Provider.mergeHeaders(provider.headers, {
          "User-Agent": `${App.useragent(ctx.app)} cloudflare-workers-ai (${os.platform()} ${os.release()}; ${os.arch()})`,
        })
      })
    })
    yield* ctx.provider.hook(
      "resolve",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        const baseURL = resolveBaseURL(evt.settings)
        if (baseURL) evt.settings.baseURL = baseURL
      }),
    )
  }),
})

function resolveBaseURL(options: Record<string, unknown>) {
  const baseURL = stringOption(options, "baseURL")
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? stringOption(options, "accountId")
  if (!accountId) return baseURL
  if (baseURL) return baseURL.replaceAll("${CLOUDFLARE_ACCOUNT_ID}", encodeURIComponent(accountId))
  return workersEndpoint(accountId)
}

function workersEndpoint(accountId: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`
}

function stringOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "string" ? options[key] : undefined
}
