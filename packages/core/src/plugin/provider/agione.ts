import { DateTime, Effect } from "effect"
import { ModelV2 } from "../../model"
import { PluginV2 } from "../../plugin"
import { ProviderV2 } from "../../provider"

const PROVIDER_ID = ProviderV2.ID.make("agione")
const MODEL_ID = ModelV2.ID.make("deepseek/deepseek-v4-pro/d3462")
const BASE_URL = "https://agione.pro/hyperone/xapi/api/v1"
const ENV_KEY = "AGIONE_API_KEY"

export const AgionePlugin = PluginV2.define({
  id: PluginV2.ID.make("agione"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        const apiKey = process.env[ENV_KEY]

        evt.provider.update(PROVIDER_ID, (provider) => {
          provider.name = "AGIone"
          provider.env = [ENV_KEY]
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: BASE_URL,
          }
          provider.request.headers["HTTP-Referer"] ??= "https://opencode.ai/"
          provider.request.headers["X-Title"] ??= "opencode"

          if (apiKey) {
            provider.enabled = {
              via: "env",
              name: ENV_KEY,
            }
          }
        })

        evt.model.update(PROVIDER_ID, MODEL_ID, (model) => {
          model.name = "DeepSeek V4 Pro"
          model.family = ModelV2.Family.make("deepseek")
          model.api = {
            id: MODEL_ID,
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: BASE_URL,
          }
          model.capabilities = {
            tools: true,
            input: ["text"],
            output: ["text"],
          }
          model.time.released = DateTime.makeUnsafe(Date.parse("2026-01-01"))
          model.status = "active"
          model.enabled = true
          model.limit = {
            context: 128_000,
            output: 8_192,
          }
        })
      }),
    }
  }),
})
