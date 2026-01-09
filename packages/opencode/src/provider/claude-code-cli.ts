import { Log } from "../util/log"
import { Instance } from "../project/instance"
import type { LanguageModelV2 } from "@openrouter/ai-sdk-provider"

const log = Log.create({ service: "claude-code-cli" })

function getWorkingDirectory(): string {
  try {
    return Instance.directory
  } catch {
    return process.cwd()
  }
}

export namespace ClaudeCodeCLI {
  export const PROVIDER_ID = "claude-code-cli"
  export const MODELS = ["sonnet", "opus", "haiku"] as const

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

  type Message = {
    role: "user" | "assistant"
    content: ContentPart[]
  }

  type StreamEvent = {
    type: string
    message?: { content?: ContentPart[]; usage?: { input_tokens: number; output_tokens: number } }
    content_block?: ContentPart
    delta?: { type: string; text?: string; partial_json?: string }
    index?: number
    usage?: { input_tokens: number; output_tokens: number }
  }

  function parseJson<T>(text: string): T | null {
    try {
      return JSON.parse(text) as T
    } catch {
      return null
    }
  }

  async function findCommand(): Promise<string | undefined> {
    const paths = [
      "claude",
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
      `${process.env.HOME}/.local/bin/claude`,
    ]

    for (const cmd of paths) {
      try {
        const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "ignore" })
        await proc.exited
        if (proc.exitCode === 0) {
          const result = await new Response(proc.stdout).text()
          return result.trim() || cmd
        }
      } catch {
        // Silently continue if which fails
      }
    }

    try {
      const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe", stderr: "ignore" })
      await proc.exited
      if (proc.exitCode === 0) return "claude"
    } catch {
      // Silently continue if claude is not found
    }

    return undefined
  }

  export async function isAvailable(): Promise<boolean> {
    const cmd = await findCommand()
    return cmd !== undefined
  }

  function convertPrompt(prompt: unknown[]): { system: string; messages: Message[] } {
    const messages: Message[] = []
    const systemParts: string[] = []

    for (const msg of prompt as { role: string; content: unknown[] }[]) {
      if (msg.role === "system") {
        systemParts.push(
          (msg.content as { type: string; text?: string }[])
            .map((c) => (c.type === "text" ? c.text || "" : ""))
            .join(""),
        )
        continue
      }

      if (msg.role === "user") {
        const content: ContentPart[] = []
        for (const part of msg.content as { type: string; text?: string; toolCallId?: string; result?: unknown; isError?: boolean }[]) {
          if (part.type === "text" && part.text) {
            content.push({ type: "text", text: part.text })
          }
          if (part.type === "tool-result" && part.toolCallId) {
            content.push({
              type: "tool_result",
              tool_use_id: part.toolCallId,
              content: typeof part.result === "string" ? part.result : JSON.stringify(part.result),
              is_error: part.isError,
            })
          }
        }
        if (content.length > 0) messages.push({ role: "user", content })
      }

      if (msg.role === "assistant") {
        const content: ContentPart[] = []
        for (const part of msg.content as { type: string; text?: string; toolCallId?: string; toolName?: string; args?: unknown }[]) {
          if (part.type === "text" && part.text) {
            content.push({ type: "text", text: part.text })
          }
          if (part.type === "tool-call" && part.toolCallId && part.toolName) {
            content.push({
              type: "tool_use",
              id: part.toolCallId,
              name: part.toolName,
              input: (part.args as Record<string, unknown>) || {},
            })
          }
        }
        if (content.length > 0) messages.push({ role: "assistant", content })
      }
    }

    return { system: systemParts.join("\n"), messages }
  }

  export function createLanguageModel(modelId: string): LanguageModelV2 {
    return {
      specificationVersion: "v2",
      provider: PROVIDER_ID,
      modelId,
      defaultObjectGenerationMode: undefined,
      supportedUrls: undefined,

      async doGenerate(options: { prompt: unknown[] }) {
        const cmd = await findCommand()
        if (!cmd) throw new Error("Claude CLI not found. Install from https://claude.ai/download")

        const converted = convertPrompt(options.prompt as unknown[])
        const args = [
          "-p",
          JSON.stringify(converted.messages),
          "--output-format",
          "json",
          "--print",
          "--verbose",
          "--tools",
          "",
        ]

        if (converted.system) args.push("--system-prompt", converted.system)
        if (MODELS.includes(modelId as (typeof MODELS)[number])) args.push("--model", modelId)

        log.info("executing", { cmd, args: args.slice(0, 4), model: modelId })

        const proc = Bun.spawn([cmd, ...args], {
          cwd: getWorkingDirectory(),
          stdout: "pipe",
          stderr: "pipe",
        })

        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        await proc.exited

        if (proc.exitCode !== 0) {
          log.error("failed", { exitCode: proc.exitCode, stderr })
          throw new Error(`Claude CLI failed: ${stderr || "Unknown error"}`)
        }

        // Parse JSON output from --print --verbose --output-format json
        // Output is a JSON array: [{"type":"system",...},{"type":"assistant",...},{"type":"result",...}]
        const text: string[] = []
        const toolCalls: { toolCallType: "function"; toolCallId: string; toolName: string; args: string }[] = []
        const usage = { inputTokens: 0, outputTokens: 0 }

        const events = parseJson<StreamEvent[]>(stdout) || []

        for (const event of events) {
          // Handle assistant messages with content (text and tool_use)
          if (event.type === "assistant" && event.message?.content) {
            for (const content of event.message.content) {
              if (content.type === "text") text.push(content.text)
              if (content.type === "tool_use") {
                toolCalls.push({
                  toolCallType: "function",
                  toolCallId: content.id,
                  toolName: content.name,
                  args: JSON.stringify(content.input),
                })
              }
            }
            if (event.message.usage) {
              usage.inputTokens = event.message.usage.input_tokens || usage.inputTokens
              usage.outputTokens = event.message.usage.output_tokens || usage.outputTokens
            }
          }

          // Handle result event for usage stats
          if (event.type === "result" && event.usage) {
            usage.inputTokens = event.usage.input_tokens || usage.inputTokens
            usage.outputTokens = event.usage.output_tokens || usage.outputTokens
          }
        }

        return {
          text: text.join(""),
          toolCalls,
          finishReason: toolCalls.length > 0 ? "tool-calls" : "stop",
          usage,
          rawCall: { rawPrompt: options.prompt, rawSettings: {} },
          rawResponse: { headers: {} },
          response: { id: `claude-cli-${Date.now()}`, timestamp: new Date(), modelId },
          warnings: [],
          providerMetadata: {},
          sources: [],
          files: [],
          reasoning: undefined,
        }
      },

      async doStream(options: { prompt: unknown[] }) {
        const cmd = await findCommand()
        if (!cmd) throw new Error("Claude CLI not found. Install from https://claude.ai/download")

        const converted = convertPrompt(options.prompt as unknown[])
        const args = [
          "-p",
          JSON.stringify(converted.messages),
          "--output-format",
          "stream-json",
          "--print",
          "--verbose",
          "--tools",
          "",
        ]

        if (converted.system) args.push("--system-prompt", converted.system)
        if (MODELS.includes(modelId as (typeof MODELS)[number])) args.push("--model", modelId)

        log.info("executing stream", { cmd, args: args.slice(0, 4), model: modelId })

        const proc = Bun.spawn([cmd, ...args], {
          cwd: getWorkingDirectory(),
          stdout: "pipe",
          stderr: "pipe",
        })

        async function* generate() {
          const reader = proc.stdout.getReader()
          const decoder = new TextDecoder()
          const usage = { inputTokens: 0, outputTokens: 0 }
          const buffer: string[] = []
          let hasToolCalls = false

          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break

            buffer.push(decoder.decode(chunk.value, { stream: true }))
            const joined = buffer.join("")
            const lines = joined.split("\n")
            buffer.length = 0
            buffer.push(lines.pop() || "")

            for (const line of lines) {
              if (!line.trim()) continue
              const event = parseJson<StreamEvent>(line)
              if (!event) continue

              // Handle assistant messages with content (text and tool_use)
              if (event.type === "assistant" && event.message?.content) {
                for (const content of event.message.content) {
                  if (content.type === "text") {
                    yield { type: "text-delta" as const, textDelta: content.text }
                  }
                  if (content.type === "tool_use") {
                    hasToolCalls = true
                    yield {
                      type: "tool-call" as const,
                      toolCallType: "function" as const,
                      toolCallId: content.id,
                      toolName: content.name,
                      args: JSON.stringify(content.input),
                    }
                  }
                }
                if (event.message.usage) {
                  usage.inputTokens = event.message.usage.input_tokens || usage.inputTokens
                  usage.outputTokens = event.message.usage.output_tokens || usage.outputTokens
                }
              }

              // Handle result event for usage stats
              if (event.type === "result" && event.usage) {
                usage.inputTokens = event.usage.input_tokens || usage.inputTokens
                usage.outputTokens = event.usage.output_tokens || usage.outputTokens
              }
            }
          }

          reader.releaseLock()
          await proc.exited

          if (proc.exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text()
            log.error("stream failed", { exitCode: proc.exitCode, stderr })
          }

          yield {
            type: "finish" as const,
            finishReason: (hasToolCalls ? "tool-calls" : "stop") as "stop" | "tool-calls",
            usage,
            providerMetadata: {},
          }
        }

        return {
          stream: generate(),
          rawCall: { rawPrompt: options.prompt, rawSettings: {} },
          rawResponse: { headers: {} },
          warnings: [],
        }
      },
    } as unknown as LanguageModelV2
  }

  export function createProvider() {
    return {
      languageModel(modelId: string) {
        return createLanguageModel(modelId)
      },
    }
  }
}
