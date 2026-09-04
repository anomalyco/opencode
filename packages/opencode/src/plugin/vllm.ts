import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Schema } from "effect"
import { mergeDeep } from "remeda"

const ID = "vllm"
const DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1"
const TTL = 30_000

const response = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      owned_by: Schema.optional(Schema.String),
      max_model_len: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
})

const decode = Schema.decodeUnknownSync(response)

type Discovered = Record<string, { name: string; limit: { context: number; output: number }; interleaved: string }>

// Keyed by endpoint so several instances sharing one server probe it once per TTL.
const cache = new Map<string, { at: number; models: Promise<Discovered> }>()

export function discover(baseURL: string, apiKey?: string) {
  const key = `${baseURL}\n${apiKey ?? ""}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.models

  const models = fetch(`${baseURL}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(3_000),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Failed to fetch vLLM models: ${res.status}`)
      return decode(await res.json())
    })
    .then(
      (body): Discovered =>
        Object.fromEntries(
          body.data
            // vLLM stamps its own model cards with owned_by "vllm"; skip anything else served on the same port.
            .filter((item) => item.owned_by === ID && item.id.length > 0)
            .map((item) => [
              item.id,
              {
                name: item.id,
                // vLLM reports the context window but no separate output cap; 0 keeps the generic default.
                limit: { context: item.max_model_len ?? 0, output: 0 },
                // vLLM reasoning parsers emit reasoning_content, and some chat templates (e.g. Kimi K2)
                // reject assistant turns that come back without it. Harmless for models that never reason.
                interleaved: "reasoning_content",
              },
            ]),
        ),
    )
  cache.set(key, { at: Date.now(), models })
  models.catch(() => cache.delete(key))
  return models
}

export async function VllmPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    config: async (cfg) => {
      if (cfg.disabled_providers?.includes(ID)) return
      if (cfg.enabled_providers && !cfg.enabled_providers.includes(ID)) return

      const declared = cfg.provider?.[ID]
      const baseURL = (declared?.options?.baseURL ?? process.env.VLLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
      const apiKey = declared?.options?.apiKey ?? process.env.VLLM_API_KEY
      const models = await discover(baseURL, apiKey).catch((): Discovered => ({}))
      if (Object.keys(models).length === 0) return

      cfg.provider = {
        ...cfg.provider,
        [ID]: {
          ...declared,
          npm: declared?.npm ?? "@ai-sdk/openai-compatible",
          name: declared?.name ?? "vLLM",
          env: declared?.env ?? ["VLLM_API_KEY"],
          options: { ...declared?.options, baseURL },
          // Discovered cards are defaults; anything declared in config wins.
          models: mergeDeep(models, declared?.models ?? {}),
        },
      }
    },
  }
}
