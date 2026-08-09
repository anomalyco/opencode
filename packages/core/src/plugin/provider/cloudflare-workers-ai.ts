import os from "os"
import { App } from "../../app"
import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Form } from "@opencode-ai/schema/form"
import { Provider } from "../../provider"
import { iife } from "../../util/iife"
import { configuredSettings } from "./configured"

const providerID = Provider.ID.make("cloudflare-workers-ai")

export const CloudflareWorkersAIPlugin = define({
  id: "opencode.provider.cloudflare-workers-ai",
  effect: Effect.fn(function* (ctx) {
    const configured = yield* configuredSettings(providerID)
    const form = iife(() => {
      if (typeof configured?.baseURL === "string" || resolveAccountId(configured ?? {})) return
      return Form.Fields.make([
        {
          type: "string",
          key: "accountId",
          title: "Enter your Cloudflare Account ID",
          placeholder: "e.g. 1234567890abcdef1234567890abcdef",
          required: true,
        },
      ])
    })
    yield* ctx.integration.transform((draft) => {
      draft.method.update({
        integrationID: providerID,
        method: {
          type: "key",
          label: "API key",
          form,
        },
      })
    })
    yield* ctx.catalog.transform((evt) => {
      const item = evt.provider.get(providerID)
      if (!item) return
      evt.provider.update(item.provider.id, (provider) => {
        if (!Provider.isAISDK(provider.package)) return
        if (typeof provider.settings?.baseURL === "string") return
        const accountId = resolveAccountId(provider.settings ?? {})
        if (accountId) provider.settings = { ...provider.settings, baseURL: workersEndpoint(accountId) }
      })
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        if (evt.package !== "@ai-sdk/openai-compatible") return

        const accountId = resolveAccountId(evt.options)
        if (!hasWorkersEndpoint(evt.model) && !accountId) return
        const mod = yield* Effect.promise(() => import("@ai-sdk/openai-compatible"))
        evt.sdk = mod.createOpenAICompatible(
          sdkOptions(
            {
              ...evt.options,
              baseURL: evt.options.baseURL ?? (accountId ? workersEndpoint(accountId) : undefined),
            },
            ctx.app,
          ) as any,
        )
      }),
    )
    yield* ctx.aisdk.hook(
      "language",
      Effect.fn(function* (evt) {
        if (evt.model.providerID !== providerID) return
        evt.language = evt.sdk.languageModel(evt.model.modelID ?? evt.model.id)
      }),
    )
  }),
})

function resolveAccountId(options: Record<string, unknown>) {
  return process.env.CLOUDFLARE_ACCOUNT_ID ?? stringOption(options, "accountId")
}

function workersEndpoint(accountId: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
}

function hasWorkersEndpoint(model: {
  readonly package?: string
  readonly settings?: Readonly<Record<string, unknown>>
}) {
  return Provider.isAISDK(model.package) && typeof model.settings?.baseURL === "string"
}

function sdkOptions(options: Record<string, any>, app: App.Info) {
  return {
    ...options,
    baseURL: expandAccountId(options.baseURL),
    apiKey: process.env.CLOUDFLARE_API_KEY ?? options.apiKey,
    headers: {
      "User-Agent": `${App.useragent(app)} cloudflare-workers-ai (${os.platform()} ${os.release()}; ${os.arch()})`,
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
