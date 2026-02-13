/**
 * RLM Provider - LanguageModelV2 implementation that wraps the RLM engine.
 *
 * This provider makes RLM appear as a standard Vercel AI SDK language model.
 * When streamText() or generateText() calls this model:
 *
 * 1. doStream() runs the full RLM iterative loop internally via rlmCompletion()
 * 2. Each iteration's reasoning/code execution is emitted as reasoning deltas
 * 3. The final answer is emitted as text deltas
 * 4. The model appears to "think" (reasoning) then produce output (text)
 *
 * This enables seamless integration with OpenCode's existing UI:
 * - The reasoning pane shows RLM iterations (LLM responses + REPL output)
 * - The text output shows the final answer
 *
 * The actual RLM loop logic lives in rlm.ts (rlmCompletion). This file
 * only handles the LanguageModelV2 interface and stream part emission.
 */

import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider"
import { Provider } from "@/provider/provider"
import { formatExecutionResult } from "./parsing"
import { rlmCompletion } from "./rlm"
import type { RLMConfig } from "./types"
import { Log } from "@/util/log"
import * as REPLManager from "./repl-manager"

const log = Log.create({ service: "rlm-provider" })

/** Counter for generating unique stream part IDs */
let streamIdCounter = 0
function nextId(prefix: string): string {
  return `${prefix}-${++streamIdCounter}`
}

export interface RLMProviderOptions {
  /** The underlying model to use for the RLM loop */
  model: Provider.Model
  /** Optional different model for sub-LLM queries from REPL */
  subModel?: Provider.Model
  /** RLM configuration */
  config?: Partial<RLMConfig>
  /** Optional session ID for shared REPL across sub-agents.
   *  When set, the provider will look up or create a REPL via REPLManager. */
  sessionID?: string
}

/**
 * Create an RLM LanguageModelV2 provider.
 *
 * Usage:
 *   const rlmModel = createRLMProvider({ model: myModel })
 *   const result = await streamText({ model: rlmModel, messages: [...] })
 */
