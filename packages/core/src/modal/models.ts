export * as ModalModels from "./models.js"

import { Money } from "@opencode-ai/schema/money"
import { Option, Schema } from "effect"
import { Model } from "../model.js"
import { Provider } from "../provider.js"

const providerID = Provider.ID.make("modal")

const ReasoningOption = Schema.Struct({
  type: Schema.Literal("effort"),
  values: Schema.Array(Schema.NullOr(Schema.String)),
})

const RemoteModel = Schema.Struct({
  id: Schema.String,
  base_model_id: Schema.optional(Schema.String),
  hugging_face_id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  input_modalities: Schema.optional(Schema.Array(Schema.String)),
  output_modalities: Schema.optional(Schema.Array(Schema.String)),
  context_length: Schema.optional(Schema.Number),
  max_output_length: Schema.optional(Schema.Number),
  pricing: Schema.optional(
    Schema.Struct({
      prompt: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      completion: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      input_cache_read: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
    }),
  ),
  supported_sampling_parameters: Schema.optional(Schema.Array(Schema.String)),
  supported_features: Schema.optional(Schema.Array(Schema.String)),
  reasoning_options: Schema.optional(Schema.Array(ReasoningOption)),
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Boolean,
      Schema.Struct({
        field: Schema.Literals(["reasoning", "reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
})

const Response = Schema.Struct({ data: Schema.Array(Schema.Unknown) })
const decodeResponse = Schema.decodeUnknownSync(Response)
const decodeModel = Schema.decodeUnknownOption(RemoteModel)

type RemoteModel = typeof RemoteModel.Type

export async function get(baseURL: string, apiKey: string, existing: readonly Model.Info[]) {
  const response = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(3_000),
  })
  if (!response.ok) throw new Error(`Failed to fetch Modal models: ${response.status}`)

  // Decode each item tolerantly so one malformed entry cannot discard the
  // whole inventory. A malformed envelope still fails the fetch.
  const remote = decodeResponse(await response.json()).data.flatMap((raw) => {
    const model = Option.getOrUndefined(decodeModel(raw))
    return model ? [model] : []
  })
  const templates = new Map(existing.map((model) => [model.id, model]))
  const result = new Map<Model.ID, Model.Info>()
  for (const item of remote) {
    const template = templates.get(Model.ID.make(item.base_model_id ?? item.hugging_face_id ?? item.id))
    const id = Model.ID.make(item.id)
    result.set(id, build(id, item, baseURL, template))
  }
  return result
}

function price(value: string | number | undefined, fallback: Money.USDPerMillionTokens) {
  if (value === undefined) return fallback
  const parsed = Number(value) * 1_000_000
  return Number.isFinite(parsed) ? Money.USDPerMillionTokens.make(parsed) : fallback
}

function limit(value: number | undefined, fallback: number) {
  const parsed = value === undefined ? fallback : Math.trunc(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function build(id: Model.ID, remote: RemoteModel, baseURL: string, previous?: Model.Info) {
  const cost = previous?.cost[0]
  const input = previous?.limit.input
  return Model.Info.make({
    ...Model.Info.default(providerID, id),
    id,
    modelID: Model.ID.make(remote.id),
    providerID,
    name: remote.name ?? previous?.name ?? remote.id,
    family: previous?.family,
    compatibility:
      remote.interleaved === undefined
        ? previous?.compatibility
        : (Model.compatibility(remote.interleaved) ?? previous?.compatibility),
    package: Provider.aisdk("@ai-sdk/openai-compatible"),
    settings: Provider.mergeOverlay(previous?.settings, { baseURL }),
    headers: previous?.headers,
    body: previous?.body,
    capabilities: {
      tools: remote.supported_features?.includes("tools") ?? previous?.capabilities.tools ?? true,
      input: remote.input_modalities ?? previous?.capabilities.input ?? ["text"],
      output: remote.output_modalities ?? previous?.capabilities.output ?? ["text"],
    },
    variants: remote.reasoning_options === undefined ? (previous?.variants ?? []) : variants(remote),
    time: previous?.time ?? { released: 0 },
    cost: [
      {
        input: price(remote.pricing?.prompt, cost?.input ?? Money.USDPerMillionTokens.zero),
        output: price(remote.pricing?.completion, cost?.output ?? Money.USDPerMillionTokens.zero),
        cache: {
          read: price(remote.pricing?.input_cache_read, cost?.cache.read ?? Money.USDPerMillionTokens.zero),
          write: cost?.cache.write ?? Money.USDPerMillionTokens.zero,
        },
      },
    ],
    status: previous?.status ?? "active",
    enabled: previous?.enabled ?? true,
    limit: {
      context: limit(remote.context_length, previous?.limit.context ?? 0),
      ...(input === undefined ? {} : { input }),
      output: limit(remote.max_output_length, previous?.limit.output ?? 0),
    },
  })
}

function variants(remote: RemoteModel): Model.Info["variants"] {
  const seen = new Map<string, Model.Info["variants"][number]>()
  for (const option of remote.reasoning_options ?? []) {
    for (const value of option.values) {
      const effort = value ?? "none"
      if (!seen.has(effort))
        seen.set(effort, { id: Model.VariantID.make(effort), settings: { reasoningEffort: effort } })
    }
  }
  return [...seen.values()]
}
