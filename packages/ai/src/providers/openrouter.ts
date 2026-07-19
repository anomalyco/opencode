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
            if (!Array.isArray(message.reasoning_details)) return message
            const detailParts =
              source?.content.filter(
                (part) => part.type === "reasoning" && Array.isArray(part.providerMetadata?.openai?.reasoningDetails),
              ).length ?? 0
            if (detailParts > 1)
              return {
                ...message,
                reasoning_details: source?.content.flatMap((part) => {
                  if (part.type !== "reasoning") return []
                  const details = part.providerMetadata?.openai?.reasoningDetails
                  return Array.isArray(details) ? mergeReasoningTextDetails(details) : []
                }),
              }
            // OpenRouter streams one logical signed block as text fragments followed by its signature.
            // Replaying those wire fragments separately is rejected as an invalid thinking signature.
            return {
              ...message,
              reasoning_details: mergeReasoningTextDetails(message.reasoning_details),
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

const reasoningTextKeys = new Set(["type", "id", "index", "format", "text", "signature"])

const mergeReasoningTextDetails = (details: ReadonlyArray<unknown>) =>
  details.reduce<unknown[]>((merged, detail) => {
    const previous = merged.at(-1)
    const previousID = isRecord(previous) && typeof previous.id === "string" && previous.id ? previous.id : undefined
    const detailID = isRecord(detail) && typeof detail.id === "string" && detail.id ? detail.id : undefined
    const sameID = previousID !== undefined && detailID !== undefined && previousID === detailID
    const sameIndex =
      isRecord(previous) &&
      isRecord(detail) &&
      typeof previous.index === "number" &&
      previous.index === detail.index &&
      typeof previous.format === "string" &&
      previous.format === detail.format
    const conflictingIdentity =
      isRecord(previous) &&
      isRecord(detail) &&
      ((previousID !== undefined && detailID !== undefined && previousID !== detailID) ||
        (!sameID && previous.index !== undefined && detail.index !== undefined && previous.index !== detail.index) ||
        (!sameID && previous.format !== undefined && detail.format !== undefined && previous.format !== detail.format))
    const conflictingExtra =
      isRecord(previous) &&
      isRecord(detail) &&
      Object.keys(previous).some(
        (key) =>
          !reasoningTextKeys.has(key) &&
          previous[key] !== undefined &&
          detail[key] !== undefined &&
          !sameDetailValue(previous[key], detail[key]),
      )
    if (
      !isRecord(previous) ||
      !isRecord(detail) ||
      previous.type !== "reasoning.text" ||
      detail.type !== "reasoning.text" ||
      (!sameID && !sameIndex) ||
      conflictingIdentity ||
      conflictingExtra ||
      (typeof previous.signature === "string" && previous.signature.length > 0) ||
      (previous.signature && detail.signature && previous.signature !== detail.signature)
    ) {
      merged.push(detail)
      return merged
    }
    const definedDetail = Object.fromEntries(Object.entries(detail).filter((entry) => entry[1] !== undefined))
    merged[merged.length - 1] = {
      ...previous,
      ...definedDetail,
      text: `${typeof previous.text === "string" ? previous.text : ""}${typeof detail.text === "string" ? detail.text : ""}`,
      ...(previousID ? { id: previousID } : {}),
      ...(previous.index !== undefined ? { index: previous.index } : {}),
      ...(previous.signature ? { signature: previous.signature } : {}),
      ...(previous.format !== undefined ? { format: previous.format } : {}),
    }
    return merged
  }, [])

const sameDetailValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => sameDetailValue(value, right[index]))
  if (!isRecord(left) || !isRecord(right)) return false
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameDetailValue(left[key], right[key]))
  )
}

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
