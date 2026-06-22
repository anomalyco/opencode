export * as ModelRequest from "./model-request"

import { Effect, Schema } from "effect"

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

export const Request = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Any),
  generation: Generation.pipe(
    Schema.optionalKey,
    Schema.withConstructorDefault(Effect.succeed({})),
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
  options: Schema.Record(Schema.String, Schema.Any).pipe(
    Schema.optionalKey,
    Schema.withConstructorDefault(Effect.succeed({})),
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
})
export type Request = typeof Request.Type

interface MutableRequest {
  headers: Record<string, string>
  body: Record<string, unknown>
  generation?: Record<string, unknown>
  options?: Record<string, unknown>
}

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

interface Profile {
  readonly namespace: string
  readonly semantics: ReadonlyMap<string, string>
}

const profiles = new Map<string, Profile>([
  [
    "@ai-sdk/openai",
    {
      namespace: "openai",
      semantics: new Map([
        ["store", "store"],
        ["promptCacheKey", "promptCacheKey"],
        ["reasoningEffort", "reasoningEffort"],
        ["reasoningSummary", "reasoningSummary"],
        ["include", "include"],
        ["textVerbosity", "textVerbosity"],
        ["serviceTier", "serviceTier"],
        ["service_tier", "serviceTier"],
      ]),
    },
  ],
  [
    "@ai-sdk/openai-compatible",
    {
      namespace: "openai",
      semantics: new Map([
        ["store", "store"],
        ["promptCacheKey", "promptCacheKey"],
        ["reasoningEffort", "reasoningEffort"],
        ["reasoning_effort", "reasoningEffort"],
      ]),
    },
  ],
  ["@ai-sdk/anthropic", { namespace: "anthropic", semantics: new Map([["thinking", "thinking"]]) }],
])

export const namespace = (packageName: string) => profiles.get(packageName)?.namespace

export const merge = (base: Request, override: Partial<Request>) => ({
  headers: { ...base.headers, ...override.headers },
  body: { ...base.body, ...override.body },
  generation: { ...base.generation, ...override.generation },
  options: { ...base.options, ...override.options },
})

export const assign = (target: MutableRequest, override: Partial<Request>) => {
  Object.assign(target.headers, override.headers)
  Object.assign(target.body, override.body)
  Object.assign((target.generation ??= {}), override.generation)
  Object.assign((target.options ??= {}), override.options)
}

/** Partitions AI-SDK-shaped request options before they enter the Catalog. */
export function normalizeAiSdkOptions(packageName: string | undefined, input: Readonly<Record<string, unknown>>) {
  const generation: Record<string, number | ReadonlyArray<string>> = {}
  const options: Record<string, unknown> = {}
  const body: Record<string, unknown> = {}
  const semantics = profiles.get(packageName ?? "")?.semantics

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
