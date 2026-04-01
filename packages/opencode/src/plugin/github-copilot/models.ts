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

  export async function get(
    baseURL: string,
    headers: HeadersInit = {},
    existing: Record<string, Model> = {},
  ): Promise<Record<string, Model>> {
    const models = await fetch(`${baseURL}/models`, {
      headers,
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch models: ${res.status}`)
      }
      return schema.parse(await res.json())
    })

    const parsed: Record<string, Model> = {}

    models.data.forEach((model) => {
      if (!model.model_picker_enabled) return

      parsed[model.id] = {
        id: model.id,
        providerID: "github-copilot",
        api: {
          id: model.id,
          url: baseURL,
          npm: "@ai-sdk/github-copilot",
        },
        name: model.name,
        family: model.capabilities.family,
        capabilities: {
          temperature: existing[model.id]?.capabilities.temperature ?? true,
          reasoning:
            !!model.capabilities.supports.adaptive_thinking ||
            !!model.capabilities.supports.reasoning_effort?.length ||
            model.capabilities.supports.max_thinking_budget !== undefined ||
            model.capabilities.supports.min_thinking_budget !== undefined,
          attachment:
            (model.capabilities.supports.vision ?? false) ||
            (model.capabilities.limits.vision?.supported_media_types ?? []).some((item) => item.startsWith("image/")),
          toolcall: model.capabilities.supports.tool_calls,
          input: {
            text: true,
            audio: false,
            image:
              (model.capabilities.supports.vision ?? false) ||
              (model.capabilities.limits.vision?.supported_media_types ?? []).some((item) => item.startsWith("image/")),
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
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: model.capabilities.limits.max_context_window_tokens,
          input: model.capabilities.limits.max_prompt_tokens,
          output: model.capabilities.limits.max_output_tokens,
        },
        options: {},
        headers: {},
        release_date: model.version.startsWith(`${model.id}-`)
          ? model.version.slice(model.id.length + 1)
          : model.version,
        variants: {},
        status: "active",
      }
    })

    return parsed
  }
}
