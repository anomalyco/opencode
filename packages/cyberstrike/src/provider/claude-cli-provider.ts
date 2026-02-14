import type { LanguageModelV2 } from "@ai-sdk/provider"
import { runClaudeCli, extractResponseText, isClaudeCliBackendAvailable } from "./claude-cli-backend"
import { Log } from "../util/log"

const log = Log.create({ service: "claude-cli-provider" })

export interface ClaudeCliProviderSettings {
  workingDirectory?: string
  timeout?: number
}

/**
 * Claude CLI Language Model - wraps Claude Code CLI for AI SDK compatibility
 */
class ClaudeCliLanguageModel {
  readonly specificationVersion = "v2" as const
  readonly provider = "claude-cli"
  readonly modelId: string
  readonly defaultObjectGenerationMode = "json" as const
  readonly supportedUrls: Record<string, RegExp[]> = {}

  private settings: ClaudeCliProviderSettings
  private lastSessionId: string | undefined

  constructor(modelId: string, settings: ClaudeCliProviderSettings = {}) {
    this.modelId = modelId
    this.settings = settings
  }

  async doGenerate(options: any): Promise<any> {
    const prompt = this.buildPrompt(options)
    const systemPrompt = this.extractSystemPrompt(options)

    log.info("doGenerate", { modelId: this.modelId, promptLength: prompt.length })

    const response = await runClaudeCli(prompt, {
      model: this.modelId,
      systemPrompt,
      sessionId: this.lastSessionId,
      timeoutMs: this.settings.timeout,
      workingDirectory: this.settings.workingDirectory,
    })

    // Reuse session for context continuity
    const sessionId = response.session_id ?? response.sessionId
    if (sessionId) this.lastSessionId = String(sessionId)

    const text = extractResponseText(response)
    const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 }
    const inputTokens = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0

    return {
      content: [{ type: "text", text }],
      finishReason: "stop",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      warnings: [],
      request: {
        body: { prompt, model: this.modelId },
      },
      providerMetadata: sessionId
        ? { "claude-cli": { sessionId: String(sessionId) } }
        : undefined,
    }
  }

  async doStream(options: any): Promise<any> {
    const result = await this.doGenerate(options)
    const textId = `claude-cli-text-${Date.now()}`

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: "text-start",
          id: textId,
          providerMetadata: result.providerMetadata,
        })

        for (const content of result.content) {
          if (content.type === "text") {
            controller.enqueue({
              type: "text-delta",
              id: textId,
              delta: content.text,
            })
          }
        }

        controller.enqueue({
          type: "text-end",
          id: textId,
          providerMetadata: result.providerMetadata,
        })

        controller.enqueue({
          type: "finish",
          finishReason: result.finishReason,
          usage: result.usage,
          providerMetadata: result.providerMetadata,
        })

        controller.close()
      },
    })

    return {
      stream,
      warnings: [],
      request: result.request,
    }
  }

  private buildPrompt(options: any): string {
    const parts: string[] = []

    for (const message of options.prompt) {
      if (message.role === "user") {
        for (const part of message.content) {
          if (part.type === "text") parts.push(part.text)
        }
      } else if (message.role === "assistant") {
        for (const part of message.content) {
          if (part.type === "text") parts.push(`Assistant: ${part.text}`)
        }
      } else if (message.role === "tool") {
        for (const part of message.content) {
          if (part.type === "tool-result") {
            parts.push(`Tool Result (${part.toolName}): ${JSON.stringify(part.result)}`)
          }
        }
      }
    }

    return parts.join("\n\n")
  }

  private extractSystemPrompt(options: any): string | undefined {
    for (const message of options.prompt) {
      if (message.role === "system") return message.content
    }
    return undefined
  }
}

/**
 * Create a Claude CLI provider
 */
export function createClaudeCliProvider(settings: ClaudeCliProviderSettings = {}) {
  return {
    languageModel(modelId: string): LanguageModelV2 {
      return new ClaudeCliLanguageModel(modelId, settings) as unknown as LanguageModelV2
    },
    textEmbeddingModel() {
      throw new Error("Claude CLI provider does not support text embedding")
    },
    imageModel() {
      throw new Error("Claude CLI provider does not support image generation")
    },
  }
}

/**
 * Check if Claude CLI provider is available
 */
export function isClaudeCliProviderAvailable(): boolean {
  return isClaudeCliBackendAvailable()
}
