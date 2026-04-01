import { generateText, type ModelMessage, type Tool, type LanguageModel } from "ai"
import { Log } from "@/util/log"

const log = Log.create({ service: "nonstreaming-fallback" })

export type FallbackInput = {
  model: LanguageModel
  messages: ModelMessage[]
  tools: Record<string, Tool>
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  headers?: Record<string, string>
  abort?: AbortSignal
}

export type FallbackResult = {
  text: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  finishReason: string
  toolCalls: Array<{ id: string; name: string; input: unknown }>
  toolResults: Array<{ id: string; result: unknown }>
}

export async function fallback(input: FallbackInput): Promise<FallbackResult> {
  log.info("attempting non-streaming fallback")
  const result = await generateText({
    model: input.model,
    messages: input.messages,
    tools: input.tools,
    temperature: input.temperature,
    topP: input.topP,
    topK: input.topK,
    maxOutputTokens: input.maxOutputTokens,
    headers: input.headers,
    abortSignal: input.abort,
    maxRetries: 0,
  })

  const calls = (result.toolCalls ?? []) as Array<{ toolCallId: string; toolName: string; input: unknown }>
  const results = (result.toolResults ?? []) as Array<{ toolCallId: string; output: unknown }>

  return {
    text: result.text,
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    },
    finishReason: result.finishReason,
    toolCalls: calls.map((tc) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      input: tc.input,
    })),
    toolResults: results.map((tr) => ({
      id: tr.toolCallId,
      result: tr.output,
    })),
  }
}
