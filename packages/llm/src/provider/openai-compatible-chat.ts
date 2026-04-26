import { Effect, Stream } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Adapter } from "../adapter"
import { capabilities, model as llmModel, type ModelInput } from "../llm"
import { InvalidRequestError, ProviderChunkError, type LLMError, type LLMRequest } from "../schema"
import { OpenAIChat, type OpenAIChatTarget } from "./openai-chat"
import { ProviderShared } from "./shared"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = Omit<ModelInput, "protocol" | "headers" | "baseURL"> & {
  readonly baseURL: string
  readonly apiKey?: string
  readonly headers?: Record<string, string>
  readonly queryParams?: Record<string, string>
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

export const adapter = Adapter.define<OpenAIChatTarget, OpenAIChatTarget>({
  id: ADAPTER,
  protocol: "openai-compatible-chat",
  redact: OpenAIChat.adapter.redact,
  prepare: OpenAIChat.adapter.prepare,
  validate: OpenAIChat.adapter.validate,
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

export const includeUsage = adapter.patch("include-usage", {
  reason: "request final usage chunk from OpenAI-compatible Chat streaming responses",
  apply: (target) => ({
    ...target,
    stream_options: { ...target.stream_options, include_usage: true },
  }),
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
