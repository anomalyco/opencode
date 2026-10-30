export * as GmiCloudModels from "./models.js"

import { Money } from "@opencode/schema/money"
import { Option, Schema } from "effect"
import { Model } from "../model.js"
import { Provider } from "../provider.js"

const providerID = Provider.ID.make("gmicloud")

const RemoteModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  context_length: Schema.optional(Schema.Number),
  pricing: Schema.optional(
    Schema.Struct({
      prompt: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      completion: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
      input_cache_read: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
    }),
  ),
})

const Response = Schema.Struct({ data: Schema.Array(Schema.Unknown) })
const decodeResponse = Schema.decodeUnknownSync(Response)
const decodeModel = Schema.decodeUnknownOption(RemoteModel)

type RemoteModel = typeof RemoteModel.Type

export async function get(baseURL: string, apiKey: string, existing: readonly Model.Info[]) {
  return derive(baseURL, await load(baseURL, apiKey), existing)
}

export type Snapshot = readonly RemoteModel[]

export async function load(baseURL: string, apiKey: string): Promise<Snapshot> {
  const response = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(3_000),
  })
  if (!response.ok) throw new Error(`Failed to fetch GMI Cloud models: ${response.status}`)

  return decodeResponse(await response.json()).data.flatMap((raw) => {
    const model = Option.getOrUndefined(decodeModel(raw))
    return model ? [model] : []
  })
}

export function derive(baseURL: string, remote: Snapshot, existing: readonly Model.Info[]) {
  const templates = new Map(existing.map((model) => [model.id, model]))
  const result = new Map<Model.ID, Model.Info>()
  for (const item of remote) {
    const id = Model.ID.make(item.id)
    result.set(id, build(id, item, baseURL, templates.get(id)))
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
    compatibility: previous?.compatibility,
    package: "@opencode/ai/providers/openai-compatible",
    settings: Provider.mergeOverlay(previous?.settings, { baseURL, provider: providerID }),
    headers: previous?.headers,
    body: previous?.body,
    capabilities: previous?.capabilities ?? { tools: true, input: ["text"], output: ["text"] },
    variants: previous?.variants ?? [],
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
      output: previous?.limit.output ?? 0,
    },
  })
}
