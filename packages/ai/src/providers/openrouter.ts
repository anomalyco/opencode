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
          let assistantIndex = 0
          const messages = body.messages.map((message) => {
            if (message.role !== "assistant") return message
            const source = sourceAssistants[assistantIndex++]
            const reasoning = source?.content
              .filter((part) => part.type === "reasoning")
              .map((part) => part.text)
              .join("")
            const reasoningDetails = Array.isArray(message.reasoning_details)
              ? mergeReasoningDetails(message.reasoning_details)
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

const mergeReasoningDetails = (details: ReadonlyArray<unknown>) =>
  details.reduce<unknown[]>((result, detail) => {
    const previous = result.at(-1)
    if (
      !isRecord(previous) ||
      previous.type !== "reasoning.text" ||
      !isRecord(detail) ||
      detail.type !== "reasoning.text" ||
      conflictingReasoningTextDetails(previous, detail)
    ) {
      result.push(detail)
      return result
    }
    result[result.length - 1] = {
      ...previous,
      ...Object.fromEntries(Object.entries(detail).filter((entry) => entry[1] !== undefined)),
      text: `${typeof previous.text === "string" ? previous.text : ""}${typeof detail.text === "string" ? detail.text : ""}`,
      signature: mergeDetailValue(previous.signature, detail.signature),
      format: mergeDetailValue(previous.format, detail.format),
    }
    return result
  }, [])

const mergeDetailValue = (previous: unknown, current: unknown) =>
  previous || current || (previous !== undefined ? previous : current)

const conflictingReasoningTextDetails = (previous: Record<string, unknown>, current: Record<string, unknown>) =>
  conflictingDetailValue(previous.id, current.id) ||
  conflictingDetailValue(previous.index, current.index) ||
  conflictingDetailValue(previous.format, current.format) ||
  (Boolean(previous.signature) && Boolean(current.signature) && previous.signature !== current.signature)

const conflictingDetailValue = (previous: unknown, current: unknown) =>
  previous !== undefined && previous !== null && current !== undefined && current !== null && previous !== current

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
