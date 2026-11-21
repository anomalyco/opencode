export * as AntigravityLanguageModel from "./antigravity-language-model.js"

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"
import { Provider } from "@opencode/schema/provider"
import type { AntigravityACP } from "../antigravity/acp.js"

export interface Dependencies {
  readonly run: (
    request: { readonly model: string; readonly prompt: string },
    onUpdate: (update: AntigravityACP.Update) => void,
    signal: AbortSignal,
  ) => Promise<AntigravityACP.Turn>
}

/**
 * The language model for the Antigravity provider.
 *
 * The agent runs the turn and reports it as session updates; this renders them
 * as the stream parts OpenCode expects. The agent's own tools are provider
 * executed, so a tool call is reported with its result rather than dispatched
 * to the host, which has no such tools.
 */
export class Model implements LanguageModelV3 {
  readonly specificationVersion = "v3"
  readonly provider = Provider.ID.antigravity
  readonly supportedUrls = {}

  constructor(
    readonly modelId: string,
    readonly dependencies: Dependencies,
  ) {}

  async doGenerate(_options: LanguageModelV3CallOptions): Promise<never> {
    throw new Error("Antigravity models only support streaming")
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const abort = new AbortController()
    const signal = options.abortSignal ? AbortSignal.any([abort.signal, options.abortSignal]) : abort.signal
    let cancelled = false
    let task: Promise<void>
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: (controller) => {
        controller.enqueue({ type: "stream-start", warnings: [] })
        task = this.dependencies
          .run({ model: this.modelId, prompt: readPrompt(options) }, (update) => {
            if (cancelled) return
            for (const part of render(update)) controller.enqueue(part)
          }, signal)
          .then(
            (turn) => {
              if (cancelled) return
              controller.enqueue({
                type: "finish",
                usage: usage(turn.usage),
                finishReason: { unified: "stop", raw: turn.stopReason },
              })
              controller.close()
            },
            (error) => {
              if (!cancelled) controller.error(error)
            },
          )
      },
      cancel: () => {
        cancelled = true
        abort.abort()
        return task
      },
    })
    return { stream }
  }
}

/**
 * The text the user sent.
 *
 * The agent reads the project's own instruction files, so the host's system
 * prompt is not forwarded: it describes OpenCode's tools, which the agent does
 * not have.
 */
export function readPrompt(options: LanguageModelV3CallOptions): string {
  for (let index = options.prompt.length - 1; index >= 0; index -= 1) {
    const message = options.prompt[index]
    if (message.role !== "user") continue
    const parts = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter((text) => text.length > 0)
    const text = parts.join("\n")
    if (text.length > 0) return text
  }
  return "[continue]"
}

/**
 * Render an agent update as the stream parts the host expects.
 *
 * The agent's tool calls keep their own names, so they are reported as the
 * agent ran them rather than dispatched to the host, which has no such tools.
 */
export function render(update: AntigravityACP.Update): LanguageModelV3StreamPart[] {
  if (update.kind === "message") {
    return [{ type: "text-delta", id: "text", delta: update.text }]
  }
  if (update.kind === "thought") {
    return [{ type: "reasoning-delta", id: "reasoning", delta: update.text }]
  }
  if (update.kind === "tool-call" || update.kind === "tool-call-update") {
    const call = update.call
    return [
      {
        type: "tool-call",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: JSON.stringify(call.args ?? {}),
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        result: { status: call.status, title: call.title ?? call.toolName },
        isError: call.status === "failed",
      },
    ]
  }
  return []
}

/** The usage the agent reported for the turn. */
function usage(reported: AntigravityACP.Usage | undefined) {
  return {
    inputTokens: {
      total: reported?.input ?? 0,
      noCache: reported?.input ?? 0,
      cacheRead: reported?.cacheRead ?? 0,
      cacheWrite: reported?.cacheWrite ?? 0,
    },
    outputTokens: {
      total: reported?.output ?? 0,
      text: reported?.output ?? 0,
      reasoning: reported?.thought ?? 0,
    },
  }
}
