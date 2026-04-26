import { Effect, Stream } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Adapter } from "../adapter"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import { InvalidRequestError, ProviderChunkError, type LLMError, type LLMRequest } from "../schema"
import { OpenAIChat, type OpenAIChatTarget } from "./openai-chat"
import { families, type ProviderFamily } from "./openai-compatible-family"
import { ProviderShared } from "./shared"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = Omit<ModelInput, "protocol" | "headers" | "baseURL"> & {
  readonly baseURL: string
  readonly apiKey?: string
  readonly headers?: Record<string, string>
  readonly queryParams?: Record<string, string>
}

export type ProviderFamilyModelInput = Omit<OpenAICompatibleChatModelInput, "provider" | "baseURL"> & {
  readonly baseURL?: string
}

const invalid = (message: string) => new InvalidRequestError({ message })

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "string")

const queryParams = (request: LLMRequest) => {
  const value = request.model.native?.queryParams
  if (!isStringRecord(value)) return undefined
  return value
}

const completionUrl = (request: LLMRequest) => {
  if (!request.model.baseURL) return undefined
  const url = new URL(`${request.model.baseURL.replace(/\/+$/, "")}/chat/completions`)
  for (const [key, value] of Object.entries(queryParams(request) ?? {})) url.searchParams.set(key, value)
  return url.toString()
}

const toHttp = (target: OpenAIChatTarget, request: LLMRequest) =>
  Effect.gen(function* () {
    const url = completionUrl(request)
    if (!url) return yield* invalid("OpenAI-compatible Chat requires a baseURL")

    return HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeaders({
        ...request.model.headers,
        "content-type": "application/json",
      }),
      HttpClientRequest.bodyText(ProviderShared.encodeJson(target), "application/json"),
    )
  })

const mapParseError = (error: LLMError) => {
  if (!(error instanceof ProviderChunkError)) return error
  return new ProviderChunkError({
    adapter: ADAPTER,
    message: error.message.replace("OpenAI Chat", "OpenAI-compatible Chat"),
    raw: error.raw,
  })
}

export const adapter = Adapter.compose<OpenAIChatTarget, OpenAIChatTarget>({
  id: ADAPTER,
  base: OpenAIChat.adapter,
  protocol: "openai-compatible-chat",
  toHttp: (target, context) => toHttp(target, context.request),
  parse: (response) => OpenAIChat.adapter.parse(response).pipe(Stream.mapError(mapParseError)),
})

export const model = (input: OpenAICompatibleChatModelInput) => {
  const { apiKey, headers, queryParams, native, ...rest } = input
  return llmModel({
    ...rest,
    protocol: "openai-compatible-chat",
    headers: apiKey ? { authorization: `Bearer ${apiKey}`, ...headers } : headers,
    native: queryParams ? { ...native, queryParams } : native,
    capabilities: input.capabilities ?? capabilities({ tools: { calls: true, streamingInput: true } }),
  })
}

const familyModel = (family: ProviderFamily, input: ProviderFamilyModelInput) =>
  model({
    ...input,
    provider: family.provider,
    baseURL: input.baseURL ?? family.baseURL,
    native: { ...input.native, openaiCompatibleProvider: family.provider },
  })

export const baseten = (input: ProviderFamilyModelInput) => familyModel(families.baseten, input)

export const cerebras = (input: ProviderFamilyModelInput) => familyModel(families.cerebras, input)

export const deepinfra = (input: ProviderFamilyModelInput) => familyModel(families.deepinfra, input)

export const deepseek = (input: ProviderFamilyModelInput) => familyModel(families.deepseek, input)

export const fireworks = (input: ProviderFamilyModelInput) => familyModel(families.fireworks, input)

export const togetherai = (input: ProviderFamilyModelInput) => familyModel(families.togetherai, input)

export const includeUsage = adapter.patch("include-usage", {
  reason: "request final usage chunk from OpenAI-compatible Chat streaming responses",
  apply: (target) => ({
    ...target,
    stream_options: { ...target.stream_options, include_usage: true },
  }),
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
