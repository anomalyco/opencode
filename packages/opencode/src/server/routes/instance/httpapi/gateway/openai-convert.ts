import { jsonSchema, tool as aiTool, type JSONSchema7, type ModelMessage, type streamText, type Tool } from "ai"
import type { Provider } from "@/provider/provider"

// Pure, Effect-free helpers that translate between the OpenAI Chat Completions
// wire format and the Vercel AI SDK shapes opencode already uses. Kept isolated
// from the HttpApi handler so the mapping can be unit-tested in isolation.

type StreamResult = Awaited<ReturnType<typeof streamText>>
type StreamPart = StreamResult["fullStream"] extends AsyncIterable<infer T> ? T : never

// --- OpenAI request types (loose; only the fields the gateway honors) ---

export interface OpenAITextPart {
  type: "text"
  text: string
}
export interface OpenAIImagePart {
  type: "image_url"
  image_url: { url: string }
}
export type OpenAIContentPart = OpenAITextPart | OpenAIImagePart | { type: string; [k: string]: unknown }

export interface OpenAIToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer"
  content?: string | OpenAIContentPart[] | null
  name?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export interface OpenAIFunctionTool {
  type: "function"
  function: { name: string; description?: string; parameters?: JSONSchema7 }
}

function isTextPart(part: OpenAIContentPart): part is OpenAITextPart {
  return part.type === "text" && typeof part.text === "string"
}

function isImagePart(part: OpenAIContentPart): part is OpenAIImagePart {
  return part.type === "image_url"
}

export type OpenAIToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } }

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIMessage[]
  stream?: boolean
  temperature?: number
  top_p?: number
  max_tokens?: number
  max_completion_tokens?: number
  tools?: OpenAIFunctionTool[]
  tool_choice?: OpenAIToolChoice
  stream_options?: { include_usage?: boolean }
}

export interface ChunkMeta {
  id: string
  created: number
  model: string
  includeUsage: boolean
}

// --- request: OpenAI -> AI SDK ---

type UserContentPart = { type: "text"; text: string } | { type: "image"; image: string }

function textFromContent(content: OpenAIMessage["content"]): string {
  if (typeof content === "string") return content
  if (!content) return ""
  return content
    .filter(isTextPart)
    .map((p) => p.text)
    .join("")
}

function userContent(content: OpenAIMessage["content"]): string | UserContentPart[] {
  if (typeof content === "string" || !content) return content ?? ""
  const parts: UserContentPart[] = []
  for (const part of content) {
    if (isTextPart(part)) {
      parts.push({ type: "text", text: part.text })
    } else if (isImagePart(part)) {
      const url = part.image_url?.url
      if (url) parts.push({ type: "image", image: url })
    }
  }
  return parts
}

function safeParseArgs(raw: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function toModelMessages(messages: OpenAIMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []
  // OpenAI tool messages carry only tool_call_id, not the tool name. Track the
  // id->name mapping from the preceding assistant tool_calls so we can rebuild
  // the AI SDK tool-result part, which requires a toolName.
  const toolNames = new Map<string, string>()

  for (const message of messages) {
    switch (message.role) {
      case "system":
      case "developer":
        result.push({ role: "system", content: textFromContent(message.content) })
        break
      case "user":
        result.push({ role: "user", content: userContent(message.content) })
        break
      case "assistant": {
        const content: Array<
          { type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
        > = []
        const text = textFromContent(message.content)
        if (text) content.push({ type: "text", text })
        for (const call of message.tool_calls ?? []) {
          toolNames.set(call.id, call.function.name)
          content.push({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.function.name,
            input: safeParseArgs(call.function.arguments),
          })
        }
        if (content.length === 0) {
          result.push({ role: "assistant", content: "" })
          break
        }
        result.push({ role: "assistant", content })
        break
      }
      case "tool": {
        const toolCallId = message.tool_call_id ?? ""
        result.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId,
              toolName: toolNames.get(toolCallId) ?? "unknown",
              output: { type: "text", value: textFromContent(message.content) },
            },
          ],
        })
        break
      }
    }
  }

  return result
}

