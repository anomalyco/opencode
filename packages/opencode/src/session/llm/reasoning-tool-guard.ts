import type { LanguageModelV3Middleware, LanguageModelV3StreamPart } from "@ai-sdk/provider"

// Some reasoning models (Qwen, Kimi K2, GLM, ...) occasionally emit tool-call
// markup *inside* their reasoning block while still "thinking". The inference
// server promotes that to a structured tool call, and the AI SDK would then
// execute it prematurely — running a side effect and ending the turn before the
// model ever produces its real answer (see anomalyco/opencode#8851, #6708,
// #10996).
//
// This transform sits in the language-model middleware, *before* streamText
// interprets and executes tool calls. It drops any tool call that begins while a
// reasoning block is still open, along with that call's input/result parts, and
// downgrades a resulting `tool-calls` finish reason to `stop` so the session loop
// does not wait on a tool that never runs.
//
// It only suppresses tool calls that begin before `reasoning-end`. Legitimate
// post-reasoning tool calls pass through untouched, and the transform is a no-op
// for any stream that never emits reasoning parts.
export function transform(): TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart> {
  let reasoningDepth = 0
  const suppressedIDs = new Set<string>()
  let suppressedToolCall = false
  let survivingToolCall = false

  const suppress = (id: string) => {
    suppressedIDs.add(id)
    suppressedToolCall = true
  }

  return new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
    transform(part, controller) {
      switch (part.type) {
        case "reasoning-start":
          reasoningDepth++
          break

        case "reasoning-end":
          if (reasoningDepth > 0) reasoningDepth--
          break

        case "tool-input-start":
          if (reasoningDepth > 0) {
            suppress(part.id)
            return
          }
          break

        case "tool-input-delta":
        case "tool-input-end":
          if (suppressedIDs.has(part.id)) return
          break

        case "tool-call":
          if (reasoningDepth > 0 || suppressedIDs.has(part.toolCallId)) {
            suppress(part.toolCallId)
            return
          }
          survivingToolCall = true
          break

        case "tool-result":
        case "tool-approval-request":
          if (suppressedIDs.has(part.toolCallId)) return
          break

        case "finish":
          // Only rewrite when every tool call this stream produced was suppressed.
          // If a real tool call survived (emitted after reasoning closed), keep the
          // original finish reason so the agent loop still runs it.
          if (suppressedToolCall && !survivingToolCall && part.finishReason.unified === "tool-calls") {
            controller.enqueue({ ...part, finishReason: { ...part.finishReason, unified: "stop" } })
            return
          }
          break
      }

      controller.enqueue(part)
    },
  })
}

// Language-model middleware that runs `transform()` over the provider stream.
export function middleware(): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",
    async wrapStream({ doStream }) {
      const { stream, ...rest } = await doStream()
      return { stream: stream.pipeThrough(transform()), ...rest }
    },
  }
}

export * as ReasoningToolGuard from "./reasoning-tool-guard"