export function createRLMProvider(options: RLMProviderOptions): LanguageModelV2 {
  return {
    specificationVersion: "v2" as const,
    provider: "rlm",
    modelId: `rlm:${options.model.id}`,
    supportedUrls: {},

    async doGenerate(callOptions: LanguageModelV2CallOptions) {
      const { messages: ctxMessages, userQuery } = extractStructuredContext(callOptions)
      const repl = options.sessionID ? REPLManager.get(options.sessionID) : undefined

      const result = await rlmCompletion({
        prompt: ctxMessages,
        rootPrompt: userQuery,
        model: options.model,
        subModel: options.subModel,
        config: options.config,
        abort: callOptions.abortSignal,
        repl,
      })

      const inputTokens = computeInputTokens(result.usageSummary)
      const outputTokens = computeOutputTokens(result.usageSummary)

      return {
        content: [{ type: "text" as const, text: result.response }],
        finishReason: "stop" as const,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        warnings: [],
      }
    },

    async doStream(callOptions: LanguageModelV2CallOptions) {
      const { messages: ctxMessages, userQuery } = extractStructuredContext(callOptions)
      const repl = options.sessionID ? REPLManager.get(options.sessionID) : undefined

      // Create a TransformStream to produce stream parts
      const { readable, writable } = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>()
      const writer = writable.getWriter()

      // Track the current reasoning ID so hooks can reference it
      let currentReasoningId: string | undefined

      // Run rlmCompletion in the background with hooks that emit stream parts
      const streamPromise = (async () => {
        try {
          await writer.write({ type: "stream-start" as const, warnings: [] })

          const result = await rlmCompletion({
            prompt: ctxMessages,
            rootPrompt: userQuery,
            model: options.model,
            subModel: options.subModel,
            config: options.config,
            abort: callOptions.abortSignal,
            repl,
            hooks: {
              async onIterationStart(iterationIndex) {
                currentReasoningId = nextId("rlm-reasoning")
                await writer.write({
                  type: "reasoning-start" as const,
                  id: currentReasoningId,
                })
              },

              async onLLMResponse(iterationIndex, response) {
                if (!currentReasoningId) return
                await writer.write({
                  type: "reasoning-delta" as const,
                  id: currentReasoningId,
                  delta: `--- Iteration ${iterationIndex + 1} ---\n${response}\n`,
                })
              },

              async onCodeExecuted(iterationIndex, code, codeResult) {
                if (!currentReasoningId) return
                const resultStr = formatExecutionResult(codeResult)
                await writer.write({
                  type: "reasoning-delta" as const,
                  id: currentReasoningId,
                  delta: `\n[REPL] ${code.slice(0, 50)}...\n${resultStr}\n`,
                })
              },

              async onIterationEnd(_iteration, _iterationIndex) {
                if (!currentReasoningId) return
                await writer.write({
                  type: "reasoning-end" as const,
                  id: currentReasoningId,
                })
                currentReasoningId = undefined
              },

              async onMaxIterationsReached(maxIterations) {
                const maxReasoningId = nextId("rlm-max-reasoning")
                await writer.write({ type: "reasoning-start" as const, id: maxReasoningId })
                await writer.write({
                  type: "reasoning-delta" as const,
                  id: maxReasoningId,
                  delta: `\n--- Max iterations (${maxIterations}) reached, generating final answer ---\n`,
                })
                await writer.write({ type: "reasoning-end" as const, id: maxReasoningId })
              },
            },
          })

          // Stream the final answer as text deltas
          const textId = nextId("rlm-text")
          await writer.write({ type: "text-start" as const, id: textId })

          const chunkSize = 50
          for (let j = 0; j < result.response.length; j += chunkSize) {
            await writer.write({
              type: "text-delta" as const,
              id: textId,
              delta: result.response.slice(j, j + chunkSize),
            })
          }

          await writer.write({ type: "text-end" as const, id: textId })

          const inputTokens = computeInputTokens(result.usageSummary)
          const outputTokens = computeOutputTokens(result.usageSummary)

          await writer.write({
            type: "finish" as const,
            finishReason: "stop" as const,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            providerMetadata: {
              rlm: {
                iterations: result.iterations,
                executionTime: result.executionTime,
              },
            },
          })
        } catch (error) {
          try {
            await writer.write({
              type: "error",
              error: error instanceof Error ? error : new Error(String(error)),
            })
          } catch {
            // Writer may be closed
          }
        } finally {
          try {
            await writer.close()
          } catch {
            // Already closed
          }
        }
      })()

      return {
        stream: readable,
        request: undefined,
        response: undefined,
      }
    },
  }
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Structured message for RLM context.
 * All message types are preserved so the LLM can query them
 * programmatically via the REPL (e.g. context.messages.filter(...)).
 */
interface ContextMessage {
  role: string
  content: string
  toolName?: string
  toolCallId?: string
}

/**
 * Extract ALL messages from the call options prompt into a structured
 * JSON object. This preserves system prompts, assistant responses,
 * tool calls, and tool results — enabling the LLM to programmatically
 * query the full conversation history via the REPL sandbox.
 *
 * Returns an object like:
 * { messages: [...], userQuery: "the latest user message" }
 */
function extractStructuredContext(callOptions: LanguageModelV2CallOptions): {
  messages: ContextMessage[]
  userQuery: string
} {
  const prompt = callOptions.prompt ?? []
  const messages: ContextMessage[] = []
  let lastUserText = ""

  for (const msg of prompt) {
    if (msg.role === "system") {
      messages.push({ role: "system", content: msg.content })
    }

    if (msg.role === "user") {
      const parts: string[] = []
      for (const part of msg.content) {
        if (part.type === "text") parts.push(part.text)
      }
      const text = parts.join("\n")
      messages.push({ role: "user", content: text })
      lastUserText = text
    }

    if (msg.role === "assistant") {
      const parts: string[] = []
      for (const part of msg.content) {
        if (part.type === "text") parts.push(part.text)
        if (part.type === "tool-call") {
          messages.push({
            role: "tool-call",
            content: JSON.stringify(part.input),
            toolName: part.toolName,
            toolCallId: part.toolCallId,
          })
        }
      }
      const text = parts.join("\n")
      if (text) messages.push({ role: "assistant", content: text })
    }

    if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const content = serializeToolOutput(part.output)
          messages.push({
            role: "tool-result",
            content,
            toolName: part.toolName,
            toolCallId: part.toolCallId,
          })
        }
      }
    }
  }

  return { messages, userQuery: lastUserText }
}

/**
 * Serialize a LanguageModelV2ToolResultOutput to a string.
 */
function serializeToolOutput(output: unknown): string {
  if (!output || typeof output !== "object") return String(output ?? "")
  const o = output as { type?: string; value?: unknown }
  if (o.type === "text" || o.type === "error-text") return String(o.value ?? "")
  if (o.type === "json" || o.type === "error-json") return JSON.stringify(o.value)
  if (o.type === "content" && Array.isArray(o.value)) {
    return o.value
      .map((item: { type?: string; text?: string }) => (item.type === "text" ? item.text ?? "" : ""))
      .join("\n")
  }
  return JSON.stringify(output)
}

/**
 * Compute total input tokens from usage summary.
 */
function computeInputTokens(usage: import("./types").UsageSummary): number {
  let total = 0
  for (const model of Object.values(usage.modelUsageSummaries)) {
    total += model.totalInputTokens
  }
  return total
}

/**
 * Compute total output tokens from usage summary.
 */
function computeOutputTokens(usage: import("./types").UsageSummary): number {
  let total = 0
  for (const model of Object.values(usage.modelUsageSummaries)) {
    total += model.totalOutputTokens
  }
  return total
}
