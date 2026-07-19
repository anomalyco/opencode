import { Effect, Schema } from "effect"
import { Route, type RouteDefaultsInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAIChat from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = OpenAICompatibleProfiles.profiles.openrouter
export const id = ProviderID.make(profile.provider)
const ADAPTER = "openrouter"
const REASONING_FORMATS = new Set([
  "unknown",
  "openai-responses-v1",
  "azure-openai-responses-v1",
  "xai-responses-v1",
  "anthropic-claude-v1",
  "google-gemini-v1",
])

export interface OpenRouterOptions {
  readonly [key: string]: unknown
  readonly usage?: boolean | Record<string, unknown>
  readonly reasoning?: Record<string, unknown>
  readonly promptCacheKey?: string
}

export type OpenRouterProviderOptionsInput = ProviderOptions & {
  readonly openrouter?: OpenRouterOptions
}

export type ModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenRouterProviderOptionsInput
  }

const OpenRouterBody = Schema.StructWithRest(Schema.Struct(OpenAIChat.bodyFields), [
  Schema.Record(Schema.String, Schema.Any),
])
export type OpenRouterBody = Schema.Schema.Type<typeof OpenRouterBody>

export const protocol = Protocol.make({
  id: "openrouter-chat",
  body: {
    schema: OpenRouterBody,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map((body) => {
          const sourceAssistants = request.messages.filter((message) => message.role === "assistant")
          const seenReasoningDetails = new Set<string>()
          let assistantIndex = 0
          const messages = body.messages.map((message) => {
            if (message.role !== "assistant") return message
            const source = sourceAssistants[assistantIndex++]
            const reasoning = source?.content
              .filter((part) => part.type === "reasoning")
              .map((part) => part.text)
              .join("")
            const reasoningDetails = Array.isArray(message.reasoning_details)
              ? normalizeReasoningDetails(message.reasoning_details, seenReasoningDetails)
              : undefined
            return {
              ...message,
              reasoning_content: undefined,
              reasoning_text: undefined,
              reasoning: reasoning && reasoningDetails && reasoningDetails.length > 0 ? reasoning : undefined,
              reasoning_details: reasoningDetails,
            }
          })
          return {
            ...body,
            messages,
            ...bodyOptions(request.providerOptions?.openrouter),
          } as OpenRouterBody
        }),
      ),
  },
  stream: OpenAIChat.protocol.stream,
})

const bodyOptions = (input: unknown) => {
  const openrouter = isRecord(input) ? input : {}
  return {
    ...(openrouter.usage === true
      ? { usage: { include: true } }
      : isRecord(openrouter.usage)
        ? { usage: openrouter.usage }
        : {}),
    ...(isRecord(openrouter.reasoning) ? { reasoning: openrouter.reasoning } : {}),
    ...(typeof openrouter.promptCacheKey === "string" ? { prompt_cache_key: openrouter.promptCacheKey } : {}),
  }
}

const normalizeReasoningDetails = (details: ReadonlyArray<unknown>, seen: Set<string>) =>
  details
    .filter((detail) => {
      if (!isRecord(detail)) return false
      if (detail.id !== undefined && detail.id !== null && typeof detail.id !== "string") return false
      if (
        detail.format !== undefined &&
        detail.format !== null &&
        (typeof detail.format !== "string" || !REASONING_FORMATS.has(detail.format))
      )
        return false
      if (detail.index !== undefined && (typeof detail.index !== "number" || !Number.isFinite(detail.index)))
        return false
      if (detail.type === "reasoning.summary") return typeof detail.summary === "string"
      if (detail.type === "reasoning.encrypted") return typeof detail.data === "string"
      if (detail.type !== "reasoning.text") return false
      if (detail.text !== undefined && detail.text !== null && typeof detail.text !== "string") return false
      return detail.signature === undefined || detail.signature === null || typeof detail.signature === "string"
    })
    .reduce<unknown[]>((result, detail) => {
      const previous = result.at(-1)
      if (
        !isRecord(previous) ||
        previous.type !== "reasoning.text" ||
        !isRecord(detail) ||
        detail.type !== "reasoning.text"
      ) {
        result.push(detail)
        return result
      }
      result[result.length - 1] = {
        ...previous,
        text: `${typeof previous.text === "string" ? previous.text : ""}${typeof detail.text === "string" ? detail.text : ""}`,
        signature: previous.signature || detail.signature,
        format: previous.format || detail.format,
      }
      return result
    }, [])
    .filter((detail) => {
      if (!isRecord(detail)) return false
      if (detail.type === "reasoning.text") {
        const format = typeof detail.format === "string" ? detail.format : "anthropic-claude-v1"
        if ((format === "anthropic-claude-v1" || format === "google-gemini-v1") && !detail.signature) return false
      }
      const key = (() => {
        if (detail.type === "reasoning.summary" && typeof detail.summary === "string") return detail.summary
        if (detail.type === "reasoning.encrypted" && typeof detail.data === "string")
          return typeof detail.id === "string" && detail.id ? detail.id : detail.data
        if (detail.type === "reasoning.text") {
          if (typeof detail.text === "string" && detail.text) return detail.text
          if (typeof detail.signature === "string" && detail.signature) return detail.signature
        }
      })()
      if (key === undefined || seen.has(key)) return false
      seen.add(key)
      return true
    })

export const route = Route.make({
  id: ADAPTER,
  provider: profile.provider,
  protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: profile.baseURL }),
  framing: Framing.sse,
})

export const routes = [route]

const configuredRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return route.with({
    ...rest,
    endpoint: { baseURL: baseURL ?? profile.baseURL },
    auth: AuthOptions.bearer(input, "OPENROUTER_API_KEY"),
  })
}

export const configure = (input: ModelOptions = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model = provider.model
