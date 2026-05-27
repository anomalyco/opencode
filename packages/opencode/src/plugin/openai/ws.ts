// Low-level OpenAI Responses WebSocket protocol helpers. Session pooling,
// fallback, and continuation state intentionally live above this file.

import WebSocket from "ws"

export const PROTOCOL_HEADER = "responses_websockets=2026-02-06"

export interface ConnectResponsesWebSocketOptions {
  url: string
  headers: Record<string, string>
  timeout?: number
  signal?: AbortSignal
}

export interface StreamResponsesWebSocketOptions {
  socket: WebSocket
  body: Record<string, unknown>
  signal?: AbortSignal
  onComplete?: (event: Record<string, unknown>) => void
  onTerminal?: (event: Record<string, unknown>) => void
  onConnectionInvalid?: (error: Error) => void
  onAbort?: (error: Error) => void
}

export function toWebSocketUrl(url: string) {
  return url.replace(/^http/, "ws")
}

export function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value
    })
    return result
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      result[key.toLowerCase()] = value
    }
    return result
  }

  for (const [key, value] of Object.entries(headers)) {
    if (value != null) result[key.toLowerCase()] = value
  }
  return result
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

export function connectResponsesWebSocket(options: ConnectResponsesWebSocketOptions) {
  return new Promise<WebSocket>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(options.signal))
      return
    }

    const headers: Record<string, string> = {
      ...options.headers,
      "openai-beta": options.headers["openai-beta"] ?? PROTOCOL_HEADER,
    }
    delete headers["content-length"]

    const socket = new WebSocket(options.url, { headers })
    const timeout = options.timeout
      ? setTimeout(() => {
          cleanup()
          socket.terminate()
          reject(new Error("WebSocket connect timed out"))
        }, options.timeout)
      : undefined

    function cleanup() {
      if (timeout) clearTimeout(timeout)
      socket.off("open", onOpen)
      socket.off("error", onError)
      socket.off("close", onClose)
      options.signal?.removeEventListener("abort", onAbort)
    }

    function onOpen() {
      cleanup()
      resolve(socket)
    }

    function onError(error: Error) {
      cleanup()
      reject(error)
    }

    function onClose(code: number, reason: Buffer) {
      cleanup()
      reject(closeError("WebSocket closed before open", code, reason))
    }

    function onAbort() {
      cleanup()
      socket.terminate()
      reject(abortError(options.signal))
    }

    socket.once("open", onOpen)
    socket.once("error", onError)
    socket.once("close", onClose)
    options.signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export function streamResponsesWebSocket(options: StreamResponsesWebSocketOptions) {
  const encoder = new TextEncoder()
  let completed = false

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        function cleanup() {
          options.socket.off("message", onMessage)
          options.socket.off("error", onError)
          options.socket.off("close", onClose)
          options.signal?.removeEventListener("abort", onAbort)
        }

        function closeCompleted() {
          cleanup()
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        }

        function invalidate(error: Error) {
          cleanup()
          options.onConnectionInvalid?.(error)
          controller.error(error)
        }

        function onMessage(data: WebSocket.RawData, isBinary: boolean) {
          if (isBinary) {
            invalidate(new Error("Unexpected binary WebSocket frame"))
            return
          }

          const text = data.toString()
          controller.enqueue(encoder.encode(`${text.split(/\r?\n/).map((line) => `data: ${line}`).join("\n")}\n\n`))

          const event = parseEvent(text)
          if (!event) return

          if (event.type === "response.completed" || event.type === "response.done") {
            completed = true
            options.onComplete?.(event)
            options.onTerminal?.(event)
            closeCompleted()
            return
          }

          if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
            completed = true
            options.onTerminal?.(event)
            closeCompleted()
          }
        }

        function onError(error: Error) {
          invalidate(error)
        }

        function onClose(code: number, reason: Buffer) {
          if (completed) return
          invalidate(closeError("WebSocket closed before response.completed", code, reason))
        }

        function onAbort() {
          const error = abortError(options.signal)
          cleanup()
          options.onAbort?.(error)
          controller.error(error)
        }

        options.socket.on("message", onMessage)
        options.socket.once("error", onError)
        options.socket.once("close", onClose)
        options.signal?.addEventListener("abort", onAbort, { once: true })

        if (options.signal?.aborted) {
          onAbort()
          return
        }

        options.socket.send(JSON.stringify(responseCreate(options.body)), (error) => {
          if (!error) return
          invalidate(error)
        })
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  )
}

function responseCreate(body: Record<string, unknown>) {
  const { stream: _stream, background: _background, ...payload } = body
  return { type: "response.create", ...payload }
}

function parseEvent(text: string): Record<string, unknown> | undefined {
  try {
    const event = JSON.parse(text)
    return typeof event === "object" && event !== null ? event : undefined
  } catch {
    return undefined
  }
}

function abortError(signal: AbortSignal | undefined) {
  const reason = signal?.reason
  if (isAbortError(reason)) return reason
  return new DOMException(reason instanceof Error ? reason.message : "Aborted", "AbortError")
}

function closeError(message: string, code: number, reason: Buffer) {
  const details = [`code ${code}`]
  if (code === 1009) details.push("message too big")
  if (reason.length > 0) details.push(reason.toString())
  return new Error(`${message} (${details.join(": ")})`)
}

export * as OpenAIWebSocket from "./ws"
