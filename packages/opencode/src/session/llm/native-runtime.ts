import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { asSchema, type ModelMessage, type Tool } from "ai"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { tool as nativeTool, ToolFailure, type JsonSchema, type LLMEvent } from "@opencode-ai/llm"
import type { LLMClientShape } from "@opencode-ai/llm/route"
import { LLMNative } from "./native-request"

export type RuntimeStatus =
  | { readonly type: "supported"; readonly apiKey: string; readonly baseURL?: string }
  | { readonly type: "unsupported"; readonly reason: string }
export type StreamResult =
  | { readonly type: "supported"; readonly stream: Stream.Stream<LLMEvent, unknown> }
  | { readonly type: "unsupported"; readonly reason: string }

type StreamInput = {
  readonly model: Provider.Model
  readonly provider: Provider.Info
  readonly auth: Auth.Info | undefined
  readonly llmClient: LLMClientShape
  readonly isOpenaiOauth: boolean
  readonly system: string[]
  readonly messages: ModelMessage[]
  readonly tools: Record<string, Tool>
  readonly toolChoice?: "auto" | "required" | "none"
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly maxOutputTokens?: number
  readonly providerOptions?: Record<string, any>
  readonly headers: Record<string, string>
  readonly abort: AbortSignal
}

export function status(input: Pick<StreamInput, "model" | "provider" | "auth">): RuntimeStatus {
  if (input.model.providerID !== "openai" && !input.model.providerID.startsWith("opencode"))
    return { type: "unsupported", reason: "provider is not openai or opencode" }
  if (input.model.api.npm !== "@ai-sdk/openai") return { type: "unsupported", reason: "provider package is not OpenAI" }
  if (input.auth?.type === "oauth") return { type: "unsupported", reason: "OAuth auth is not supported" }

  const apiKey =
    input.auth?.type === "api"
      ? input.auth.key
      : typeof input.provider.options.apiKey === "string"
        ? input.provider.options.apiKey
        : undefined
  if (!apiKey) return { type: "unsupported", reason: "OpenAI API key is not configured" }

  return {
    type: "supported",
    apiKey,
    baseURL: typeof input.provider.options.baseURL === "string" ? input.provider.options.baseURL : undefined,
  }
}

export function stream(input: StreamInput): StreamResult {
  const current = status(input)
  if (current.type === "unsupported") return current

  return {
    ...current,
    stream: input.llmClient.stream({
      request: LLMNative.request({
        model: input.model,
        apiKey: current.apiKey,
        baseURL: current.baseURL,
        system: input.isOpenaiOauth ? input.system : [],
        messages: ProviderTransform.message(input.messages, input.model, input.providerOptions ?? {}),
        toolChoice: input.toolChoice,
        temperature: input.temperature,
        topP: input.topP,
        topK: input.topK,
        maxOutputTokens: input.maxOutputTokens,
        providerOptions: ProviderTransform.providerOptions(input.model, input.providerOptions ?? {}),
        headers: { ...providerHeaders(input.provider.options.headers), ...input.headers },
      }),
      tools: nativeTools(input.tools, input),
    }),
  }
}

function providerHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function nativeSchema(value: unknown): JsonSchema {
  if (!value || typeof value !== "object") return { type: "object", properties: {} }
  if ("jsonSchema" in value && value.jsonSchema && typeof value.jsonSchema === "object")
    return value.jsonSchema as JsonSchema
  return asSchema(value as Parameters<typeof asSchema>[0]).jsonSchema as JsonSchema
}

export function nativeTools(tools: Record<string, Tool>, input: Pick<StreamInput, "messages" | "abort">) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, item]) => [
      name,
      nativeTool({
        description: item.description ?? "",
        jsonSchema: nativeSchema(item.inputSchema),
        execute: (args: unknown, ctx) =>
          Effect.tryPromise({
            try: () => {
              if (!item.execute) throw new Error(`Tool has no execute handler: ${name}`)
              return item.execute(args, {
                toolCallId: ctx?.id ?? name,
                messages: input.messages,
                abortSignal: input.abort,
              })
            },
            catch: (error) => new ToolFailure({ message: errorMessage(error), error }),
          }),
      }),
    ]),
  )
}

export * as LLMNativeRuntime from "./native-runtime"
