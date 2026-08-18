import type { ZenData } from "@opencode-ai/console-core/model.js"

const npmByFormat: Record<ZenData.Format, string> = {
  anthropic: "@ai-sdk/anthropic",
  google: "@ai-sdk/google",
  openai: "@ai-sdk/openai",
  "oa-compat": "@ai-sdk/openai-compatible",
}

type CatalogModel = ReturnType<typeof ZenData.list>["models"][string]
type CatalogProviders = ReturnType<typeof ZenData.list>["providers"]

export async function buildOptionsResponse() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}

export function getNpm(model: CatalogModel, providers: CatalogProviders) {
  const format = Array.isArray(model)
    ? model[0]?.formatFilter
    : model.providers
        .map((provider) => providers[provider.id]?.format)
        .find((format): format is ZenData.Format => format !== undefined)

  return npmByFormat[format ?? "oa-compat"]
}

export async function buildModelsResponse(models: { id: string; npm: string }[]) {
  return new Response(
    JSON.stringify({
      object: "list",
      data: models
        .filter((model) => !model.id.startsWith("alpha-"))
        .map((model) => ({
          id: model.id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "opencode",
          npm: model.npm,
        })),
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
}
