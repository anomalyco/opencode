import { CODE_ASSIST_HEADERS, GEMINI_CODE_ASSIST_ENDPOINT } from "./constants"
import { logGeminiDebugResponse, type GeminiDebugContext } from "./debug"
import {
  extractUsageMetadata,
  normalizeThinkingConfig,
  parseGeminiApiBody,
  rewriteGeminiPreviewAccessError,
  type GeminiApiBody,
} from "./request-helpers"

const STREAM_ACTION = "streamGenerateContent"
const MODEL_FALLBACKS: Record<string, string> = {
  "gemini-2.5-flash-image": "gemini-2.5-flash",
}

export function isGenerativeLanguageRequest(input: RequestInfo): input is string {
  return toRequestUrlString(input).includes("generativelanguage.googleapis.com")
}

function transformStreamingLine(line: string): string {
  if (!line.startsWith("data:")) {
    return line
  }
  const json = line.slice(5).trim()
  if (!json) {
    return line
  }
  try {
    const parsed = JSON.parse(json) as { response?: unknown }
    if (parsed.response !== undefined) {
      return `data: ${JSON.stringify(parsed.response)}`
    }
  } catch {}
  return line
}

function transformStreamingPayloadStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  return new ReadableStream<Uint8Array>({
    start(controller) {
      reader = stream.getReader()
      const pump = (): void => {
        reader!
          .read()
          .then(({ done, value }) => {
            if (done) {
              buffer += decoder.decode()
              if (buffer.length > 0) {
                controller.enqueue(encoder.encode(transformStreamingLine(buffer)))
              }
              controller.close()
              return
            }

            buffer += decoder.decode(value, { stream: true })

            let newlineIndex = buffer.indexOf("\n")
            while (newlineIndex !== -1) {
              const line = buffer.slice(0, newlineIndex)
              buffer = buffer.slice(newlineIndex + 1)
              const hasCarriageReturn = line.endsWith("\r")
              const rawLine = hasCarriageReturn ? line.slice(0, -1) : line
              const transformed = transformStreamingLine(rawLine)
              const suffix = hasCarriageReturn ? "\r\n" : "\n"
              controller.enqueue(encoder.encode(`${transformed}${suffix}`))
              newlineIndex = buffer.indexOf("\n")
            }

            pump()
          })
          .catch((error) => {
            controller.error(error)
          })
      }

      pump()
    },
    cancel(reason) {
      if (reader) {
        reader.cancel(reason).catch(() => {})
      }
    },
  })
}

export function prepareGeminiRequest(
  input: RequestInfo,
  init: RequestInit | undefined,
  accessToken: string,
  projectId: string,
): { request: RequestInfo; init: RequestInit; streaming: boolean; requestedModel?: string } {
  const baseInit: RequestInit = { ...init }
  const headers = new Headers(init?.headers ?? {})

  if (!isGenerativeLanguageRequest(input)) {
    return {
      request: input,
      init: { ...baseInit, headers },
      streaming: false,
    }
  }

  headers.set("Authorization", `Bearer ${accessToken}`)
  headers.delete("x-api-key")
  headers.delete("x-goog-api-key")

  const match = toRequestUrlString(input).match(/\/models\/([^:]+):(\w+)/)
  if (!match) {
    return {
      request: input,
      init: { ...baseInit, headers },
      streaming: false,
    }
  }

  const [, rawModel = "", rawAction = ""] = match
  const effectiveModel = MODEL_FALLBACKS[rawModel] ?? rawModel
  const streaming = rawAction === STREAM_ACTION
  const transformedUrl = `${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:${rawAction}${streaming ? "?alt=sse" : ""}`

  let body = baseInit.body
  if (typeof baseInit.body === "string" && baseInit.body) {
    try {
      const parsedBody = JSON.parse(baseInit.body) as Record<string, unknown>
      const isWrapped = typeof parsedBody.project === "string" && "request" in parsedBody

      if (isWrapped) {
        const wrappedBody = {
          ...parsedBody,
          model: effectiveModel,
        } as Record<string, unknown>
        body = JSON.stringify(wrappedBody)
      } else {
        const requestPayload: Record<string, unknown> = { ...parsedBody }

        const rawGenerationConfig = requestPayload.generationConfig as Record<string, unknown> | undefined
        const normalizedThinking = normalizeThinkingConfig(rawGenerationConfig?.thinkingConfig)
        if (normalizedThinking) {
          if (rawGenerationConfig) {
            rawGenerationConfig.thinkingConfig = normalizedThinking
            requestPayload.generationConfig = rawGenerationConfig
          } else {
            requestPayload.generationConfig = { thinkingConfig: normalizedThinking }
          }
        } else if (rawGenerationConfig?.thinkingConfig) {
          delete rawGenerationConfig.thinkingConfig
          requestPayload.generationConfig = rawGenerationConfig
        }

        if ("system_instruction" in requestPayload) {
          requestPayload.systemInstruction = requestPayload.system_instruction
          delete requestPayload.system_instruction
        }

        const cachedContentFromExtra =
          typeof requestPayload.extra_body === "object" && requestPayload.extra_body
            ? (requestPayload.extra_body as Record<string, unknown>).cached_content ??
              (requestPayload.extra_body as Record<string, unknown>).cachedContent
            : undefined
        const cachedContent =
          (requestPayload.cached_content as string | undefined) ??
          (requestPayload.cachedContent as string | undefined) ??
          (cachedContentFromExtra as string | undefined)
        if (cachedContent) {
          requestPayload.cachedContent = cachedContent
        }

        delete requestPayload.cached_content
        if (requestPayload.extra_body && typeof requestPayload.extra_body === "object") {
          delete (requestPayload.extra_body as Record<string, unknown>).cached_content
          delete (requestPayload.extra_body as Record<string, unknown>).cachedContent
          if (Object.keys(requestPayload.extra_body as Record<string, unknown>).length === 0) {
            delete requestPayload.extra_body
          }
        }

        if ("model" in requestPayload) {
          delete requestPayload.model
        }

        const wrappedBody = {
          project: projectId,
          model: effectiveModel,
          request: requestPayload,
        }

        body = JSON.stringify(wrappedBody)
      }
    } catch (error) {
      console.error("Failed to transform Gemini request body:", error)
    }
  }

  if (streaming) {
    headers.set("Accept", "text/event-stream")
  }

  headers.set("User-Agent", CODE_ASSIST_HEADERS["User-Agent"])
  headers.set("X-Goog-Api-Client", CODE_ASSIST_HEADERS["X-Goog-Api-Client"])
  headers.set("Client-Metadata", CODE_ASSIST_HEADERS["Client-Metadata"])

  return {
    request: transformedUrl,
    init: {
      ...baseInit,
      headers,
      body,
    },
    streaming,
    requestedModel: rawModel,
  }
}

