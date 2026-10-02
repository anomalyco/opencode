// GLM is served through Chat Completions. Keep this adapter at the Go API
// boundary so the normal authentication, routing, and billing path is shared.
export function toChatRequest(body: Record<string, unknown>) {
  const messages: Record<string, unknown>[] = []
  if (typeof body.instructions === "string" && body.instructions)
    messages.push({ role: "system", content: body.instructions })

  const input = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input
  if (!Array.isArray(input)) throw new Error("Responses input must be a string or an array")

  for (const item of input) {
    if (!item || typeof item !== "object") continue
    if (item.type === "function_call") {
      const callID = item.call_id
      if (typeof callID !== "string" || typeof item.name !== "string")
        throw new Error("Function calls require call_id and name")
      const previous = messages.at(-1)
      const message = previous?.role === "assistant" ? previous : { role: "assistant" }
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      calls.push({
        id: callID,
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
        },
      })
      message.tool_calls = calls
      if (message !== previous) messages.push(message)
      continue
    }
    if (item.type === "function_call_output") {
      if (typeof item.call_id !== "string") throw new Error("Function outputs require call_id")
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      })
      continue
    }
    if (!["system", "developer", "user", "assistant"].includes(item.role)) continue
    const content = Array.isArray(item.content)
      ? item.content.flatMap((part: Record<string, unknown>) => {
          if (!part || typeof part !== "object") return []
          if (["input_text", "output_text", "text"].includes(String(part.type)) && typeof part.text === "string")
            return [{ type: "text", text: part.text }]
          if (part.type === "input_image" && typeof part.image_url === "string")
            return [{ type: "image_url", image_url: { url: part.image_url } }]
          return []
        })
      : item.content
    const role = item.role === "developer" ? "system" : item.role
    const value =
      Array.isArray(content) && content.length === 1 && content[0].type === "text" ? content[0].text : content
    if (role === "assistant" && (!value || (Array.isArray(value) && value.length === 0))) continue
    if (role === "assistant" && messages.at(-1)?.role === "assistant") {
      messages.at(-1)!.content = value
      continue
    }
    messages.push({ role, content: value })
  }

  const tools = Array.isArray(body.tools)
    ? body.tools
        .filter((tool) => tool?.type === "function" && typeof tool.name === "string")
        .map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            ...(typeof tool.description === "string" ? { description: tool.description } : {}),
            ...(tool.parameters ? { parameters: tool.parameters } : {}),
          },
        }))
    : undefined
  const toolChoice = body.tool_choice
  const choice =
    toolChoice &&
    typeof toolChoice === "object" &&
    "type" in toolChoice &&
    "name" in toolChoice &&
    toolChoice.type === "function" &&
    typeof toolChoice.name === "string"
      ? { type: "function", function: { name: toolChoice.name } }
      : toolChoice === "auto" || toolChoice === "required" || toolChoice === "none"
        ? toolChoice
        : undefined

  return {
    model: body.model,
    messages,
    stream: body.stream === true,
    ...(body.stream === true ? { stream_options: { include_usage: true } } : {}),
    ...(typeof body.max_output_tokens === "number" ? { max_tokens: body.max_output_tokens } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { top_p: body.top_p } : {}),
    ...(tools ? { tools } : {}),
    ...(choice ? { tool_choice: choice } : {}),
    ...(body.parallel_tool_calls === false ? { parallel_tool_calls: false } : {}),
  }
}

export function toChatHttpRequest(request: Request, body: ReturnType<typeof toChatRequest>) {
  const url = new URL(request.url)
  url.pathname = "/zen/go/v1/chat/completions"
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  })
}

type ChatUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

function usage(value?: ChatUsage) {
  if (!value) return null
  const input = value.prompt_tokens ?? 0
  const output = value.completion_tokens ?? 0
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: value.prompt_tokens_details?.cached_tokens ?? 0 },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: value.completion_tokens_details?.reasoning_tokens ?? 0 },
    total_tokens: value.total_tokens ?? input + output,
  }
}

function responseID(id?: string) {
  return id?.replace(/^chatcmpl[-_]/, "resp_") ?? `resp_${crypto.randomUUID()}`
}

