import { Option, Schema } from "effect"

const FunctionName = Schema.Struct({ name: Schema.optionalKey(Schema.String) })
const Call = Schema.Struct({ function: Schema.optionalKey(FunctionName) })
const Calls = Schema.optionalKey(Schema.Array(Call))
const Chat = Schema.Struct({
  tools: Schema.optionalKey(Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) }))),
  messages: Schema.optionalKey(Schema.Array(Schema.Struct({ tool_calls: Calls }))),
  tool_choice: Schema.optionalKey(Schema.Union([Schema.String, Call])),
})
const ResponseBody = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      delta: Schema.optionalKey(Schema.Struct({ tool_calls: Calls })),
      message: Schema.optionalKey(Schema.Struct({ tool_calls: Calls })),
    }),
  ),
})
const decodeResponse = Schema.decodeUnknownOption(Schema.fromJsonString(ResponseBody))

/** The free gateway recognizes `read`; execution remains Code Mode's execute tool. */
export async function aliasRequest(request: Request) {
  const text = await request.clone().text()
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Chat))(text)
  if (Option.isNone(decoded)) return
  const body = decoded.value
  if (
    !body.tools?.some((tool) => tool.function.name === "execute") ||
    body.tools.some((tool) => tool.function.name === "read")
  )
    return
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text) as Record<string, unknown>
  } catch {
    return
  }
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  const renameExecute = (item: unknown) => {
    if (typeof item !== "object" || item === null) return item
    const record = item as Record<string, unknown>
    const fn = record.function as Record<string, unknown> | undefined
    if (fn?.name !== "execute") return item
    return { ...record, function: { ...fn, name: "read" } }
  }
  const tools = Array.isArray(raw.tools) ? (raw.tools as unknown[]).map(renameExecute) : raw.tools
  const messages = Array.isArray(raw.messages)
    ? (raw.messages as unknown[]).map((message) => {
        if (typeof message !== "object" || message === null) return message
        const record = message as Record<string, unknown>
        if (!Array.isArray(record.tool_calls)) return message
        return { ...record, tool_calls: (record.tool_calls as unknown[]).map(renameExecute) }
      })
    : raw.messages
  const toolChoice = raw.tool_choice
  return new Request(request, {
    headers,
    body: JSON.stringify({
      ...raw,
      tools,
      messages,
      tool_choice:
        typeof toolChoice === "object" && toolChoice !== null
          ? renameExecute(toolChoice)
          : toolChoice,
    }),
  })
}

function responseText(text: string) {
  const decoded = decodeResponse(text)
  if (Option.isNone(decoded)) return text
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text) as Record<string, unknown>
  } catch {
    return text
  }
  const renameRead = (item: unknown) => {
    if (typeof item !== "object" || item === null) return item
    const record = item as Record<string, unknown>
    const fn = record.function as Record<string, unknown> | undefined
    if (fn?.name !== "read") return item
    return { ...record, function: { ...fn, name: "execute" } }
  }
  const rawChoices = Array.isArray(raw.choices) ? (raw.choices as unknown[]) : []
  return JSON.stringify({
    ...raw,
    choices: rawChoices.map((choice) => {
      if (typeof choice !== "object" || choice === null) return choice
      const record = choice as Record<string, unknown>
      const delta = record.delta as Record<string, unknown> | undefined
      const message = record.message as Record<string, unknown> | undefined
      return {
        ...record,
        ...(delta
          ? {
              delta: {
                ...delta,
                ...(Array.isArray(delta.tool_calls)
                  ? { tool_calls: (delta.tool_calls as unknown[]).map(renameRead) }
                  : {}),
              },
            }
          : {}),
        ...(message
          ? {
              message: {
                ...message,
                ...(Array.isArray(message.tool_calls)
                  ? { tool_calls: (message.tool_calls as unknown[]).map(renameRead) }
                  : {}),
              },
            }
          : {}),
      };
    }),
  })
}

export async function aliasResponse(response: Response) {
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  const init = { status: response.status, statusText: response.statusText, headers }
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return new Response(responseText(await response.text()), init)
  if (!response.body) return response
  let pending = ""
  const body = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          pending += chunk
          const lines = pending.split("\n")
          pending = lines.pop() ?? ""
          for (const line of lines)
            controller.enqueue((line.startsWith("data: ") ? `data: ${responseText(line.slice(6))}` : line) + "\n")
        },
        flush(controller) {
          if (pending)
            controller.enqueue(pending.startsWith("data: ") ? `data: ${responseText(pending.slice(6))}` : pending)
        },
      }),
    )
    .pipeThrough(new TextEncoderStream())
  return new Response(body, init)
}
