import type { Model } from "@opencode-ai/sdk/v2"
import { Schema } from "effect"

export const schema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      model_picker_enabled: Schema.Boolean,
      id: Schema.String,
      name: Schema.String,
      // every version looks like: `{model.id}-YYYY-MM-DD`
      version: Schema.String,
      supported_endpoints: Schema.optional(Schema.Array(Schema.String)),
      policy: Schema.optional(
        Schema.Struct({
          state: Schema.optional(Schema.String),
        }),
      ),
      capabilities: Schema.Struct({
        family: Schema.String,
        limits: Schema.Struct({
          max_context_window_tokens: Schema.Number,
          max_output_tokens: Schema.Number,
          max_prompt_tokens: Schema.Number,
          vision: Schema.optional(
            Schema.Struct({
              max_prompt_image_size: Schema.Number,
              max_prompt_images: Schema.Number,
              supported_media_types: Schema.Array(Schema.String),
            }),
          ),
        }),
        supports: Schema.Struct({
          adaptive_thinking: Schema.optional(Schema.Boolean),
          max_thinking_budget: Schema.optional(Schema.Number),
          min_thinking_budget: Schema.optional(Schema.Number),
          reasoning_effort: Schema.optional(Schema.Array(Schema.String)),
          streaming: Schema.Boolean,
          structured_outputs: Schema.optional(Schema.Boolean),
          tool_calls: Schema.Boolean,
          vision: Schema.optional(Schema.Boolean),
        }),
      }),
    }),
  ),
})

type Item = Schema.Schema.Type<typeof schema>["data"][number]
const decodeModels = Schema.decodeUnknownSync(schema)

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

  const model: Model = {
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
  }

  const efforts = remote.capabilities.supports.reasoning_effort
  const variants: NonNullable<Model["variants"]> = {}
  if (!isMsgApi && efforts?.length) {
    efforts.forEach((effort) => {
      variants[effort] = {
        reasoningEffort: effort,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      }
    })
  } else {
    if (efforts?.length && remote.capabilities.supports.adaptive_thinking) {
      efforts.forEach((effort) => {
        variants[effort] = {
          thinking: {
            type: "adaptive",
            ...(model.api.id.includes("opus-4.7") ? { display: "summarized" } : {}),
          },
          effort,
        }
      })
    } else if (remote.capabilities.supports.max_thinking_budget) {
      const max = remote.capabilities.supports.max_thinking_budget
      variants["max"] = {
        thinking: {
          type: "enabled",
          budgetTokens: max - 1,
        },
      }
      variants["high"] = {
        thinking: {
          type: "enabled",
          budgetTokens: Math.floor(max / 2),
        },
      }
    }
  }
  if (Object.keys(variants).length > 0) {
    model.variants = variants
  }

  return model
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
    return decodeModels(await res.json())
  })

  const result = { ...existing }
  const remote = new Map(
    data.data.filter((m) => m.model_picker_enabled && m.policy?.state !== "disabled").map((m) => [m.id, m] as const),
  )

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

export * as CopilotModels from "./models"
