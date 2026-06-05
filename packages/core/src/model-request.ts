export * as ModelRequest from "./model-request"

import { Schema } from "effect"

export const Generation = Schema.Struct({
  maxTokens: Schema.Number.pipe(Schema.optional),
  temperature: Schema.Number.pipe(Schema.optional),
  topP: Schema.Number.pipe(Schema.optional),
  topK: Schema.Number.pipe(Schema.optional),
  frequencyPenalty: Schema.Number.pipe(Schema.optional),
  presencePenalty: Schema.Number.pipe(Schema.optional),
  seed: Schema.Number.pipe(Schema.optional),
  stop: Schema.String.pipe(Schema.Array, Schema.mutable, Schema.optional),
})
export type Generation = typeof Generation.Type

const generationKeys = new Map<string, keyof Generation>([
  ["maxOutputTokens", "maxTokens"],
  ["maxTokens", "maxTokens"],
  ["temperature", "temperature"],
  ["topP", "topP"],
  ["topK", "topK"],
  ["frequencyPenalty", "frequencyPenalty"],
  ["presencePenalty", "presencePenalty"],
  ["seed", "seed"],
  ["stopSequences", "stop"],
  ["stop", "stop"],
])

const semanticKeys = new Map<string, ReadonlyMap<string, string>>([
  [
    "@ai-sdk/openai",
    new Map([
      ["store", "store"],
      ["promptCacheKey", "promptCacheKey"],
      ["reasoningEffort", "reasoningEffort"],
      ["reasoningSummary", "reasoningSummary"],
      ["include", "include"],
      ["textVerbosity", "textVerbosity"],
      ["serviceTier", "serviceTier"],
      ["service_tier", "serviceTier"],
    ]),
  ],
  [
    "@ai-sdk/openai-compatible",
    new Map([
      ["store", "store"],
      ["promptCacheKey", "promptCacheKey"],
      ["reasoningEffort", "reasoningEffort"],
      ["reasoning_effort", "reasoningEffort"],
    ]),
  ],
  ["@ai-sdk/anthropic", new Map([["thinking", "thinking"]])],
])

/** Partitions AI-SDK-shaped request options before they enter the Catalog. */
export function ingest(packageName: string | undefined, input: Readonly<Record<string, unknown>>) {
  const generation: Record<string, number | ReadonlyArray<string>> = {}
  const options: Record<string, unknown> = {}
  const body: Record<string, unknown> = {}
  const semantics = semanticKeys.get(packageName ?? "")

  for (const [key, value] of Object.entries(input)) {
    const generationKey = generationKeys.get(key)
    if (generationKey === "stop" && Array.isArray(value) && value.every((item) => typeof item === "string"))
      generation[generationKey] = value
    else if (generationKey !== undefined && generationKey !== "stop" && typeof value === "number")
      generation[generationKey] = value
    else if (semantics?.has(key)) options[semantics.get(key)!] = value
    else body[key] = value
  }

  return { generation, options, body }
}
