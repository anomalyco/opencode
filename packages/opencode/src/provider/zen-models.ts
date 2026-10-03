import { Option, Schema } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Model } from "./provider"

const item = Schema.Struct({
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  package: Schema.optional(Schema.String),
  provider: Schema.optional(
    Schema.Struct({
      npm: Schema.optional(Schema.String),
    }),
  ),
})

const response = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
})

const decodeResponse = Schema.decodeUnknownSync(response)
const decodeItem = Schema.decodeUnknownOption(item)

type NpmModel = { api?: { npm?: string } }

export function siblingModel<T extends NpmModel>(modelID: string, existing: Record<string, T>) {
  const stem = modelID.replace(/[-_.]?\d.*$/, "")
  if (stem.length < 4) return
  const matches = Object.entries(existing)
    .filter(([id]) => id !== modelID)
    .filter(([id]) => id === stem || id.startsWith(`${stem}-`) || id.startsWith(`${stem}.`) || id.startsWith(`${stem}_`))
    .sort(([left], [right]) => right.length - left.length)
  if (!matches[0]) return
  return matches[0][1]
}

export function inferNpm(modelID: string, existing: Record<string, NpmModel>, fallback?: string) {
  const sibling = siblingModel(modelID, existing)?.api?.npm
  if (sibling) return sibling
  if (/^(gpt-|o[1-9]|chatgpt-|muse-spark)/i.test(modelID)) return "@ai-sdk/openai"
  if (/^claude/i.test(modelID)) return "@ai-sdk/anthropic"
  if (/^gemini/i.test(modelID)) return "@ai-sdk/google"
  return fallback
}

function remoteNpm(value: Schema.Schema.Type<typeof item>) {
  return value.npm ?? value.package ?? value.provider?.npm
}

function build(id: string, existing: Record<string, Model>, baseURL: string, npm: string): Model {
  const sibling = siblingModel(id, existing)
  if (sibling) {
    return {
      ...sibling,
      id: ModelV2.ID.make(id),
      name: id,
      api: {
        id,
        url: sibling.api.url || baseURL,
        npm,
      },
    }
  }
  return {
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.opencode,
    name: id,
    family: "",
    api: {
      id,
      url: baseURL,
      npm,
    },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 4096 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

export function merge(existing: Record<string, Model>, ids: Schema.Schema.Type<typeof item>[], baseURL: string) {
  const next = { ...existing }
  for (const entry of ids) {
    const current = next[entry.id]
    const npm =
      remoteNpm(entry) ?? inferNpm(entry.id, existing, current?.api.npm) ?? "@ai-sdk/openai-compatible"
    if (!current) {
      next[entry.id] = build(entry.id, next, baseURL, npm)
      continue
    }
    if (current.api.npm === npm) continue
    if (current.api.npm !== "@ai-sdk/openai-compatible") continue
    next[entry.id] = {
      ...current,
      api: {
        ...current.api,
        npm,
        url: current.api.url || baseURL,
      },
    }
  }
  return next
}

export async function get(baseURL: string, apiKey: string, existing: Record<string, Model>) {
  const data = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(3_000),
  }).then(async (res) => {
    if (!res.ok) throw new Error(`Failed to fetch Zen models: ${res.status}`)
    return decodeResponse(await res.json())
  })

  const ids = data.data.flatMap((raw) => {
    const parsed = Option.getOrUndefined(decodeItem(raw))
    return parsed ? [parsed] : []
  })
  return merge(existing, ids, baseURL)
}

export * as ZenModels from "./zen-models"
