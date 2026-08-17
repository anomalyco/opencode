import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Form } from "@opencode-ai/schema/form"
import { Provider } from "../../provider.js"
import { iife } from "../../util/iife.js"
import { configuredSettings } from "./configured.js"

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
  }),
})

function resolveAccountId(options: Record<string, unknown>) {
  return process.env.CLOUDFLARE_ACCOUNT_ID ?? stringOption(options, "accountId")
}

function workersEndpoint(accountId: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
}

function stringOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "string" ? options[key] : undefined
}
