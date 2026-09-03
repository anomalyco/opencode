import os from "os"
import { App } from "../../app.js"
import { Effect, Option, Schema } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Form } from "@opencode-ai/schema/form"
import { Provider } from "../../provider.js"
import { iife } from "../../util/iife.js"
import { configuredSettings } from "./configured.js"

const providerID = Provider.ID.make("cloudflare-ai-gateway")

export const CloudflareAIGatewayPlugin = define({
  id: "opencode.provider.cloudflare.ai.gateway",
  effect: Effect.fn(function* (ctx) {
    const configured = yield* configuredSettings(providerID)
    const form = iife(() => {
      if (typeof configured?.baseURL === "string") return
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || stringOption(configured ?? {}, "accountId")
      const gatewayId =
        process.env.CLOUDFLARE_GATEWAY_ID ||
        stringOption(configured ?? {}, "gatewayId") ||
        stringOption(configured ?? {}, "gateway")
      if (accountId && gatewayId) return
      const accountIdForm = Form.StringField.make({
        type: "string",
        key: "accountId",
        title: "Enter your Cloudflare Account ID",
        placeholder: "e.g. 1234567890abcdef1234567890abcdef",
        required: true,
      })
      const gatewayIdForm = Form.StringField.make({
        type: "string",
        key: "gatewayId",
        title: "Enter your Cloudflare AI Gateway ID",
        placeholder: "e.g. my-gateway",
        required: true,
      })
      if (accountId) return Form.Fields.make([gatewayIdForm])
      if (gatewayId) return Form.Fields.make([accountIdForm])
      return Form.Fields.make([accountIdForm, gatewayIdForm])
    })
    yield* ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: providerID,
        method: {
          type: "key",
          label: "Gateway API token",
          form,
        },
      })
    })
    yield* ctx.aisdk.hook(
      "sdk",
      Effect.fn(function* (evt) {
        if (evt.package !== "ai-gateway-provider") return
        if (evt.options.baseURL) return

        const config = gatewayConfig(evt.options)
        if (!config) return
        const metadata = gatewayMetadata(evt.options)
        const { createAiGateway } = yield* Effect.promise(() => import("ai-gateway-provider"))
        const { createUnified } = yield* Effect.promise(() => import("ai-gateway-provider/providers/unified"))
        const gateway = createAiGateway({
          accountId: config.accountId,
          gateway: config.gatewayId,
          apiKey: config.apiKey,
          options: gatewayOptions(evt.options, metadata, ctx.app),
        } as any)
        const unified = createUnified({ apiKey: config.apiKey })
        evt.sdk = {
          languageModel(modelID: string) {
            return gateway(unified(modelID))
          },
        }
      }),
    )
  }),
})

type GatewayConfig = {
  accountId: string
  gatewayId: string
  apiKey: string
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

function gatewayConfig(options: Record<string, unknown>): GatewayConfig | undefined {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? stringOption(options, "accountId")
  // Credential projection copies key metadata into options. The form stores the
  // gateway as gatewayId, while older config examples may use gateway.
  const gatewayId =
    process.env.CLOUDFLARE_GATEWAY_ID ?? stringOption(options, "gatewayId") ?? stringOption(options, "gateway")
  const apiKey = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_AIG_TOKEN ?? stringOption(options, "apiKey")
  if (!accountId || !gatewayId || !apiKey) return undefined

  return { accountId, gatewayId, apiKey }
}

function gatewayMetadata(options: Record<string, unknown>) {
  // Preserve the legacy cf-aig-metadata header escape hatch for gateway logging
  // metadata, but prefer the typed metadata option when present.
  if (options.metadata !== undefined) return options.metadata
  const raw = (options.headers as Record<string, string> | undefined)?.["cf-aig-metadata"]
  return raw ? Option.getOrUndefined(decodeJson(raw)) : undefined
}

function gatewayOptions(options: Record<string, unknown>, metadata: unknown, app: App.Info) {
  return {
    metadata,
    cacheTtl: options.cacheTtl,
    cacheKey: options.cacheKey,
    skipCache: options.skipCache,
    collectLog: options.collectLog,
    headers: {
      "User-Agent": `${App.useragent(app)} cloudflare-ai-gateway (${os.platform()} ${os.release()}; ${os.arch()})`,
    },
  }
}

function stringOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "string" ? options[key] : undefined
}
