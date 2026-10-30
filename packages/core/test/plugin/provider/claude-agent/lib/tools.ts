export * as TestTools from "./tools"

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultPart,
} from "@ai-sdk/provider"
import type { SessionRequestKind } from "@opencode/plugin/effect/session"
import { Effect } from "effect"
import type { ClaudeAgentLanguageModel } from "@opencode/core/plugin/provider/claude-agent/language-model/claude-agent-language-model"
import { RequestKind } from "@opencode/core/plugin/provider/claude-agent/language-model/request-kind"
import { TestSessions } from "./sessions"

export const tools: LanguageModelV3FunctionTool[] = [
  {
    type: "function",
    name: "lookup",
    description: "Look up a fixture marker by key.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", enum: ["a", "b"] } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "confirm",
    description: "Confirm the two looked-up markers and get the final marker.",
    inputSchema: {
      type: "object",
      properties: { markers: { type: "array", items: { type: "string" } } },
      required: ["markers"],
      additionalProperties: false,
    },
  },
]

export const prompt = () =>
  TestSessions.prompt(
    "Call lookup twice in a single response, once with key a and once with key b. After both results, call confirm with those two markers. Then reply only with the final marker returned by confirm.",
  )

export const step = Effect.fn(function* (
  model: ClaudeAgentLanguageModel.Model,
  prompt: LanguageModelV3Prompt,
  offered = tools,
  kind: SessionRequestKind = "primary",
  providerOptions?: LanguageModelV3CallOptions["providerOptions"],
) {
  const result = yield* Effect.promise(() =>
    model.doStream({
      prompt,
      tools: offered,
      headers: { [RequestKind.SESSION_HEADER]: "session-a", [RequestKind.HEADER]: kind },
      providerOptions,
    }),
  )
  const parts = yield* Effect.tryPromise(() => TestSessions.collect(result.stream))
  const error = parts.find((part) => part.type === "error")
  if (error) throw error.error
  return parts
})

export function append(
  prompt: LanguageModelV3Prompt,
  parts: readonly LanguageModelV3StreamPart[],
  result: (name: string, input: any) => LanguageModelV3ToolResultPart["output"],
  providerOptions?: LanguageModelV3ToolResultPart["providerOptions"],
) {
  const content: Extract<LanguageModelV3Prompt[number], { role: "assistant" }>["content"] = []
  const outputs: LanguageModelV3ToolResultPart[] = []
  for (const part of parts) {
    if (part.type === "text-delta") content.push({ type: "text", text: part.delta })
    if (part.type === "tool-call") {
      const input = JSON.parse(part.input)
      content.push({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input })
      outputs.push({
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: result(part.toolName, input),
        providerOptions,
      })
    }
  }
  prompt.push({ role: "assistant", content })
  if (outputs.length) prompt.push({ role: "tool", content: outputs })
}

export function output(name: string, input: any): LanguageModelV3ToolResultPart["output"] {
  return { type: "text", value: name === "confirm" ? "COPPER-OTTER" : input.key === "a" ? "LILAC-HERON" : "LEMON-IBIS" }
}