export function toResponsesResult(chat: any, model: string) {
  const message = chat.choices?.[0]?.message
  if (!message) throw new Error("Chat response is missing an assistant message")
  const output: Record<string, unknown>[] = []
  if (typeof message?.content === "string" && message.content)
    output.push({
      id: `msg_${crypto.randomUUID()}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: message.content, annotations: [] }],
    })
  for (const call of message?.tool_calls ?? []) {
    if (call.type !== "function") continue
    output.push({
      id: `fc_${crypto.randomUUID()}`,
      type: "function_call",
      status: "completed",
      call_id: call.id,
      name: call.function?.name,
      arguments: call.function?.arguments ?? "",
    })
  }
  return {
    id: responseID(chat.id),
    object: "response",
    created_at: chat.created ?? Math.floor(Date.now() / 1000),
    status: chat.choices?.[0]?.finish_reason === "length" ? "incomplete" : "completed",
    incomplete_details: chat.choices?.[0]?.finish_reason === "length" ? { reason: "max_output_tokens" } : null,
    model,
    output,
    usage: usage(chat.usage),
  }
}

export function createResponsesStream(model: string) {
  let sequence = 0
  let id = responseID()
  let created = Math.floor(Date.now() / 1000)
  let started = false
  let finished = false
  let incomplete = false
  let finalUsage: ChatUsage | undefined
  let text = ""
  let messageID: string | undefined
  let messageIndex = -1
  let nextIndex = 0
  const calls = new Map<number, { id: string; callID: string; name: string; arguments: string; outputIndex: number }>()
  const emit = (type: string, data: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({
      type,
      ...(["response.created", "response.in_progress", "response.completed", "response.incomplete"].includes(type)
        ? {}
        : { response_id: id }),
      ...data,
      sequence_number: sequence++,
    })}\n\n`
  const snapshot = (status: string, output: Record<string, unknown>[], final = false) => ({
    id,
    object: "response",
    created_at: created,
    status,
    incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
    model,
    output,
    usage: final ? usage(finalUsage) : null,
  })
  const start = () => {
    if (started) return ""
    started = true
    return (
      emit("response.created", { response: snapshot("in_progress", []) }) +
      emit("response.in_progress", { response: snapshot("in_progress", []) })
    )
  }
  const addMessage = () => {
    if (messageID) return ""
    messageID = `msg_${crypto.randomUUID()}`
    messageIndex = nextIndex++
    return (
      emit("response.output_item.added", {
        output_index: messageIndex,
        item: { id: messageID, type: "message", role: "assistant", status: "in_progress", content: [] },
      }) +
      emit("response.content_part.added", {
        output_index: messageIndex,
        item_id: messageID,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      })
    )
  }
  return {
    push(chunk: any) {
      if (finished) return ""
      if (chunk.usage) finalUsage = chunk.usage
      if (!Array.isArray(chunk.choices) || chunk.choices.length === 0) return ""
      if (typeof chunk.id === "string" && !started) id = responseID(chunk.id)
      if (typeof chunk.created === "number" && !started) created = chunk.created
      let result = start()
      for (const choice of chunk.choices ?? []) {
        if (choice.finish_reason === "length") incomplete = true
        if (typeof choice.delta?.content === "string" && choice.delta.content) {
          result += addMessage()
          text += choice.delta.content
          result += emit("response.output_text.delta", {
            output_index: messageIndex,
            item_id: messageID,
            content_index: 0,
            delta: choice.delta.content,
          })
        }
        for (const tool of choice.delta?.tool_calls ?? []) {
          if (typeof tool.index !== "number") continue
          let call = calls.get(tool.index)
          if (!call) {
            if (typeof tool.function?.name !== "string" || !tool.function.name) continue
            call = {
              id: `fc_${crypto.randomUUID()}`,
              callID: tool.id ?? `call_${crypto.randomUUID()}`,
              name: tool.function.name,
              arguments: "",
              outputIndex: nextIndex++,
            }
            calls.set(tool.index, call)
            result += emit("response.output_item.added", {
              output_index: call.outputIndex,
              item: {
                id: call.id,
                type: "function_call",
                status: "in_progress",
                call_id: call.callID,
                name: call.name,
                arguments: "",
              },
            })
          }
          if (typeof tool.function?.arguments === "string" && tool.function.arguments) {
            call.arguments += tool.function.arguments
            result += emit("response.function_call_arguments.delta", {
              output_index: call.outputIndex,
              item_id: call.id,
              delta: tool.function.arguments,
            })
          }
        }
      }
      return result
    },
    finish() {
      if (finished) return ""
      if (!started) throw new Error("Chat stream ended without a completion")
      finished = true
      let result = ""
      const output: Record<string, unknown>[] = []
      if (messageID) {
        const part = { type: "output_text", text, annotations: [] }
        const item = { id: messageID, type: "message", role: "assistant", status: "completed", content: [part] }
        result += emit("response.output_text.done", {
          output_index: messageIndex,
          item_id: messageID,
          content_index: 0,
          text,
        })
        result += emit("response.content_part.done", {
          output_index: messageIndex,
          item_id: messageID,
          content_index: 0,
          part,
        })
        result += emit("response.output_item.done", { output_index: messageIndex, item })
        output[messageIndex] = item
      }
      for (const call of calls.values()) {
        const item = {
          id: call.id,
          type: "function_call",
          status: "completed",
          call_id: call.callID,
          name: call.name,
          arguments: call.arguments,
        }
        result += emit("response.function_call_arguments.done", {
          output_index: call.outputIndex,
          item_id: call.id,
          arguments: call.arguments,
        })
        result += emit("response.output_item.done", { output_index: call.outputIndex, item })
        output[call.outputIndex] = item
      }
      const status = incomplete ? "incomplete" : "completed"
      result += emit(incomplete ? "response.incomplete" : "response.completed", {
        response: snapshot(status, output, true),
      })
      return result + "data: [DONE]\n\n"
    },
  }
}

export function toResponsesStream(body: ReadableStream<Uint8Array>, model: string) {
  const adapter = createResponsesStream(model)
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ""
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true })
        const parts = pending.split(/\r\n\r\n|\n\n|\r\r/)
        pending = parts.pop() ?? ""
        for (const part of parts) {
          const data = part
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n")
          if (!data || data === "[DONE]") continue
          const event = (() => {
            try {
              return JSON.parse(data)
            } catch {
              return undefined
            }
          })()
          if (event?.error) throw new Error(event.error.message ?? "Chat upstream failed")
          if (!event || (!Array.isArray(event.choices) && !event.usage)) continue
          const result = adapter.push(event)
          if (result) controller.enqueue(encoder.encode(result))
        }
      },
      flush(controller) {
        const result = adapter.finish()
        controller.enqueue(encoder.encode(result))
      },
    }),
  )
}
