export * as AntigravityLanguageModel from "./antigravity-language-model.js"

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"
import { Provider } from "@opencode/schema/provider"
import type { AntigravityACP } from "../antigravity/acp.js"
import type { AntigravitySession } from "../antigravity/session.js"

/** OpenCode names the session of every request in this header. */
export const SESSION_HEADER = "x-opencode-session-id"
/** Set by the session hook. */
export const KIND_HEADER = "x-opencode-antigravity-kind"
export const AGENT_HEADER = "x-opencode-antigravity-agent"

export interface Dependencies {
  readonly run: (
    request: AntigravitySession.Request,
    onUpdate: (update: AntigravityACP.Update) => void,
    signal: AbortSignal,
  ) => Promise<AntigravityACP.Turn>
}

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
    const headers = options.headers ?? {}
    const settings = options.providerOptions?.[Provider.ID.antigravity]
    const request: AntigravitySession.Request = {
      sessionID: headers[SESSION_HEADER],
      agent: headers[AGENT_HEADER],
      kind: headers[KIND_HEADER],
      model: this.modelId,
      slug: typeof settings?.slug === "string" ? settings.slug : undefined,
      effort: typeof settings?.effort === "string" ? settings.effort : undefined,
      prompt: readPrompt(options),
    }
    const renderer = makeRenderer()
    let cancelled = false
    let task: Promise<void>
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: (controller) => {
        controller.enqueue({ type: "stream-start", warnings: [] })
        const flush = () => {
          for (const part of renderer.end()) controller.enqueue(part)
        }
        task = this.dependencies
          .run(
            request,
            (update) => {
              if (cancelled) return
              for (const part of renderer.push(update)) controller.enqueue(part)
            },
            signal,
          )
          .then(
            (turn) => {
              if (cancelled) return
              flush()
              controller.enqueue({
                type: "finish",
                usage: usage(turn.usage),
                finishReason: finishReason(turn.stopReason),
              })
              controller.close()
            },
            (error) => {
              if (cancelled) return
              flush()
              controller.error(error)
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
 * The host's system prompt is not forwarded: it describes OpenCode's tools, which the agent does
 * not have, and the agent reads the project's instruction files itself.
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

export interface Renderer {
  readonly push: (update: AntigravityACP.Update) => LanguageModelV3StreamPart[]
  /** The stream parts that settle the tool calls still running when the turn ends. */
  readonly end: () => LanguageModelV3StreamPart[]
}

interface Call {
  readonly toolName: string
  args: unknown
  title: string | undefined
  settled: boolean
}

/**
 * The agent updates a tool call until it finishes, but OpenCode rejects a repeated call or result id.
 * So a call keeps the name it first had and is emitted with its result once, when it completes or
 * fails. The calls are provider executed: OpenCode has no tools with these names to run.
 */
export function makeRenderer(): Renderer {
  const calls = new Map<string, Call>()
  const settle = (id: string, call: Call, status: string, isError: boolean): LanguageModelV3StreamPart[] => {
    call.settled = true
    return [
      {
        type: "tool-call",
        toolCallId: id,
        toolName: call.toolName,
        input: JSON.stringify(call.args ?? {}),
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: id,
        toolName: call.toolName,
        result: { status, title: call.title ?? call.toolName },
        isError,
      },
    ]
  }
  return {
    push: (update) => {
      if (update.kind === "message") return [{ type: "text-delta", id: "text", delta: update.text }]
      if (update.kind === "thought") return [{ type: "reasoning-delta", id: "reasoning", delta: update.text }]
      const reported = update.call
      let call = calls.get(reported.toolCallId)
      if (!call) {
        call = {
          toolName: reported.toolName ?? reported.title ?? "unknown",
          args: reported.args,
          title: reported.title,
          settled: false,
        }
        calls.set(reported.toolCallId, call)
      } else if (!call.settled) {
        if (reported.args !== undefined) call.args = reported.args
        if (reported.title !== undefined) call.title = reported.title
      }
      if (call.settled) return []
      if (reported.status === "completed") return settle(reported.toolCallId, call, "completed", false)
      if (reported.status === "failed") return settle(reported.toolCallId, call, "failed", true)
      return []
    },
    end: () => [...calls].flatMap(([id, call]) => (call.settled ? [] : settle(id, call, "incomplete", true))),
  }
}

/** A turn cut off by its budget, or refused, must not look like a normal finish. */
export function finishReason(stopReason: string): LanguageModelV3FinishReason {
  const unified =
    stopReason === "end_turn"
      ? "stop"
      : stopReason === "max_tokens" || stopReason === "max_turn_requests"
        ? "length"
        : stopReason === "refusal"
          ? "content-filter"
          : "other"
  return { unified, raw: stopReason }
}

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
