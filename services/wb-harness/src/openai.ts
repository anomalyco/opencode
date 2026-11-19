import type { WBConfig } from "./config"
import { planToolCalls, type ToolSpec } from "./planner"
import { buildPrompt, enrich } from "./tools/enrich"
import { collectWBMessage } from "./wb/client"

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_call_id?: string
  name?: string
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
}

export type ChatRequest = {
  model?: string
  messages: ChatMessage[]
  stream?: boolean
  tools: ToolSpec[]
  session_id?: string
}

export type HandlerResult = {
  status: number
  body: unknown
  headers?: Record<string, string>
  meta?: { tools: string[]; scenario?: string; state?: string; fallback?: boolean }
}

export async function handleChatCompletions(
  request: ChatRequest,
  config: WBConfig,
  signal: AbortSignal,
): Promise<HandlerResult> {
  const userText = lastUserText(request.messages)
  const hasToolResults = request.messages.at(-1)?.role === "tool"

  if (request.tools.length && userText && !hasToolResults) {
    const plan = planToolCalls(request.tools, userText)
    if (plan.calls.length) {
      const toolCalls = plan.calls.map((call) => ({
        id: `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }))
      return {
        status: 200,
        body: request.stream
          ? streamToolCalls(toolCalls, request.model)
          : completion(request.model, {
              role: "assistant",
              content: null,
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                function: { name: call.function.name, arguments: call.function.arguments },
              })),
            }, "tool_calls"),
        headers: request.stream ? { "content-type": "text/event-stream; charset=utf-8" } : undefined,
      }
    }
  }

  if (!userText && !hasToolResults) {
    return { status: 400, body: { error: { message: "messages must contain a user message" } } }
  }

  const enrichment = config.enrichment.enabled && userText
    ? await enrich(userText, config.enrichment.timeoutMs)
    : { tools: [], results: [], context: "" }

  const prompt = buildPrompt(composePrompt(request.messages), enrichment)
  const message = await collectWBMessage({
    text: prompt,
    sessionID: request.session_id,
    auth: config.auth,
    upstream: config.upstream,
    signal,
  })

  // The shopping assistant refuses off-topic turns (shell, git) even when the
  // answer lives in the tool output. Return the tool results instead of a refusal.
  const fallback = isRefusal(message.text, message.state)
    ? summarizeToolResults(request.messages)
    : undefined
  const content = fallback ?? message.text

  const toolTrace = {
    tools: [...request.tools.map((tool) => tool.name), ...enrichment.tools],
    enrichment: enrichment.results,
    scenario: message.scenario,
    state: message.state,
    suggestions: message.suggests,
    ...(fallback ? { fallback: true } : {}),
  }

  if (request.stream) {
    return {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
      body: streamContent(content, request.model, toolTrace),
      meta: { tools: toolTrace.tools, scenario: message.scenario, state: message.state, fallback: Boolean(fallback) },
    }
  }

  return {
    status: 200,
    body: {
      ...completion(request.model, { role: "assistant", content }, "stop"),
      wb_harness: toolTrace,
    },
    meta: { tools: toolTrace.tools, scenario: message.scenario, state: message.state, fallback: Boolean(fallback) },
  }
}

function isRefusal(text: string, state: string | undefined): boolean {
  if (state === "ignored") return true
  if (!text.trim()) return true
  return /не могу предоставить|политик безопасности|помогать с вопросами покупок/i.test(text)
}

function summarizeToolResults(messages: ChatMessage[]): string | undefined {
  const results = messages.filter((message) => message.role === "tool" && message.content?.trim())
  if (!results.length) return
  return results
    .map((message) => {
      const label = message.name ?? message.tool_call_id ?? "tool"
      return `${label}:\n${message.content?.trim()}`
    })
    .join("\n\n")
}

function completion(
  model: string | undefined,
  message: Record<string, unknown>,
  finishReason: string,
) {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model ?? "wb-agent",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

function streamToolCalls(
  toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>,
  model = "wb-agent",
) {
  const id = `chatcmpl-${crypto.randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const base = { id, object: "chat.completion.chunk", created, model }
  const frames = [
    JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }),
    JSON.stringify({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: toolCalls.map((call, index) => ({
              index,
              id: call.id,
              type: "function",
              function: call.function,
            })),
          },
          finish_reason: null,
        },
      ],
    }),
    JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
  ]
  return toStream(frames)
}

function streamContent(
  text: string,
  model = "wb-agent",
  metadata: Record<string, unknown> = {},
) {
  const id = `chatcmpl-${crypto.randomUUID()}`
  const created = Math.floor(Date.now() / 1000)
  const base = { id, object: "chat.completion.chunk", created, model }
  const frames = [
    JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }),
    ...splitText(text).map((piece) =>
      JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      }),
    ),
    JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      wb_harness: metadata,
    }),
  ]
  return toStream(frames)
}

function toStream(frames: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(`data: ${frame}\n\n`))
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })
}

