import { ProviderHelper, CommonRequest, CommonResponse, CommonChunk } from "./provider"

type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  // used by moonshot
  cached_tokens?: number
  // used by xai
  prompt_tokens_details?: {
    text_tokens?: number
    audio_tokens?: number
    image_tokens?: number
    cached_tokens?: number
  }
  completion_tokens_details?: {
    reasoning_tokens?: number
    audio_tokens?: number
    accepted_prediction_tokens?: number
    rejected_prediction_tokens?: number
  }
}

export const oaCompatHelper: ProviderHelper = () => ({
  format: "oa-compat",
  modifyUrl: (providerApi: string) => providerApi + "/chat/completions",
  modifyHeaders: (headers: Headers, body: Record<string, any>, apiKey: string) => {
    headers.set("authorization", `Bearer ${apiKey}`)
  },
  modifyBody: (body: Record<string, any>) => {
    return {
      ...body,
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    }
  },
  createBinaryStreamDecoder: () => undefined,
  streamSeparator: "\n\n",
  createUsageParser: () => {
    let usage: Usage

    return {
      parse: (chunk: string) => {
        if (!chunk.startsWith("data: ")) return

        let json
        try {
          json = JSON.parse(chunk.slice(6)) as { usage?: Usage }
        } catch (e) {
          return
        }

        if (!json.usage) return
        usage = json.usage
      },
      retrieve: () => usage,
    }
  },
  normalizeUsage: (usage: Usage) => {
    const inputTokens = usage.prompt_tokens ?? 0
    const outputTokens = usage.completion_tokens ?? 0
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? undefined
    const cacheReadTokens = usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? undefined
    return {
      inputTokens: inputTokens - (cacheReadTokens ?? 0),
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWrite5mTokens: undefined,
      cacheWrite1hTokens: undefined,
    }
  },
})

export function fromOaCompatibleRequest(body: any): CommonRequest {
  if (!body || typeof body !== "object") return body

  const msgsIn = Array.isArray(body.messages) ? body.messages : []
  const msgsOut: any[] = []

  for (const m of msgsIn) {
    if (!m || !m.role) continue

    if (m.role === "system") {
      if (typeof m.content === "string" && m.content.length > 0) msgsOut.push({ role: "system", content: m.content })
      continue
    }

    if (m.role === "user") {
      if (typeof m.content === "string") {
        msgsOut.push({ role: "user", content: m.content })
      } else if (Array.isArray(m.content)) {
        const parts: any[] = []
        for (const p of m.content) {
          if (!p || !p.type) continue
          if (p.type === "text" && typeof p.text === "string") parts.push({ type: "text", text: p.text })
          if (p.type === "image_url") parts.push({ type: "image_url", image_url: p.image_url })
        }
        if (parts.length === 1 && parts[0].type === "text") msgsOut.push({ role: "user", content: parts[0].text })
        else if (parts.length > 0) msgsOut.push({ role: "user", content: parts })
      }
      continue
    }

    if (m.role === "assistant") {
      const out: any = { role: "assistant" }
      if (typeof m.content === "string") out.content = m.content
      if (Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls
      msgsOut.push(out)
      continue
    }

    if (m.role === "tool") {
      msgsOut.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content })
      continue
    }
  }

  return {
    model: body.model,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop,
    messages: msgsOut,
    stream: !!body.stream,
    tools: Array.isArray(body.tools) ? body.tools : undefined,
    tool_choice: body.tool_choice,
  }
}

