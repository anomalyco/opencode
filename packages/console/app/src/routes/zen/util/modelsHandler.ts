import { ZenData } from "@opencode-ai/console-core/model.js"

export async function optionsHandler() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}

export async function getHandler(opts: { modelList: "lite" | "full"; disabledModels?: string[] }) {
  const zenData = ZenData.list(opts.modelList)

  return new Response(
    JSON.stringify({
      object: "list",
      data: Object.entries(zenData.models)
        .filter(([id]) => !opts.disabledModels?.includes(id))
        .filter(([id]) => !id.startsWith("alpha-"))
        .map(([id, _model]) => ({
          id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "opencode",
        })),
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
}