function toRequestUrlString(value: RequestInfo): string {
  if (typeof value === "string") {
    return value
  }
  if (value instanceof URL) {
    return value.toString()
  }
  const candidate = (value as Request).url
  if (candidate) {
    return candidate
  }
  return value.toString()
}

export async function transformGeminiResponse(
  response: Response,
  streaming: boolean,
  debugContext?: GeminiDebugContext | null,
  requestedModel?: string,
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? ""
  const isJsonResponse = contentType.includes("application/json")
  const isEventStreamResponse = contentType.includes("text/event-stream")

  if (!isJsonResponse && !isEventStreamResponse) {
    logGeminiDebugResponse(debugContext, response, {
      note: "Non-JSON response (body omitted)",
    })
    return response
  }

  try {
    const headers = new Headers(response.headers)

    if (streaming && response.ok && isEventStreamResponse && response.body) {
      logGeminiDebugResponse(debugContext, response, {
        note: "Streaming SSE payload (body omitted)",
        headersOverride: headers,
      })

      return new Response(transformStreamingPayloadStream(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    const text = await response.text()

    if (!response.ok && text) {
      try {
        const errorBody = JSON.parse(text)
        if (errorBody?.error?.details && Array.isArray(errorBody.error.details)) {
          const retryInfo = errorBody.error.details.find(
            (detail: any) => detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
          )

          if (retryInfo?.retryDelay) {
            const match = retryInfo.retryDelay.match(/^([\d.]+)s$/)
            if (match && match[1]) {
              const retrySeconds = parseFloat(match[1])
              if (!Number.isNaN(retrySeconds) && retrySeconds > 0) {
                const retryAfterSec = Math.ceil(retrySeconds).toString()
                const retryAfterMs = Math.ceil(retrySeconds * 1000).toString()
                headers.set("Retry-After", retryAfterSec)
                headers.set("retry-after-ms", retryAfterMs)
              }
            }
          }
        }
      } catch {}
    }

    const init = {
      status: response.status,
      statusText: response.statusText,
      headers,
    }

    const parsed: GeminiApiBody | null = !streaming || !isEventStreamResponse ? parseGeminiApiBody(text) : null
    const patched = parsed ? rewriteGeminiPreviewAccessError(parsed, response.status, requestedModel) : null
    const effectiveBody = patched ?? parsed ?? undefined

    const usage = effectiveBody ? extractUsageMetadata(effectiveBody) : null
    if (usage?.cachedContentTokenCount !== undefined) {
      headers.set("x-gemini-cached-content-token-count", String(usage.cachedContentTokenCount))
      if (usage.totalTokenCount !== undefined) {
        headers.set("x-gemini-total-token-count", String(usage.totalTokenCount))
      }
      if (usage.promptTokenCount !== undefined) {
        headers.set("x-gemini-prompt-token-count", String(usage.promptTokenCount))
      }
      if (usage.candidatesTokenCount !== undefined) {
        headers.set("x-gemini-candidates-token-count", String(usage.candidatesTokenCount))
      }
    }

    logGeminiDebugResponse(debugContext, response, {
      body: text,
      note: streaming ? "Streaming SSE payload (buffered)" : undefined,
      headersOverride: headers,
    })

    if (!parsed) {
      return new Response(text, init)
    }

    if (effectiveBody?.response !== undefined) {
      return new Response(JSON.stringify(effectiveBody.response), init)
    }

    if (patched) {
      return new Response(JSON.stringify(patched), init)
    }

    return new Response(text, init)
  } catch (error) {
    logGeminiDebugResponse(debugContext, response, {
      error,
      note: "Failed to transform Gemini response",
    })
    console.error("Failed to transform Gemini response:", error)
    return response
  }
}