export function toTools(tools: OpenAIFunctionTool[] | undefined): Record<string, Tool> | undefined {
  if (!tools || tools.length === 0) return undefined
  const result: Record<string, Tool> = {}
  for (const t of tools) {
    if (t.type !== "function" || !t.function?.name) continue
    // No `execute`: a tool without an executor makes the AI SDK surface the
    // tool-call in the stream and stop the step instead of running it. The
    // gateway streams those calls back to the client (VSCode), which owns
    // tool execution.
    result[t.function.name] = aiTool({
      description: t.function.description ?? "",
      inputSchema: jsonSchema(t.function.parameters ?? { type: "object", properties: {} }),
    })
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export function toToolChoice(choice: OpenAIToolChoice | undefined) {
  if (choice === undefined) return undefined
  if (choice === "auto" || choice === "none" || choice === "required") return choice
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "tool" as const, toolName: choice.function.name }
  }
  return undefined
}

export interface ConvertedRequest {
  messages: ModelMessage[]
  tools: Record<string, Tool> | undefined
  toolChoice: ReturnType<typeof toToolChoice>
  temperature: number | undefined
  topP: number | undefined
  maxOutputTokens: number | undefined
}

export function convertRequest(req: OpenAIChatRequest, model: Provider.Model): ConvertedRequest {
  const supportsTemperature = model.capabilities.temperature
  const maxRequested = req.max_tokens ?? req.max_completion_tokens
  const maxOutputTokens =
    maxRequested === undefined ? undefined : Math.min(maxRequested, model.limit.output || maxRequested)
  return {
    messages: toModelMessages(req.messages ?? []),
    tools: toTools(req.tools),
    toolChoice: toToolChoice(req.tool_choice),
    temperature: supportsTemperature ? req.temperature : undefined,
    topP: supportsTemperature ? req.top_p : undefined,
    maxOutputTokens,
  }
}

// --- response: AI SDK fullStream -> OpenAI ---

const FINISH_REASON: Record<string, string> = {
  stop: "stop",
  length: "length",
  "content-filter": "content_filter",
  "tool-calls": "tool_calls",
  error: "stop",
  other: "stop",
  unknown: "stop",
}

function mapFinishReason(reason: string | undefined): string {
  return (reason && FINISH_REASON[reason]) || "stop"
}

function usageObject(totalUsage: unknown) {
  const u = (totalUsage ?? {}) as { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  const prompt = u.inputTokens ?? 0
  const completion = u.outputTokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: u.totalTokens ?? prompt + completion,
  }
}

function chunk(meta: ChunkMeta, choices: unknown[], usage?: unknown) {
  const base: Record<string, unknown> = {
    id: meta.id,
    object: "chat.completion.chunk",
    created: meta.created,
    model: meta.model,
    choices,
  }
  if (usage !== undefined) base["usage"] = usage
  return `data: ${JSON.stringify(base)}\n\n`
}

interface ToolStreamState {
  index: number
  startedArgs: boolean
}

/**
 * Translate an AI SDK `fullStream` into OpenAI `chat.completion.chunk` SSE
 * frames, terminating with `data: [DONE]`. Errors that surface after streaming
 * has begun are emitted inline as an OpenAI error frame (the HTTP status is
 * already committed at that point).
 */
