export * as ClaudeAgentLanguageModel from "./claude-agent-language-model.js"

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"
import type { ClaudeSessions } from "../claude/sessions.js"
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk"
import { ConvertClaudeStream } from "./convert-claude-stream.js"
import { RequestKind } from "./request-kind.js"
import { ClaudeSystemPrompt } from "./system-prompt.js"

export interface Dependencies {
  readonly run: (request: Parameters<ClaudeSessions.Interface["run"]>[0], signal: AbortSignal) => Promise<void>
}

export class Model implements LanguageModelV3 {
  readonly specificationVersion = "v3"
  readonly provider = "claude-agent"
  readonly supportedUrls = {}

  constructor(
    readonly modelId: string,
    readonly dependencies: Dependencies,
  ) {}

  async doGenerate(_options: LanguageModelV3CallOptions): Promise<never> {
    throw new Error("Claude Agent models only support streaming")
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const abort = new AbortController()
    const signal = options.abortSignal ? AbortSignal.any([abort.signal, options.abortSignal]) : abort.signal
    const tools =
      options.toolChoice?.type === "none"
        ? []
        : (options.tools ?? []).filter((tool): tool is LanguageModelV3FunctionTool => tool.type === "function")
    const convert = ConvertClaudeStream.make(tools)
    const headers = new Headers(options.headers as Record<string, string>)
    const kind = headers.get(RequestKind.HEADER)
    const session = headers.get(RequestKind.SESSION_HEADER) ?? undefined
    const settings = options.providerOptions?.["claude-agent"]
    const role = settings?.[ClaudeSystemPrompt.AGENT_OPTION]
    const agent = typeof role === "string" ? role : undefined
    const effort = parseEffort(settings?.effort)
    const primary = kind === "primary"
    const branch = kind === "generate" || kind === "compaction"
    const sessionID = primary ? session : undefined
    // Conversation branches copy their source session and keep the Claude prompt. OpenCode supplies their task as user input.
    const sourceID = primary ? (headers.get(RequestKind.FORK_HEADER) ?? undefined) : branch ? session : undefined
    // Branches offer the chat's tools and system prompt so Claude reuses the chat's prompt cache.
    const offered = primary || branch ? tools : []
    // Titles are standalone tasks, so OpenCode's system prompt replaces Claude Code's.
    const system =
      primary || branch
        ? ClaudeSystemPrompt.make(options.prompt, offered.length > 0, agent)
        : ClaudeSystemPrompt.utility(options.prompt)
    let cancelled = false
    let task: Promise<void>
    const stream = new ReadableStream({
      start: (controller) => {
        controller.enqueue({ type: "stream-start", warnings: [] })
        task = this.dependencies
          .run(
            {
              sessionID,
              sourceID,
              compaction: kind === "compaction",
              model: this.modelId,
              effort,
              maxOutputTokens: options.maxOutputTokens,
              system,
              prompt: options.prompt,
              tools: offered,
              emit: (message) => {
                if (cancelled) return
                for (const part of convert(message)) controller.enqueue(part)
              },
            },
            signal,
          )
          .then(
            () => {
              if (!cancelled) controller.close()
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

const EFFORTS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"]

function parseEffort(value: unknown): EffortLevel | undefined {
  if (value === undefined) return undefined
  const effort = EFFORTS.find((effort) => value === effort)
  if (effort !== undefined) return effort
  throw new Error("Claude Agent effort must be low, medium, high, xhigh or max")
}
