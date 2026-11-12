/**
 * Generic OpenAI-compatible model discovery.
 *
 * Many providers (Volcengine Ark, BytePlus, MiniMax, DeepSeek, etc.) expose an
 * OpenAI-compatible `GET /models` endpoint. This module fetches that endpoint
 * and merges the results with catalog templates from models.dev so the
 * discovered models inherit family, cost, capabilities, and compatibility
 * metadata from the catalog while their availability is determined live.
 */
export * as OpenAICompatibleModels from "./models.js"

import { Money } from "@opencode/schema/money"
import { Effect, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Model } from "../model.js"
import { Provider } from "../provider.js"

const Response = Schema.Struct({ data: Schema.Array(Schema.Unknown) })

/** A single entry returned by `GET /models`. */
const RemoteModel = Schema.Struct({
  id: Schema.String,
})
const decodeModel = Schema.decodeUnknownOption(RemoteModel)

type RemoteModel = typeof RemoteModel.Type

export type Snapshot = readonly RemoteModel[]

/**
 * Fetch the model list from `GET <baseURL>/models`.
 * Each entry in `data` is decoded tolerantly so one malformed item cannot
 * discard the whole inventory.
 */
export const load = Effect.fn("OpenAICompatibleModels.load")(function* (
  http: HttpClient.HttpClient,
  baseURL: string,
  apiKey: string,
) {
  const response = yield* HttpClient.filterStatusOk(http)
    .execute(
      HttpClientRequest.get(`${baseURL.replace(/\/+$/, "")}/models`).pipe(
        HttpClientRequest.bearerToken(apiKey),
      ),
    )
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)), Effect.timeout("3 seconds"))
  return response.data.flatMap((raw) => {
    const model = Option.getOrUndefined(decodeModel(raw))
    return model ? [model] : []
  })
})

/**
 * Combine remote facts with source templates. A discovered model whose ID
 * matches a catalog template inherits the template's metadata (family, cost,
 * capabilities, compatibility, variants, etc.). A discovered model with no
 * template gets sensible defaults from `Model.Info.default`.
 */
export function derive(
  providerID: Provider.ID,
  baseURL: string,
  remote: Snapshot,
  existing: readonly Model.Info[],
) {
  const templates = new Map(existing.map((model) => [model.id, model]))
  const result = new Map<Model.ID, Model.Info>()
  for (const item of remote) {
    const id = Model.ID.make(item.id)
    const template = templates.get(id)
    result.set(id, build(providerID, id, baseURL, template))
  }
  return result
}

function build(providerID: Provider.ID, id: Model.ID, baseURL: string, previous?: Model.Info) {
  return Model.Info.make({
    ...Model.Info.default(providerID, id),
    id,
    modelID: id,
    providerID,
    name: previous?.name ?? id,
    family: previous?.family,
    compatibility: previous?.compatibility,
    package: previous?.package,
    settings: Provider.mergeOverlay(previous?.settings, { baseURL, provider: providerID }),
    headers: previous?.headers,
    body: previous?.body,
    capabilities: {
      tools: previous?.capabilities.tools ?? true,
      input: previous?.capabilities.input ?? ["text"],
      output: previous?.capabilities.output ?? ["text"],
    },
    variants: previous?.variants ?? [],
    time: previous?.time ?? { released: 0 },
    cost: previous ? previous.cost : [{ input: Money.USDPerMillionTokens.zero, output: Money.USDPerMillionTokens.zero, cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero } }],
    status: previous?.status ?? "active",
    enabled: previous?.enabled ?? true,
    limit: previous?.limit ?? { context: 0, output: 0 },
  })
}
