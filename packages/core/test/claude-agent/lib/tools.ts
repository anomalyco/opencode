export * as TestTools from "./tools"

import type {
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolResultPart,
} from "@ai-sdk/provider"
import { Effect } from "effect"
import type { ClaudeAgentLanguageModel } from "@opencode/core/claude-agent/language-model/claude-agent-language-model"
import { RequestKind } from "@opencode/core/claude-agent/language-model/request-kind"
import { TestSessions } from "./sessions"
import type { ClaudeIO } from "@opencode/core/claude-agent/claude/io"
import { ClaudeSession } from "@opencode/core/claude-agent/claude/session"
import { ClaudeQueryOptions } from "@opencode/core/claude-agent/claude/query-options"
import { ClaudeSystemPrompt } from "@opencode/core/claude-agent/language-model/system-prompt"
import { ConvertToClaudeMessage } from "@opencode/core/claude-agent/language-model/convert-to-claude-message"
import { PendingTools } from "@opencode/core/claude-agent/tools/pending"
import { ToolHooks } from "@opencode/core/claude-agent/tools/hooks"
import { ToolServer } from "@opencode/core/claude-agent/tools/server"

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

// Observe the real MCP handler, rather than assuming an emitted tool call has already reached it.
export const park = Effect.fn(function* (io: ClaudeIO.Interface, directory: string) {
  const pending = PendingTools.make()
  const entered = Promise.withResolvers<void>()
  const settled = Promise.withResolvers<void>()
  const session = yield* Effect.promise(() =>
    ClaudeSession.start({
      ...ClaudeQueryOptions.base({ executable: io.which()!, io }),
      cwd: directory,
      model: "haiku",
      sessionId: crypto.randomUUID(),
      includePartialMessages: true,
      systemPrompt: ClaudeSystemPrompt.make(prompt(), true),
      hooks: ToolHooks.make(pending),
      mcpServers: {
        opencode: ToolServer.make(tools, {
          ...pending,
          async call(name) {
            const result = pending.call(name)
            entered.resolve()
            return result.finally(() => settled.resolve())
          },
        }),
      },
    }),
  )
  yield* Effect.addFinalizer(() => Effect.promise(() => session.stop().finally(() => pending.clear())))
  yield* Effect.promise(() => session.ready)
  session.begin(ConvertToClaudeMessage.content(prompt()))
  const boundary = yield* Effect.promise(() => session.readStep(() => {}))
  if (boundary !== "tools") throw new Error("Expected a tool step")
  yield* Effect.promise(() => entered.promise)
  return { session, pending, settled: settled.promise }
})

export const step = Effect.fn(function* (
  model: ClaudeAgentLanguageModel.Model,
  prompt: LanguageModelV3Prompt,
  offered = tools,
  kind: RequestKind.Kind = "primary",
) {
  const result = yield* Effect.promise(() =>
    model.doStream({
      prompt,
      tools: offered,
      headers: { [RequestKind.SESSION_HEADER]: "session-a", [RequestKind.HEADER]: kind },
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