export async function* toSseStream(
  fullStream: AsyncIterable<StreamPart>,
  meta: ChunkMeta,
): AsyncGenerator<string> {
  const tools = new Map<string, ToolStreamState>()
  let nextToolIndex = 0
  let roleSent = false

  const ensureRole = function* () {
    if (roleSent) return
    roleSent = true
    yield chunk(meta, [{ index: 0, delta: { role: "assistant" }, finish_reason: null }])
  }

  try {
    for await (const part of fullStream) {
      switch (part.type) {
        case "text-delta": {
          if (!part.text) break
          yield* ensureRole()
          yield chunk(meta, [{ index: 0, delta: { content: part.text }, finish_reason: null }])
          break
        }
        case "tool-input-start": {
          yield* ensureRole()
          const index = nextToolIndex++
          tools.set(part.id, { index, startedArgs: true })
          yield chunk(meta, [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index, id: part.id, type: "function", function: { name: part.toolName, arguments: "" } },
                ],
              },
              finish_reason: null,
            },
          ])
          break
        }
        case "tool-input-delta": {
          const state = tools.get(part.id)
          if (!state) break
          yield chunk(meta, [
            {
              index: 0,
              delta: { tool_calls: [{ index: state.index, function: { arguments: part.delta ?? "" } }] },
              finish_reason: null,
            },
          ])
          break
        }
        case "tool-call": {
          // Providers that don't stream tool arguments emit the whole call at
          // once. Only synthesize a tool_calls delta if we didn't already stream
          // its arguments via tool-input-delta above.
          if (tools.has(part.toolCallId)) break
          yield* ensureRole()
          const index = nextToolIndex++
          tools.set(part.toolCallId, { index, startedArgs: true })
          yield chunk(meta, [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    id: part.toolCallId,
                    type: "function",
                    function: { name: part.toolName, arguments: JSON.stringify(part.input ?? {}) },
                  },
                ],
              },
              finish_reason: null,
            },
          ])
          break
        }
        case "finish": {
          yield* ensureRole()
          const finishReason = mapFinishReason(part.finishReason)
          yield chunk(meta, [{ index: 0, delta: {}, finish_reason: finishReason }])
          if (meta.includeUsage) yield chunk(meta, [], usageObject(part.totalUsage))
          break
        }
        case "error": {
          yield `data: ${JSON.stringify({ error: openAIError(part.error) })}\n\n`
          break
        }
        default:
          break
      }
    }
  } catch (error) {
    yield `data: ${JSON.stringify({ error: openAIError(error) })}\n\n`
  }
  yield "data: [DONE]\n\n"
}

export interface AggregatedCompletion {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
    finish_reason: string
  }>
  usage: ReturnType<typeof usageObject>
}

/**
 * Collect an AI SDK `fullStream` into a single non-streaming OpenAI
 * `chat.completion` object. Rejects if the stream surfaces an error part.
 */
export async function aggregate(
  fullStream: AsyncIterable<StreamPart>,
  meta: ChunkMeta,
): Promise<AggregatedCompletion> {
  let text = ""
  let finishReason = "stop"
  let totalUsage: unknown = {}
  const toolArgs = new Map<string, { id: string; name: string; args: string }>()
  const order: string[] = []

  for await (const part of fullStream) {
    switch (part.type) {
      case "text-delta":
        text += part.text ?? ""
        break
      case "tool-input-start":
        if (!toolArgs.has(part.id)) order.push(part.id)
        toolArgs.set(part.id, { id: part.id, name: part.toolName, args: "" })
        break
      case "tool-input-delta": {
        const existing = toolArgs.get(part.id)
        if (existing) existing.args += part.delta ?? ""
        break
      }
      case "tool-call": {
        if (!toolArgs.has(part.toolCallId)) {
          order.push(part.toolCallId)
          toolArgs.set(part.toolCallId, {
            id: part.toolCallId,
            name: part.toolName,
            args: JSON.stringify(part.input ?? {}),
          })
        }
        break
      }
      case "finish":
        finishReason = mapFinishReason(part.finishReason)
        totalUsage = part.totalUsage
        break
      case "error":
        throw part.error
      default:
        break
    }
  }

  const toolCalls: OpenAIToolCall[] = order.map((id) => {
    const t = toolArgs.get(id)!
    return { id: t.id, type: "function", function: { name: t.name, arguments: t.args } }
  })

  return {
    id: meta.id,
    object: "chat.completion",
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: toolCalls.length > 0 && text === "" ? null : text,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: usageObject(totalUsage),
  }
}

// --- errors ---

export function openAIError(error: unknown): { message: string; type: string; code: string | null } {
  // Effect wraps thrown rejections (e.g. from Effect.tryPromise) in an
  // UnknownException whose own message is generic; the real provider error sits
  // on `.cause`. Prefer that so clients see "Incorrect API key" etc.
  let root: unknown = error
  if (root && typeof root === "object" && "cause" in root) {
    const cause = (root as { cause?: unknown }).cause
    if (cause) root = cause
  }
  const message =
    root instanceof Error
      ? root.message
      : typeof root === "string"
        ? root
        : error instanceof Error
          ? error.message
          : "Unknown error"
  return { message, type: "api_error", code: null }
}

export function errorBody(message: string, type: string, code: string | null) {
  return { error: { message, type, code, param: null } }
}
