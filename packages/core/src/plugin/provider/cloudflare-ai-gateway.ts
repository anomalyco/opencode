import { Effect } from "effect"
import { isArrayNonEmpty } from "effect/Array"
import { define } from "@opencode/plugin/effect/plugin"
import { Form } from "@opencode/schema/form"
import { Provider } from "../../provider.js"
import { configuredSettings } from "./configured.js"

const providerID = Provider.ID.make("cloudflare-ai-gateway")

const accountIdField = Form.StringField.make({
  type: "string",
  key: "accountId",
  title: "Enter your Cloudflare Account ID",
  placeholder: "e.g. 1234567890abcdef1234567890abcdef",
  required: true,
})

const gatewayIdField = Form.StringField.make({
  type: "string",
  key: "gatewayId",
  title: "Enter your Cloudflare AI Gateway ID",
  placeholder: "e.g. my-gateway",
  required: true,
})

export const CloudflareAIGatewayPlugin = define({
  id: "opencode.provider.cloudflare.ai.gateway",
  effect: Effect.fn(function* (ctx) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const gatewayId = process.env.CLOUDFLARE_GATEWAY_ID
    const configured = yield* configuredSettings(providerID)
    const fields =
      typeof configured?.baseURL === "string"
        ? []
        : [
            ...(accountId || typeof configured?.accountId === "string" ? [] : [accountIdField]),
            ...(gatewayId || typeof configured?.gatewayId === "string" ? [] : [gatewayIdField]),
          ]
    yield* ctx.integration.transform((editor) => {
      editor.method.update({
        integrationID: providerID,
        method: {
          type: "key",
          label: "Gateway API token",
          form: isArrayNonEmpty(fields) ? Form.Fields.make(fields) : undefined,
        },
      })
    })
    yield* ctx.provider.transform((evt) => {
      const item = evt.get(providerID)
      if (!item || (!accountId && !gatewayId)) return
      evt.update(item.provider.id, (provider) => {
        if (typeof provider.settings?.baseURL === "string") return
        provider.settings = {
          ...(accountId ? { accountId } : {}),
          ...(gatewayId ? { gatewayId } : {}),
          ...provider.settings,
        }
      })
    })
  }),
})
