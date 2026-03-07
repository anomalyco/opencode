type RawFunctionCallToolParser = {
  type: "raw-function-call"
}

type JsonToolParser = {
  type: "json"
}

type SingleToolTextParser = {
  type: "single-tool-text"
  tool: string
  argument: string
  descriptionArgument?: string
  descriptionTemplate?: string
}

export type OpenAICompatibleToolParser = RawFunctionCallToolParser | JsonToolParser | SingleToolTextParser

type OpenAICompatibleToolCall = {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

const SYNTHETIC_TOOL_CALL_ID = "call_opencode_compat_0"

export function getOpenAICompatibleToolParsers(options: Record<string, any>) {
  const input = options["toolParser"]
  if (!Array.isArray(input)) return [] as OpenAICompatibleToolParser[]

  return input.flatMap((item): OpenAICompatibleToolParser[] => {
    if (!item || typeof item !== "object") return []
    if (item.type === "raw-function-call") {
      return [{ type: "raw-function-call" }]
    }
    if (item.type === "json") {
      return [{ type: "json" }]
    }
    if (item.type === "single-tool-text" && typeof item.tool === "string" && typeof item.argument === "string") {
      return [
        {
          type: "single-tool-text",
          tool: item.tool,
          argument: item.argument,
          descriptionArgument: typeof item.descriptionArgument === "string" ? item.descriptionArgument : undefined,
          descriptionTemplate: typeof item.descriptionTemplate === "string" ? item.descriptionTemplate : undefined,
        },
      ]
    }
    return []
  })
}

export function rewriteOpenAICompatibleRequestBody(
  body: Record<string, any>,
  parsers: OpenAICompatibleToolParser[],
): Record<string, any> {
  if (!parsers.some((parser) => parser.type === "raw-function-call")) {
    return body
  }

  const next = JSON.parse(JSON.stringify(body))
  const tools = Array.isArray(next.tools) ? next.tools : []
  const functions = tools
    .filter((tool: any) => tool?.type === "function" && tool.function)
    .map((tool: any) => tool.function)

  if (functions.length > 0 && next.functions === undefined) {
    next.functions = functions
  }

  if (next.function_call === undefined && next.tool_choice !== undefined) {
    if (next.tool_choice === "auto" || next.tool_choice === "none") {
      next.function_call = next.tool_choice
    } else if (next.tool_choice === "required") {
      next.function_call = functions.length === 1 ? { name: functions[0].name } : "auto"
    } else if (typeof next.tool_choice === "object" && next.tool_choice?.function?.name) {
      next.function_call = { name: next.tool_choice.function.name }
    }
  }

  delete next.tools
  delete next.tool_choice
  delete next.parallel_tool_calls

  return next
}

export function rewriteOpenAICompatibleJsonResponse(
  body: Record<string, any>,
  parsers: OpenAICompatibleToolParser[],
): Record<string, any> {
  const next = JSON.parse(JSON.stringify(body))
  const choice = next?.choices?.[0]
  if (!choice) return next

  normalizeLegacyFunctionCall(choice)

  if (!choice.message?.tool_calls?.length) {
    const parsed = parseToolCallFromContent(choice.message?.content, parsers)
    if (parsed) {
      choice.message.content = null
      choice.message.tool_calls = [parsed]
      choice.finish_reason = "tool_calls"
    }
  }

  return next
}

export function rewriteOpenAICompatibleStreamResponse(text: string, parsers: OpenAICompatibleToolParser[]) {
  const events = parseSSEEvents(text)
  const transformed = events.map((event) => transformChunkEvent(event, parsers))

  if (!parsers.some((parser) => parser.type === "json" || parser.type === "single-tool-text")) {
    return serializeSSEEvents(transformed)
  }

  const content = transformed
    .flatMap((event) => {
      if (event.type !== "json") return []
      const choice = event.value?.choices?.[0]
      const delta = choice?.delta
      return typeof delta?.content === "string" ? [delta.content] : []
    })
    .join("")
    .trim()

  const alreadyHasToolCalls = transformed.some((event) => {
    if (event.type !== "json") return false
    const choice = event.value?.choices?.[0]
    return Boolean(choice?.delta?.tool_calls?.length)
  })

  if (alreadyHasToolCalls) {
    return serializeSSEEvents(transformed)
  }

  const parsed = parseToolCallFromContent(content, parsers)
  if (!parsed) {
    return serializeSSEEvents(transformed)
  }

  const firstJson = transformed.find((event): event is Extract<ParsedSSEEvent, { type: "json" }> => event.type === "json")
  const usage = [...transformed]
    .reverse()
    .find((event): event is Extract<ParsedSSEEvent, { type: "json" }> => event.type === "json" && !!event.value?.usage)
    ?.value?.usage

  const synthetic: ParsedSSEEvent[] = []

  if (firstJson) {
    synthetic.push({
      type: "json",
      value: {
        id: firstJson.value?.id,
        created: firstJson.value?.created,
        model: firstJson.value?.model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
            },
            finish_reason: null,
          },
        ],
      },
    })
    synthetic.push({
      type: "json",
      value: {
        id: firstJson.value?.id,
        created: firstJson.value?.created,
        model: firstJson.value?.model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: parsed.id,
                  type: "function",
                  function: parsed.function,
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage,
      },
    })
  }

  if (transformed.some((event) => event.type === "done")) {
    synthetic.push({ type: "done" })
  }

  return serializeSSEEvents(synthetic)
}

