import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  streamText,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  extractReasoningMiddleware,
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
import { TraceLogger } from "@/util/trace-logger"
import { PermissionNext } from "@/permission/next"

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
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
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
    const [language, cfg] = await Promise.all([Provider.getLanguage(input.model), Config.get()])

    const system = SystemPrompt.header(input.model.providerID)
    system.push(
      [
        // use agent prompt otherwise provider prompt
        ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
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
    await Plugin.trigger("experimental.chat.system.transform", {}, { system })
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const provider = await Provider.getProvider(input.model.providerID)
    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options(input.model, input.sessionID, provider.options)
    const options = pipe(base, mergeDeep(input.model.options), mergeDeep(input.agent.options), mergeDeep(variant))

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider: Provider.getProvider(input.model.providerID),
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

    l.info("params", {
      params,
    })

    const maxOutputTokens = ProviderTransform.maxOutputTokens(
      input.model.api.npm,
      params.options,
      input.model.limit.output,
      OUTPUT_TOKEN_MAX,
    )

    const tools = await resolveTools(input)

    // Create trace entry if tracing is enabled
    const traceEntry = TraceLogger.isEnabled()
      ? TraceLogger.createTraceEntry({
          sessionID: input.sessionID,
          providerID: input.model.providerID,
          modelID: input.model.id,
          agent: input.agent.name,
          system: system,
          messages: input.messages,
          tools: tools,
          parameters: {
            temperature: params.temperature,
            topP: params.topP,
            topK: params.topK,
            maxOutputTokens: maxOutputTokens,
            options: params.options,
          },
        })
      : undefined

    const startTime = Date.now()

    const streamResult = streamText({
      onError(error) {
        l.error("stream error", {
          error,
        })
        // Log trace with error if tracing is enabled
        if (traceEntry) {
          TraceLogger.updateTraceWithResponse(traceEntry, {
            error: error instanceof Error ? error : new Error(String(error)),
            duration: Date.now() - startTime,
          })
          TraceLogger.logTrace(traceEntry)
        }
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
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(input.model.providerID.startsWith("opencode")
          ? {
              "x-opencode-project": Instance.project.id,
              "x-opencode-session": input.sessionID,
              "x-opencode-request": input.user.id,
              "x-opencode-client": Flag.OPENCODE_CLIENT,
            }
          : undefined),
        ...input.model.headers,
      },
      maxRetries: input.retries ?? 0,
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                // @ts-expect-error
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model)
              }
              return args.params
            },
          },
          extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
        ],
      }),
      experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
    })

    // Wrap the result to capture trace data if tracing is enabled
    if (traceEntry) {
      const originalFullStream = streamResult.fullStream

      // Collect response data as stream progresses
      const responseData: {
        text: string
        toolCalls: Array<{ id: string; name: string; input: any }>
        reasoning: string[]
        finishReason?: string
        usage?: any
      } = {
        text: "",
        toolCalls: [],
        reasoning: [],
      }

      let currentReasoning = ""

      // Wrap fullStream to collect data
      const wrappedStream = (async function* () {
        try {
          for await (const chunk of originalFullStream) {
            // Collect response data based on chunk type
            if ("type" in chunk) {
              switch (chunk.type) {
                case "text-delta":
                  if ("text" in chunk && chunk.text && typeof chunk.text === "string") {
                    responseData.text += chunk.text
                  }
                  break
                case "reasoning-start":
                  currentReasoning = ""
                  break
                case "reasoning-delta":
                  if ("text" in chunk && chunk.text && typeof chunk.text === "string") {
                    currentReasoning += chunk.text
                  }
                  break
                case "reasoning-end":
                  if (currentReasoning) {
                    responseData.reasoning.push(currentReasoning)
                    currentReasoning = ""
                  }
                  break
                case "tool-call":
                  if ("toolCallId" in chunk && "toolName" in chunk && "input" in chunk) {
                    responseData.toolCalls.push({
                      id: chunk.toolCallId as string,
                      name: chunk.toolName as string,
                      input: chunk.input,
                    })
                  }
                  break
                case "finish-step":
                  if ("finishReason" in chunk) {
                    responseData.finishReason = chunk.finishReason as string
                  }
                  if ("usage" in chunk) {
                    responseData.usage = chunk.usage
                  }
                  // Log trace when stream finishes
                  TraceLogger.updateTraceWithResponse(traceEntry, {
                    finishReason: responseData.finishReason,
                    usage: responseData.usage,
                    content: {
                      text: responseData.text ? [responseData.text] : undefined,
                      toolCalls: responseData.toolCalls.length > 0 ? responseData.toolCalls : undefined,
                      reasoning: responseData.reasoning.length > 0 ? responseData.reasoning : undefined,
                    },
                    duration: Date.now() - startTime,
                  })
                  await TraceLogger.logTrace(traceEntry)
                  break
              }
            }
            yield chunk
          }
        } catch (error) {
          // Log trace with error
          if (error instanceof Error) {
            TraceLogger.updateTraceWithResponse(traceEntry, {
              error,
              duration: Date.now() - startTime,
            })
            await TraceLogger.logTrace(traceEntry)
          }
          throw error
        }
      })()

      // Create a proxy to wrap the stream result with our traced fullStream
      return new Proxy(streamResult, {
        get(target, prop) {
          if (prop === "fullStream") {
            return wrappedStream
          }
          return Reflect.get(target, prop)
        },
      })
    }

    return streamResult
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
}
