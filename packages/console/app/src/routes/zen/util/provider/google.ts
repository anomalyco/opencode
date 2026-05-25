import { ProviderHelper, CommonRequest, CommonResponse, CommonChunk } from "./provider"

/*
{
  promptTokenCount: 11453,
  candidatesTokenCount: 71,
  totalTokenCount: 11625,
  cachedContentTokenCount: 8100,
  promptTokensDetails: [
    {modality: "TEXT",tokenCount: 11453}
  ],
  cacheTokensDetails: [
    {modality: "TEXT",tokenCount: 8100}
  ],
  thoughtsTokenCount: 101
}
*/

type Usage = {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  cachedContentTokenCount?: number
  promptTokensDetails?: { modality: string; tokenCount: number }[]
  cacheTokensDetails?: { modality: string; tokenCount: number }[]
  thoughtsTokenCount?: number
}

export const googleHelper: ProviderHelper = ({ providerModel }) => ({
  format: "google",
  modifyUrl: (providerApi: string, isStream?: boolean) =>
    `${providerApi}/models/${providerModel}:${isStream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
  modifyHeaders: (headers: Headers, apiKey: string, _stickyId: string) => {
    headers.set("x-goog-api-key", apiKey)
  },
  modifyBody: (body: Record<string, any>) => {
    return body
  },
  createBinaryStreamDecoder: () => undefined,
  streamSeparator: "\r\n\r\n",
  createUsageParser: () => {
    let usage: Usage

    return {
      parse: (chunk: string) => {
        if (!chunk.startsWith("data: ")) return

        let json
        try {
          json = JSON.parse(chunk.slice(6)) as { usageMetadata?: Usage }
        } catch {
          return
        }

        if (!json.usageMetadata) return
        usage = json.usageMetadata
      },
      retrieve: () => usage,
    }
  },
  normalizeUsage: (usage: Usage) => {
    const inputTokens = usage.promptTokenCount ?? 0
    const outputTokens = usage.candidatesTokenCount ?? 0
    const reasoningTokens = usage.thoughtsTokenCount ?? 0
    const cacheReadTokens = usage.cachedContentTokenCount ?? 0
    return {
      inputTokens: inputTokens - cacheReadTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWrite5mTokens: undefined,
      cacheWrite1hTokens: undefined,
    }
  },
})

function toDataUrl(mimeType: string, data: string) {
  return `data:${mimeType};base64,${data}`
}

function fromDataUrl(value: string) {
  const match = value.match(/^data:([^;]+);base64,(.*)$/)
  if (!match) return
  return {
    mimeType: match[1],
    data: match[2],
  }
}

function finishReasonToCommon(value: string | undefined | null): CommonResponse["choices"][number]["finish_reason"] {
  if (value === "STOP") return "stop"
  if (value === "MAX_TOKENS") return "length"
  if (value === "SAFETY") return "content_filter"
  return null
}

function finishReasonToGoogle(value: string | null | undefined) {
  if (value === "stop") return "STOP"
  if (value === "tool_calls") return "STOP"
  if (value === "length") return "MAX_TOKENS"
  if (value === "content_filter") return "SAFETY"
  return "STOP"
}

function textAndImages(parts: any[]) {
  const text = parts
    .filter((p) => p && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
  const images = parts
    .filter(
      (p) => p && p.inlineData && typeof p.inlineData.mimeType === "string" && typeof p.inlineData.data === "string",
    )
    .map((p) => `![generated image](${toDataUrl(p.inlineData.mimeType, p.inlineData.data)})`)
  return [text, ...images].filter(Boolean).join("\n\n")
}

export function fromGoogleRequest(body: any): CommonRequest {
  if (!body || typeof body !== "object") return body

  const systemText = Array.isArray(body.systemInstruction?.parts)
    ? body.systemInstruction.parts
        .filter((p: any) => p && typeof p.text === "string")
        .map((p: any) => p.text)
        .join("\n")
    : ""

  const msgs: any[] = []
  if (systemText) msgs.push({ role: "system", content: systemText })

  const contents = Array.isArray(body.contents) ? body.contents : []
  for (const message of contents) {
    if (!message || !Array.isArray(message.parts)) continue
    const role = message.role === "model" ? "assistant" : "user"

    if (role === "assistant") {
      const content = textAndImages(message.parts)
      const toolCalls = message.parts
        .filter((p: any) => p && p.functionCall && typeof p.functionCall.name === "string")
        .map((p: any) => ({
          id: p.functionCall.name + "_" + Math.random().toString(36).slice(2),
          type: "function" as const,
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args ?? {}),
          },
        }))
      msgs.push({
        role: "assistant",
        ...(content ? { content } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    const parts = [] as any[]
    for (const part of message.parts) {
      if (!part) continue
      if (typeof part.text === "string") parts.push({ type: "text", text: part.text })
      if (part.inlineData && typeof part.inlineData.mimeType === "string" && typeof part.inlineData.data === "string") {
        parts.push({ type: "image_url", image_url: { url: toDataUrl(part.inlineData.mimeType, part.inlineData.data) } })
      }
      if (part.fileData?.fileUri && typeof part.fileData.fileUri === "string") {
        parts.push({ type: "image_url", image_url: { url: part.fileData.fileUri } })
      }
      if (part.functionResponse?.name) {
        msgs.push({
          role: "tool",
          tool_call_id: part.functionResponse.name,
          content: JSON.stringify(part.functionResponse.response ?? {}),
        })
      }
    }
    if (parts.length === 1 && parts[0].type === "text") msgs.push({ role: "user", content: parts[0].text })
    else if (parts.length > 0) msgs.push({ role: "user", content: parts })
  }

  const tools = Array.isArray(body.tools)
    ? body.tools
        .flatMap((tool: any) => (Array.isArray(tool?.functionDeclarations) ? tool.functionDeclarations : []))
        .map((declaration: any) => ({
          type: "function" as const,
          function: {
            name: declaration.name,
            description: declaration.description,
            parameters: declaration.parameters,
          },
        }))
    : undefined

  const mode = body.toolConfig?.functionCallingConfig?.mode
  const tool_choice = mode === "ANY" ? "required" : mode === "NONE" ? undefined : "auto"

  return {
    model: body.model,
    max_tokens: body.generationConfig?.maxOutputTokens,
    temperature: body.generationConfig?.temperature,
    top_p: body.generationConfig?.topP,
    stop: body.generationConfig?.stopSequences,
    messages: msgs,
    stream: !!body.stream,
    tools,
    tool_choice,
  }
}

export function toGoogleRequest(body: CommonRequest) {
  if (!body || typeof body !== "object") return body

  const messages = Array.isArray(body.messages) ? body.messages : []
  const system = messages
    .filter((message) => message.role === "system" && typeof message.content === "string")
    .map((message) => message.content)
    .join("\n")

  const contents: any[] = []
  for (const message of messages) {
    if (!message || message.role === "system") continue

    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.tool_call_id ?? "tool_result",
              response: {
                content: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""),
              },
            },
          },
        ],
      })
      continue
    }

    const role = message.role === "assistant" ? "model" : "user"
    const parts: any[] = []

    const pushImage = (url: string) => {
      const parsed = fromDataUrl(url)
      if (parsed) {
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        })
        return
      }
      parts.push({
        fileData: {
          mimeType: "image/jpeg",
          fileUri: url,
        },
      })
    }

    if (typeof message.content === "string") {
      parts.push({ text: message.content })
    }

    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!part || typeof part !== "object") continue
        if (part.type === "text" && typeof part.text === "string") parts.push({ text: part.text })
        if (part.type === "image_url" && part.image_url) {
          const value = typeof part.image_url === "string" ? part.image_url : part.image_url.url
          if (typeof value === "string") pushImage(value)
        }
      }
    }

    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const tool of message.tool_calls) {
        if (!tool || tool.type !== "function") continue
        let args = {}
        try {
          args = JSON.parse(tool.function.arguments ?? "{}")
        } catch {
          args = {}
        }
        parts.push({
          functionCall: {
            name: tool.function.name,
            args,
          },
        })
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts })
    }
  }

  const tools = Array.isArray(body.tools)
    ? [
        {
          functionDeclarations: body.tools
            .filter((tool: any) => tool?.type === "function")
            .map((tool: any) => ({
              name: tool.function?.name,
              description: tool.function?.description,
              parameters: tool.function?.parameters,
            })),
        },
      ]
    : undefined

  const mode =
    body.tool_choice === "required"
      ? "ANY"
      : body.tool_choice === "auto"
        ? "AUTO"
        : body.tool_choice && typeof body.tool_choice === "object"
          ? "ANY"
          : undefined

  return {
    model: body.model,
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents,
    generationConfig: {
      maxOutputTokens: body.max_tokens,
      temperature: body.temperature,
      topP: body.top_p,
      stopSequences: Array.isArray(body.stop) ? body.stop : typeof body.stop === "string" ? [body.stop] : undefined,
    },
    tools,
    toolConfig: mode
      ? {
          functionCallingConfig: {
            mode,
          },
        }
      : undefined,
    stream: !!body.stream,
  }
}

export function fromGoogleResponse(resp: any): CommonResponse {
  if (!resp || typeof resp !== "object") return resp
  if (Array.isArray((resp as any).choices)) return resp

  const candidate = Array.isArray(resp.candidates) ? resp.candidates[0] : undefined
  const content = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
  const text = textAndImages(content)
  const toolCalls = content
    .filter((part: any) => part && part.functionCall && typeof part.functionCall.name === "string")
    .map((part: any) => ({
      id: part.functionCall.name + "_" + Math.random().toString(36).slice(2),
      type: "function" as const,
      function: {
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args ?? {}),
      },
    }))

  const usage = resp.usageMetadata
    ? {
        prompt_tokens: resp.usageMetadata.promptTokenCount,
        completion_tokens: resp.usageMetadata.candidatesTokenCount,
        total_tokens: resp.usageMetadata.totalTokenCount,
        ...(resp.usageMetadata.cachedContentTokenCount
          ? { prompt_tokens_details: { cached_tokens: resp.usageMetadata.cachedContentTokenCount } }
          : {}),
      }
    : undefined

  return {
    id: resp.responseId ?? `chatcmpl_${Math.random().toString(36).slice(2)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: resp.modelVersion ?? "",
    choices: [
      {
        index: candidate?.index ?? 0,
        message: {
          role: "assistant",
          ...(text ? { content: text } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReasonToCommon(candidate?.finishReason),
      },
    ],
    ...(usage ? { usage } : {}),
  }
}

export function toGoogleResponse(resp: CommonResponse) {
  if (!resp || typeof resp !== "object") return resp
  if (Array.isArray((resp as any).candidates)) return resp

  const choice = Array.isArray(resp.choices) ? resp.choices[0] : undefined
  const parts: any[] = []
  if (typeof choice?.message?.content === "string" && choice.message.content.length > 0) {
    parts.push({ text: choice.message.content })
  }

  if (Array.isArray(choice?.message?.tool_calls)) {
    for (const tool of choice.message.tool_calls) {
      if (!tool || tool.type !== "function") continue
      let args = {}
      try {
        args = JSON.parse(tool.function.arguments ?? "{}")
      } catch {
        args = {}
      }
      parts.push({
        functionCall: {
          name: tool.function.name,
          args,
        },
      })
    }
  }

  return {
    candidates: [
      {
        content: {
          role: "model",
          parts,
        },
        finishReason: finishReasonToGoogle(choice?.finish_reason),
        index: choice?.index ?? 0,
      },
    ],
    usageMetadata: resp.usage
      ? {
          promptTokenCount: resp.usage.prompt_tokens,
          candidatesTokenCount: resp.usage.completion_tokens,
          totalTokenCount: resp.usage.total_tokens,
          ...(resp.usage.prompt_tokens_details?.cached_tokens
            ? { cachedContentTokenCount: resp.usage.prompt_tokens_details.cached_tokens }
            : {}),
        }
      : undefined,
    modelVersion: resp.model,
    responseId: resp.id,
  }
}

export function fromGoogleChunk(chunk: string): CommonChunk | string {
  if (!chunk.startsWith("data: ")) return chunk

  let json: any
  try {
    json = JSON.parse(chunk.slice(6))
  } catch {
    return chunk
  }

  const candidate = Array.isArray(json.candidates) ? json.candidates[0] : undefined
  if (!candidate) return chunk
  const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : []
  const content = textAndImages(parts)

  const out: CommonChunk = {
    id: json.responseId ?? "",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: json.modelVersion ?? "",
    choices: [],
  }

  if (content) {
    out.choices.push({
      index: candidate.index ?? 0,
      delta: { content },
      finish_reason: null,
    })
  }

  const finish = finishReasonToCommon(candidate.finishReason)
  if (finish) {
    out.choices.push({
      index: candidate.index ?? 0,
      delta: {},
      finish_reason: finish,
    })
  }

  if (json.usageMetadata) {
    out.usage = {
      prompt_tokens: json.usageMetadata.promptTokenCount,
      completion_tokens: json.usageMetadata.candidatesTokenCount,
      total_tokens: json.usageMetadata.totalTokenCount,
      ...(json.usageMetadata.cachedContentTokenCount
        ? { prompt_tokens_details: { cached_tokens: json.usageMetadata.cachedContentTokenCount } }
        : {}),
    }
  }

  return out
}

export function toGoogleChunk(chunk: CommonChunk) {
  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
  const text = choice?.delta?.content

  return JSON.stringify({
    candidates: [
      {
        content: {
          role: "model",
          parts: text ? [{ text }] : [],
        },
        finishReason: finishReasonToGoogle(choice?.finish_reason),
        index: choice?.index ?? 0,
      },
    ],
    usageMetadata: chunk.usage
      ? {
          promptTokenCount: chunk.usage.prompt_tokens,
          candidatesTokenCount: chunk.usage.completion_tokens,
          totalTokenCount: chunk.usage.total_tokens,
          ...(chunk.usage.prompt_tokens_details?.cached_tokens
            ? { cachedContentTokenCount: chunk.usage.prompt_tokens_details.cached_tokens }
            : {}),
        }
      : undefined,
    modelVersion: chunk.model,
    responseId: chunk.id,
  })
}