export function toOaCompatibleRequest(body: CommonRequest) {
  if (!body || typeof body !== "object") return body

  const msgsIn = Array.isArray(body.messages) ? body.messages : []
  const msgsOut: any[] = []

  const toImg = (p: any) => {
    if (!p || typeof p !== "object") return undefined
    if (p.type === "image_url" && p.image_url) return { type: "image_url", image_url: p.image_url }
    const s = (p as any).source
    if (!s || typeof s !== "object") return undefined
    if (s.type === "url" && typeof s.url === "string") return { type: "image_url", image_url: { url: s.url } }
    if (s.type === "base64" && typeof s.media_type === "string" && typeof s.data === "string")
      return { type: "image_url", image_url: { url: `data:${s.media_type};base64,${s.data}` } }
    return undefined
  }

  for (const m of msgsIn) {
    if (!m || !m.role) continue

    if (m.role === "system") {
      if (typeof m.content === "string" && m.content.length > 0) msgsOut.push({ role: "system", content: m.content })
      continue
    }

    if (m.role === "user") {
      if (typeof m.content === "string") {
        msgsOut.push({ role: "user", content: m.content })
        continue
      }
      if (Array.isArray(m.content)) {
        const parts: any[] = []
        for (const p of m.content) {
          if (!p || !p.type) continue
          if (p.type === "text" && typeof p.text === "string") parts.push({ type: "text", text: p.text })
          const ip = toImg(p)
          if (ip) parts.push(ip)
        }
        if (parts.length === 1 && parts[0].type === "text") msgsOut.push({ role: "user", content: parts[0].text })
        else if (parts.length > 0) msgsOut.push({ role: "user", content: parts })
      }
      continue
    }

    if (m.role === "assistant") {
      const out: any = { role: "assistant" }
      if (typeof m.content === "string") out.content = m.content
      if (Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls
      msgsOut.push(out)
      continue
    }

    if (m.role === "tool") {
      msgsOut.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content })
      continue
    }
  }

  const tools = Array.isArray(body.tools)
    ? body.tools.map((tool: any) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
    : undefined

  return {
    model: body.model,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop,
    messages: msgsOut,
    stream: !!body.stream,
    tools,
    tool_choice: body.tool_choice,
    response_format: (body as any).response_format,
  }
}

export function fromOaCompatibleResponse(resp: any): CommonResponse {
  if (!resp || typeof resp !== "object") return resp

  if (!Array.isArray((resp as any).choices)) return resp

  const choice = (resp as any).choices[0]
  if (!choice) return resp

  const message = choice.message
  if (!message) return resp

  const content: any[] = []

  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content })
  }

  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.type === "function" && toolCall.function) {
        let input
        try {
          input = JSON.parse(toolCall.function.arguments)
        } catch {
          input = toolCall.function.arguments
        }
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input,
        })
      }
    }
  }

  const stopReason = (() => {
    const reason = choice.finish_reason
    if (reason === "stop") return "stop"
    if (reason === "tool_calls") return "tool_calls"
    if (reason === "length") return "length"
    if (reason === "content_filter") return "content_filter"
    return null
  })()

  const usage = (() => {
    const u = (resp as any).usage
    if (!u) return undefined
    return {
      prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens,
      total_tokens: u.total_tokens,
      ...(u.prompt_tokens_details?.cached_tokens
        ? { prompt_tokens_details: { cached_tokens: u.prompt_tokens_details.cached_tokens } }
        : {}),
    }
  })()

  return {
    id: (resp as any).id,
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model: (resp as any).model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant" as const,
          ...(content.length > 0 && content.some((c) => c.type === "text")
            ? {
                content: content
                  .filter((c) => c.type === "text")
                  .map((c: any) => c.text)
                  .join(""),
              }
            : {}),
          ...(content.length > 0 && content.some((c) => c.type === "tool_use")
            ? {
                tool_calls: content
                  .filter((c) => c.type === "tool_use")
                  .map((c: any) => ({
                    id: c.id,
                    type: "function" as const,
                    function: {
                      name: c.name,
                      arguments: typeof c.input === "string" ? c.input : JSON.stringify(c.input),
                    },
                  })),
              }
            : {}),
        },
        finish_reason: stopReason,
      },
    ],
    ...(usage ? { usage } : {}),
  }
}

