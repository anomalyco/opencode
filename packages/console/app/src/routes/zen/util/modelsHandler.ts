import { corsHeaders } from "./cors"

export async function buildOptionsResponse() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  })
}

export async function buildModelsResponse(models: string[]) {
  return new Response(
    JSON.stringify({
      object: "list",
      data: models
        .filter((id) => !id.startsWith("alpha-"))
        .map((id) => ({
          id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "opencode",
        })),
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    },
  )
}
