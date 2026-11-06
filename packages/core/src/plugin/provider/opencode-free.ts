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
const options = { onExcessProperty: "preserve" } as const
const decodeResponse = Schema.decodeUnknownOption(Schema.fromJsonString(ResponseBody), options)

/** The free gateway recognizes `read`; execution remains Code Mode's execute tool. */
export async function aliasRequest(request: Request) {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Chat), options)(await request.clone().text())
  if (Option.isNone(decoded)) return
  const body = decoded.value
  if (
    !body.tools?.some((tool) => tool.function.name === "execute") ||
    body.tools.some((tool) => tool.function.name === "read")
  )
    return
  const name = (call: typeof Call.Type) =>
    call.function?.name === "execute" ? { ...call, function: { ...call.function, name: "read" } } : call
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  return new Request(request, {
    headers,
    body: JSON.stringify({
      ...body,
      tools: body.tools.map(name),
      messages: body.messages?.map((message) =>
        message.tool_calls ? { ...message, tool_calls: message.tool_calls.map(name) } : message,
      ),
      tool_choice: typeof body.tool_choice === "object" ? name(body.tool_choice) : body.tool_choice,
    }),
  })
}

function responseText(text: string) {
  const decoded = decodeResponse(text)
  if (Option.isNone(decoded)) return text
  const calls = (call: typeof Call.Type) =>
    call.function?.name === "read" ? { ...call, function: { ...call.function, name: "execute" } } : call
  return JSON.stringify({
    ...decoded.value,
    choices: decoded.value.choices.map((choice) => ({
      ...choice,
      ...(choice.delta
        ? {
            delta: {
              ...choice.delta,
              ...(choice.delta.tool_calls ? { tool_calls: choice.delta.tool_calls.map(calls) } : {}),
            },
          }
        : {}),
      ...(choice.message
        ? {
            message: {
              ...choice.message,
              ...(choice.message.tool_calls ? { tool_calls: choice.message.tool_calls.map(calls) } : {}),
            },
          }
        : {}),
    })),
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
