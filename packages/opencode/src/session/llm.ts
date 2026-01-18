import os from "os"
import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  APICallError,
  streamText,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  extractReasoningMiddleware,
  tool,
  jsonSchema,
} from "ai"
import { clone, mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"
import { OpenAIConversationState } from "./openai-conversation"

export namespace LLM {
  const log = Log.create({ service: "llm" })

  export const OUTPUT_TOKEN_MAX = Flag.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    messagesFallback?: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    previousResponseId?: string
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const system = SystemPrompt.header(input.model.providerID)
    system.push(
      [
        // use agent prompt otherwise provider prompt
        // For Codex sessions, skip SystemPrompt.provider() since it's sent via options.instructions
        ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    const original = clone(system)
    await Plugin.trigger("experimental.chat.system.transform", { sessionID: input.sessionID }, { system })
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
    }

    const useOpenAIConversationState =
      !isCodex && OpenAIConversationState.isGPTModel(input.model) && input.model.api.npm === "@ai-sdk/openai"
    if (useOpenAIConversationState) {
      options.store = true
      if (input.previousResponseId) {
        options.previousResponseId = input.previousResponseId
      }
      options.instructions = system.join("\n\n")
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const maxOutputTokens = isCodex
      ? undefined
      : ProviderTransform.maxOutputTokens(
          input.model.api.npm,
          params.options,
          input.model.limit.output,
          OUTPUT_TOKEN_MAX,
        )

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    function isInvalidPreviousResponseIdError(err: unknown): boolean {
      if (!APICallError.isInstance(err)) return false
      const status = err.statusCode
      if (status !== 400 && status !== 404) return false
      const haystack = [err.message, err.responseBody].filter(Boolean).join("\n").toLowerCase()
      return haystack.includes("previous_response_id") || haystack.includes("previousresponseid")
    }

    const activeTools = Object.keys(tools).filter((x) => x !== "invalid" && x !== "_noop")

    async function createStream(args: { messages: ModelMessage[]; providerOptionsBase: Record<string, any> }) {
      const providerOptions = ProviderTransform.providerOptions(input.model, args.providerOptionsBase)
      return streamText({
        onError(error) {
          l.error("stream error", {
            error,
          })
        },
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && tools[lower]) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: lower,
            })
            return {
              ...failed.toolCall,
              toolName: lower,
            }
          }
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
        },
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        providerOptions,
        activeTools,
        tools,
        maxOutputTokens,
        abortSignal: input.abort,
        headers: {
          ...(isCodex
            ? {
                originator: "opencode",
                "User-Agent": `opencode/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
                session_id: input.sessionID,
              }
            : undefined),
          ...(input.model.providerID.startsWith("opencode")
            ? {
                "x-opencode-project": Instance.project.id,
                "x-opencode-session": input.sessionID,
                "x-opencode-request": input.user.id,
                "x-opencode-client": Flag.OPENCODE_CLIENT,
              }
            : input.model.providerID !== "anthropic"
              ? {
                  "User-Agent": `opencode/${Installation.VERSION}`,
                }
              : undefined),
          ...input.model.headers,
        },
        maxRetries: input.retries ?? 0,
        messages: [
          ...(isCodex
            ? [
                {
                  role: "user",
                  content: system.join("\n\n"),
                } as ModelMessage,
              ]
            : useOpenAIConversationState
              ? []
              : system.map(
                  (x): ModelMessage => ({
                    role: "system",
                    content: x,
                  }),
                )),
          ...args.messages,
        ],
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              async transformParams(inner) {
                if (inner.type === "stream") {
                  // @ts-expect-error
                  inner.params.prompt = ProviderTransform.message(inner.params.prompt, input.model, options)
                }
                return inner.params
              },
            },
            extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
          ],
        }),
        experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
      })
    }

    const initial = await createStream({
      messages: input.messages,
      providerOptionsBase: params.options,
    })

    const shouldEnableFallbackRetry = useOpenAIConversationState && !!input.previousResponseId && !!input.messagesFallback
    if (!shouldEnableFallbackRetry) return initial

    async function* fullStreamWithFallback() {
      const buffer: any[] = []
      let committed = false
      for await (const value of initial.fullStream) {
        const shouldCommit =
          value.type === "text-start" ||
          value.type === "reasoning-start" ||
          value.type === "tool-input-start" ||
          value.type === "tool-call"

        if (!committed) {
          if (value.type === "error") {
            if (isInvalidPreviousResponseIdError(value.error)) {
              l.info("retrying without previousResponseId", {
                sessionID: input.sessionID,
                modelID: input.model.id,
              })

              const fallbackProviderOptions = { ...(params.options ?? {}) }
              delete fallbackProviderOptions.previousResponseId
              fallbackProviderOptions.store = true

              const fallback = await createStream({
                messages: input.messagesFallback!,
                providerOptionsBase: fallbackProviderOptions,
              })
              for await (const next of fallback.fullStream) {
                yield next
              }
              return
            }

            // Commit buffered events before surfacing the error.
            for (const item of buffer) yield item
            yield value
            return
          }

          buffer.push(value)
          if (shouldCommit) {
            committed = true
            for (const item of buffer) yield item
            buffer.length = 0
          }
          continue
        }

        if (value.type === "error") {
          yield value
          continue
        }

        yield value
      }

      for (const item of buffer) yield item
    }

    return {
      ...initial,
      fullStream: fullStreamWithFallback(),
    }
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}