type ParsedSSEEvent =
  | {
      type: "done"
    }
  | {
      type: "raw"
      data: string
    }
  | {
      type: "json"
      value: Record<string, any>
    }

function transformChunkEvent(event: ParsedSSEEvent, parsers: OpenAICompatibleToolParser[]) {
  if (event.type !== "json") return event
  const value = JSON.parse(JSON.stringify(event.value))
  const choice = value?.choices?.[0]
  if (!choice) return event

  normalizeLegacyFunctionCall(choice)

  const delta = choice?.delta
  if (delta?.function_call && !delta.tool_calls) {
    const legacy = delta.function_call
    delta.tool_calls = [
      {
        index: 0,
        id: SYNTHETIC_TOOL_CALL_ID,
        type: "function",
        function: {
          name: legacy.name ?? undefined,
          arguments: legacy.arguments ?? "",
        },
      },
    ]
    delete delta.function_call
  }

  if (choice.finish_reason === "function_call") {
    choice.finish_reason = "tool_calls"
  }

  return {
    type: "json",
    value,
  } satisfies ParsedSSEEvent
}

function normalizeLegacyFunctionCall(choice: Record<string, any>) {
  if (choice?.message?.function_call && !choice?.message?.tool_calls) {
    const legacy = choice.message.function_call
    choice.message.tool_calls = [
      {
        id: SYNTHETIC_TOOL_CALL_ID,
        type: "function",
        function: {
          name: legacy.name,
          arguments: legacy.arguments ?? "",
        },
      },
    ]
    delete choice.message.function_call
  }

  if (choice?.finish_reason === "function_call") {
    choice.finish_reason = "tool_calls"
  }
}

function parseToolCallFromContent(content: unknown, parsers: OpenAICompatibleToolParser[]) {
  if (typeof content !== "string") return
  const trimmed = content.trim()
  if (!trimmed) return

  for (const parser of parsers) {
    if (parser.type === "json") {
      const parsed = parseJsonToolCall(trimmed)
      if (parsed) return parsed
    }

    if (parser.type === "single-tool-text") {
      const parsed = parseSingleToolText(trimmed, parser)
      if (parsed) return parsed
    }
  }
}

function parseJsonToolCall(content: string): OpenAICompatibleToolCall | undefined {
  const candidates = [content, stripMarkdownCodeFence(content), extractTaggedContent(content, "tool_call")].filter(Boolean)

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate!)
    const toolCall = parsed ? toToolCall(parsed) : undefined
    if (toolCall) return toolCall
  }
}

function parseSingleToolText(content: string, parser: SingleToolTextParser): OpenAICompatibleToolCall | undefined {
  const text = stripMarkdownCodeFence(content) ?? content
  const value = text.trim()
  if (!value || value.length > 4000) return

  const input: Record<string, string> = {
    [parser.argument]: value,
  }

  if (parser.descriptionArgument && parser.descriptionTemplate) {
    input[parser.descriptionArgument] = parser.descriptionTemplate.replaceAll("{value}", value)
  }

  return {
    id: SYNTHETIC_TOOL_CALL_ID,
    type: "function",
    function: {
      name: parser.tool,
      arguments: JSON.stringify(input),
    },
  }
}

function toToolCall(parsed: any): OpenAICompatibleToolCall | undefined {
  const fromFunction = parsed?.function
  const name =
    asString(parsed?.name) ??
    asString(parsed?.tool) ??
    asString(parsed?.toolName) ??
    asString(fromFunction?.name) ??
    undefined

  if (!name) return

  const args = parsed?.arguments ?? parsed?.input ?? parsed?.args ?? fromFunction?.arguments
  const normalizedArguments = normalizeArguments(args)
  if (!normalizedArguments) return

  return {
    id: SYNTHETIC_TOOL_CALL_ID,
    type: "function",
    function: {
      name,
      arguments: normalizedArguments,
    },
  }
}

function normalizeArguments(input: unknown) {
  if (typeof input === "string") {
    if (tryParseJson(input)) return input
    return
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    return JSON.stringify(input)
  }
}

function asString(input: unknown) {
  return typeof input === "string" && input.trim() ? input.trim() : undefined
}

function stripMarkdownCodeFence(input: string) {
  const match = input.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1]?.trim()
}

function extractTaggedContent(input: string, tag: string) {
  const match = input.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))
  return match?.[1]?.trim()
}

function tryParseJson(input: string) {
  try {
    return JSON.parse(input)
  } catch {
    return undefined
  }
}

function parseSSEEvents(text: string): ParsedSSEEvent[] {
  return text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block): ParsedSSEEvent => {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")

      if (data === "[DONE]") return { type: "done" }
      const parsed = tryParseJson(data)
      if (!parsed) return { type: "raw", data }
      return { type: "json", value: parsed }
    })
}

function serializeSSEEvents(events: ParsedSSEEvent[]) {
  return events
    .map((event) => {
      if (event.type === "done") return "data: [DONE]\n\n"
      if (event.type === "raw") return `data: ${event.data}\n\n`
      return `data: ${JSON.stringify(event.value)}\n\n`
    })
    .join("")
}
