import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Form } from "@opencode/schema/form"
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
  }),
})

function stringOption(options: Record<string, unknown>, key: string) {
  return typeof options[key] === "string" ? options[key] : undefined
}
