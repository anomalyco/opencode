import { z } from "zod"
import type { Model } from "@opencode-ai/sdk/v2"

export namespace CopilotModels {
  export const schema = z.object({
    data: z.array(
      z.object({
        model_picker_enabled: z.boolean(),
        id: z.string(),
        name: z.string(),
        // every version looks like: `{model.id}-YYYY-MM-DD`
        version: z.string(),
        supported_endpoints: z.array(z.string()).optional(),
        capabilities: z.object({
          family: z.string(),
          limits: z.object({
            max_context_window_tokens: z.number(),
            max_output_tokens: z.number(),
            max_prompt_tokens: z.number(),
            vision: z
              .object({
                max_prompt_image_size: z.number(),
                max_prompt_images: z.number(),
                supported_media_types: z.array(z.string()),
              })
              .optional(),
          }),
          supports: z.object({
            adaptive_thinking: z.boolean().optional(),
            max_thinking_budget: z.number().optional(),
            min_thinking_budget: z.number().optional(),
            reasoning_effort: z.array(z.string()).optional(),
            streaming: z.boolean(),
            structured_outputs: z.boolean().optional(),
            tool_calls: z.boolean(),
            vision: z.boolean().optional(),
          }),
        }),
      }),
    ),
  })

  type Item = z.infer<typeof schema>["data"][number]

  function build(key: string, remote: Item, url: string, prev?: Model): Model {
    const reasoning =
      !!remote.capabilities.supports.adaptive_thinking ||
      !!remote.capabilities.supports.reasoning_effort?.length ||
      remote.capabilities.supports.max_thinking_budget !== undefined ||
      remote.capabilities.supports.min_thinking_budget !== undefined
    const image =
      (remote.capabilities.supports.vision ?? false) ||
      (remote.capabilities.limits.vision?.supported_media_types ?? []).some((item) => item.startsWith("image/"))

    const isMsgApi = remote.supported_endpoints?.includes("/v1/messages")

    return {
      id: key,
      providerID: "github-copilot",
      api: {
        id: remote.id,
        url: isMsgApi ? `${url}/v1` : url,
        npm: isMsgApi ? "@ai-sdk/anthropic" : "@ai-sdk/github-copilot",
      },
      // API response wins
      status: "active",
      limit: {
        context: remote.capabilities.limits.max_context_window_tokens,
        input: remote.capabilities.limits.max_prompt_tokens,
        output: remote.capabilities.limits.max_output_tokens,
      },
      capabilities: {
        temperature: prev?.capabilities.temperature ?? true,
        reasoning: prev?.capabilities.reasoning ?? reasoning,
        attachment: prev?.capabilities.attachment ?? true,
        toolcall: remote.capabilities.supports.tool_calls,
        input: {
          text: true,
          audio: false,
          image,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      // existing wins
      family: prev?.family ?? remote.capabilities.family,
      name: prev?.name ?? remote.name,
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      options: prev?.options ?? {},
      headers: prev?.headers ?? {},
      release_date:
        prev?.release_date ??
        (remote.version.startsWith(`${remote.id}-`) ? remote.version.slice(remote.id.length + 1) : remote.version),
      variants: prev?.variants ?? {},
    }
  }

  export async function get(
    baseURL: string,
    headers: HeadersInit = {},
    existing: Record<string, Model> = {},
  ): Promise<Record<string, Model>> {
    const data = await fetch(`${baseURL}/models`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch models: ${res.status}`)
      }
      return schema.parse(await res.json())
    })

    const result = { ...existing }
    const remote = new Map(data.data.filter((m) => m.model_picker_enabled).map((m) => [m.id, m] as const))

    // prune existing models whose api.id isn't in the endpoint response
    for (const [key, model] of Object.entries(result)) {
      const m = remote.get(model.api.id)
      if (!m) {
        delete result[key]
        continue
      }
      result[key] = build(key, m, baseURL, model)
    }

    // add new endpoint models not already keyed in result
    for (const [id, m] of remote) {
      if (id in result) continue
      result[id] = build(id, m, baseURL)
    }

    return result
  }
}