export function toOaCompatibleResponse(resp: CommonResponse) {
  if (!resp || typeof resp !== "object") return resp

  if (Array.isArray((resp as any).choices)) return resp

  const isAnthropic = typeof (resp as any).type === "string" && (resp as any).type === "message"
  if (!isAnthropic) return resp

  const idIn = (resp as any).id
  const id =
    typeof idIn === "string" ? idIn.replace(/^msg_/, "chatcmpl_") : `chatcmpl_${Math.random().toString(36).slice(2)}`
  const model = (resp as any).model

  const blocks: any[] = Array.isArray((resp as any).content) ? (resp as any).content : []
  const text = blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
  const tcs = blocks
    .filter((b) => b && b.type === "tool_use")
    .map((b) => {
      const name = (b as any).name
      const args = (() => {
        const inp = (b as any).input
        if (typeof inp === "string") return inp
        try {
          return JSON.stringify(inp ?? {})
        } catch {
          return String(inp ?? "")
        }
      })()
      const tid =
        typeof (b as any).id === "string" && (b as any).id.length > 0
          ? (b as any).id
          : `toolu_${Math.random().toString(36).slice(2)}`
      return { id: tid, type: "function" as const, function: { name, arguments: args } }
    })

  const finish = (r: string | null) => {
    if (r === "end_turn") return "stop"
    if (r === "tool_use") return "tool_calls"
    if (r === "max_tokens") return "length"
    if (r === "content_filter") return "content_filter"
    return null
  }

  const u = (resp as any).usage
  const usage = (() => {
    if (!u) return undefined as any
    const pt = typeof u.input_tokens === "number" ? u.input_tokens : undefined
    const ct = typeof u.output_tokens === "number" ? u.output_tokens : undefined
    const total = pt != null && ct != null ? pt + ct : undefined
    const cached = typeof u.cache_read_input_tokens === "number" ? u.cache_read_input_tokens : undefined
    const details = cached != null ? { cached_tokens: cached } : undefined
    return {
      prompt_tokens: pt,
      completion_tokens: ct,
      total_tokens: total,
      ...(details ? { prompt_tokens_details: details } : {}),
    }
  })()

  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          ...(text && text.length > 0 ? { content: text } : {}),
          ...(tcs.length > 0 ? { tool_calls: tcs } : {}),
        },
        finish_reason: finish((resp as any).stop_reason ?? null),
      },
    ],
    ...(usage ? { usage } : {}),
  }
}

export function fromOaCompatibleChunk(chunk: string): CommonChunk | string {
  if (!chunk.startsWith("data: ")) return chunk

  let json
  try {
    json = JSON.parse(chunk.slice(6))
  } catch {
    return chunk
  }

  if (!json.choices || !Array.isArray(json.choices) || json.choices.length === 0) {
    return chunk
  }

  const choice = json.choices[0]
  const delta = choice.delta

  if (!delta) return chunk

  const result: CommonChunk = {
    id: json.id ?? "",
    object: "chat.completion.chunk",
    created: json.created ?? Math.floor(Date.now() / 1000),
    model: json.model ?? "",
    choices: [],
  }

  if (delta.content) {
    result.choices.push({
      index: choice.index ?? 0,
      delta: { content: delta.content },
      finish_reason: null,
    })
  }

  if (delta.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      result.choices.push({
        index: choice.index ?? 0,
        delta: {
          tool_calls: [
            {
              index: toolCall.index ?? 0,
              id: toolCall.id,
              type: toolCall.type ?? "function",
              function: toolCall.function,
            },
          ],
        },
        finish_reason: null,
      })
    }
  }

  if (choice.finish_reason) {
    result.choices.push({
      index: choice.index ?? 0,
      delta: {},
      finish_reason: choice.finish_reason,
    })
  }

  if (json.usage) {
    const usage = json.usage
    result.usage = {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      ...(usage.prompt_tokens_details?.cached_tokens
        ? { prompt_tokens_details: { cached_tokens: usage.prompt_tokens_details.cached_tokens } }
        : {}),
    }
  }

  return result
}

export function toOaCompatibleChunk(chunk: CommonChunk): string {
  const result: any = {
    id: chunk.id,
    object: "chat.completion.chunk",
    created: chunk.created,
    model: chunk.model,
    choices: [],
  }

  if (!chunk.choices || chunk.choices.length === 0) {
    return `data: ${JSON.stringify(result)}`
  }

  const choice = chunk.choices[0]
  const delta = choice.delta

  if (delta?.role) {
    result.choices.push({
      index: choice.index,
      delta: { role: delta.role },
      finish_reason: null,
    })
  }

  if (delta?.content) {
    result.choices.push({
      index: choice.index,
      delta: { content: delta.content },
      finish_reason: null,
    })
  }

  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      result.choices.push({
        index: choice.index,
        delta: {
          tool_calls: [
            {
              index: tc.index,
              id: tc.id,
              type: tc.type,
              function: tc.function,
            },
          ],
        },
        finish_reason: null,
      })
    }
  }

  if (choice.finish_reason) {
    result.choices.push({
      index: choice.index,
      delta: {},
      finish_reason: choice.finish_reason,
    })
  }

  if (chunk.usage) {
    result.usage = {
      prompt_tokens: chunk.usage.prompt_tokens,
      completion_tokens: chunk.usage.completion_tokens,
      total_tokens: chunk.usage.total_tokens,
      ...(chunk.usage.prompt_tokens_details?.cached_tokens
        ? {
            prompt_tokens_details: {
              cached_tokens: chunk.usage.prompt_tokens_details.cached_tokens,
            },
          }
        : {}),
    }
  }

  return `data: ${JSON.stringify(result)}`
}