function splitText(text: string): string[] {
  const parts = text.match(/[^.!?\n]+[.!?\n]*\s*/g)
  return parts ?? [text]
}

function lastUserText(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message) continue
    if (message.role === "user" && message.content?.trim()) return message.content.trim()
  }
}

export function composePrompt(messages: ChatMessage[]): string {
  const lastUserIndex = findLastUserIndex(messages)
  const lastUser = lastUserIndex === -1 ? "" : messages[lastUserIndex]?.content?.trim() ?? ""
  const calls = toolCallMap(messages)
  const toolMessages = messages.filter((message) => message.role === "tool" && message.content?.trim())
  const history = messages
    .filter((message, index) => index !== lastUserIndex && message.role !== "tool" && message.content?.trim())
    .filter((message) => message.role !== "system")
    .slice(-6)

  const parts: string[] = []
  if (history.length) parts.push(history.map(formatTurn).join("\n"))
  if (toolMessages.length)
    parts.push(toolMessages.map((message) => formatTool(message, calls.get(message.tool_call_id ?? ""))).join("\n"))
  if (!parts.length) return lastUser

  return `${truncate(parts.join("\n\n"), 12000)}\n\nВопрос: ${sanitizeQuestion(lastUser)}`
}

function formatTurn(message: ChatMessage): string {
  const label = message.role === "assistant" ? "Ассистент" : "Пользователь"
  return `${label}: ${truncate(message.content?.trim() ?? "", 4000)}`
}

type ToolCall = { name: string; arguments: Record<string, unknown> }

function toolCallMap(messages: ChatMessage[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>()
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      calls.set(call.id, { name: call.function.name, arguments: parseArguments(call.function.arguments) })
    }
  }
  return calls
}

function parseArguments(value: string | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function formatTool(message: ChatMessage, call: ToolCall | undefined): string {
  const name = message.name ?? call?.name ?? "action"
  const content = truncate(stripToolHeader(message.content?.trim() ?? ""), 8000)
  const args = call?.arguments ?? {}
  const path = typeof args.filePath === "string" ? args.filePath : typeof args.path === "string" ? args.path : undefined

  if (/(^|_)read$|read_file|^cat$/.test(name) && path) return `Содержимое файла ${path}: ${content}`
  if (/(^|_)bash$|shell|run_command|execute/.test(name)) return `Вывод команды: ${content}`
  if (/glob|list_files|^ls$|list/.test(name)) return `Файлы проекта: ${content}`
  if (/grep|search|ripgrep/.test(name)) return `Результаты поиска: ${content}`
  return `Данные (${name}): ${content}`
}

/** OpenCode prefixes read results with "Read file X, lines 1-21"; the assistant moderates on that header. */
export function stripToolHeader(content: string): string {
  return content
    .split("\n")
    .filter((line) => !/^(Read file|Wrote file|Edited file|List of files|Found \d+ files?)/i.test(line.trim()))
    .join("\n")
    .trim()
}

/** Turns "прочитай файл package.json и скажи имя пакета" into a neutral "скажи имя пакета". */
export function sanitizeQuestion(question: string): string {
  const stripped = question
    .replace(
      /^\s*(?:пожалуйста[,\s]+)?(?:прочитай|прочти|покажи|открой|посмотри|выполни|запусти|найди|проверь|read|show|open|run|execute|find)(?![\p{L}\p{N}_])[\s,:—–-]*/iu,
      "",
    )
    .replace(/^\s*(?:файл\s+)?[\w./@-]+\.\w+\s*(?:и\s+)?/i, "")
    .trim()

  if (stripped.length < 3) return question
  return stripped
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

function findLastUserIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") return index
  }
  return -1
}

export function readChatRequest(body: unknown): ChatRequest | undefined {
  if (typeof body !== "object" || body === null) return
  const value = body as Record<string, unknown>
  if (!Array.isArray(value.messages)) return

  const messages: ChatMessage[] = value.messages.flatMap((message) => {
    if (typeof message !== "object" || message === null) return []
    const item = message as Record<string, unknown>
    const role = item.role
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") return []
    const content = typeof item.content === "string" ? item.content : null
    return [
      {
        role,
        content,
        tool_call_id: typeof item.tool_call_id === "string" ? item.tool_call_id : undefined,
        name: typeof item.name === "string" ? item.name : undefined,
      },
    ]
  })

  return {
    model: typeof value.model === "string" ? value.model : undefined,
    stream: value.stream === true,
    session_id: typeof value.session_id === "string" ? value.session_id : undefined,
    tools: readTools(value.tools),
    messages,
  }
}

function readTools(value: unknown): ToolSpec[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const item = entry as Record<string, unknown>
    const fn = typeof item.function === "object" && item.function !== null ? (item.function as Record<string, unknown>) : item
    if (typeof fn.name !== "string") return []
    return [{ name: fn.name, description: typeof fn.description === "string" ? fn.description : "" }]
  })
}
