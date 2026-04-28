import { Effect, Stream } from "effect"
import { Adapter } from "../adapter"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import { ProviderChunkError, type LLMError, type LLMRequest } from "../schema"
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

const invalid = ProviderShared.invalidRequest

const completionUrl = (request: LLMRequest) => {
  if (!request.model.baseURL) return undefined
  return ProviderShared.withQuery(
    `${ProviderShared.trimBaseUrl(request.model.baseURL)}/chat/completions`,
    ProviderShared.queryParams(request),
  )
}

const toHttp = (target: OpenAIChatTarget, request: LLMRequest) =>
  Effect.gen(function* () {
    const url = completionUrl(request)
    if (!url) return yield* invalid("OpenAI-compatible Chat requires a baseURL")
    return ProviderShared.jsonPost({
      url,
      body: ProviderShared.encodeJson(target),
      headers: request.model.headers,
    })
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
    // Match the precedence used by every other adapter: when an `apiKey` is
    // supplied, its `Authorization: Bearer ...` wins over caller-provided
    // headers. Callers who want to override auth should omit `apiKey` and set
    // the header themselves.
    headers: apiKey ? { ...headers, authorization: `Bearer ${apiKey}` } : headers,
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
