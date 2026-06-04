// Low-level OpenAI Responses WebSocket protocol helpers. Session pooling,
// fallback, and continuation state intentionally live above this file.

import WebSocket from "ws"
import { ProviderError } from "@/provider/error"
import { errorMessage } from "@/util/error"
import { ProxyEnv } from "@/util/proxy-env"

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
  idleTimeout?: number
  signal?: AbortSignal
  onFirstEvent?: () => void
  onComplete?: (event: Record<string, unknown>) => void
  onTerminal?: (event: Record<string, unknown>) => void
  onRetryableTerminal?: (event: Record<string, unknown>) => Promise<WebSocket | undefined>
  onConnectionInvalid?: (error: ProviderError.ResponseStreamError) => void
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

export function isAbortError(error: unknown): error is DOMException {
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

    // Bun does not apply HTTP(S)_PROXY to WebSockets unless the proxy is supplied explicitly.
    const proxy =
      typeof Bun === "undefined"
        ? undefined
        : ProxyEnv.getProxyForUrl(options.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"))
    const connect = { headers, ...(proxy ? { proxy } : {}) }
    const socket = new WebSocket(options.url, connect)
    const timeout = options.timeout
      ? setTimeout(() => {
          cleanup()
          socket.on("error", () => {})
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

    function onError(error: unknown) {
      socket.on("error", () => {})
      cleanup()
      reject(error instanceof Error ? error : new Error(errorMessage(error), { cause: error }))
    }

    function onClose(code: number, reason: Buffer) {
      cleanup()
      reject(new Error(closeMessage("WebSocket closed before open", code, reason)))
    }

    function onAbort() {
      cleanup()
      socket.on("error", () => {})
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

  let socket = options.socket
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let cleanupSocket = () => {}
  let completed = false
  let emitted = false
  let emittedModelOutput = false
  let released = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  function cleanup() {
    if (idleTimer) clearTimeout(idleTimer)
    cleanupSocket()
    options.signal?.removeEventListener("abort", onAbort)
  }

  function terminateSocket(target = socket) {
    target.on("error", () => {})
    target.terminate()
  }

  function closeCompleted() {
    cleanup()
    controller?.enqueue(encoder.encode("data: [DONE]\n\n"))
    controller?.close()
  }

  function invalidate(error: ProviderError.ResponseStreamError) {
    if (completed) return
    completed = true
    cleanup()
    options.onConnectionInvalid?.(error)
    controller?.error(error)
  }

  function release() {
    if (released) return
    released = true
    options.onFirstEvent?.()
  }

  function failure(message: string, cause?: unknown, info?: Partial<ProviderError.ResponseStreamInfo>) {
    return new ProviderError.ResponseStreamError(
      message,
      {
        transport: "websocket",
        phase: emittedModelOutput ? "after_first_event" : "before_first_event",
        autoReplaySafe: !emittedModelOutput,
        ...info,
      },
      cause === undefined ? undefined : { cause },
    )
  }

  function failTerminal(event: Record<string, unknown>, error: Error) {
    if (completed) return
    completed = true
    cleanup()
    options.onTerminal?.(event)
    if (error instanceof ProviderError.ResponseStreamError) options.onConnectionInvalid?.(error)
    controller?.error(error)
  }

  function resetIdleTimeout(message: string) {
    if (completed) return
    if (!options.idleTimeout) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => invalidate(failure(message)), options.idleTimeout)
  }

  async function onMessage(data: WebSocket.RawData, isBinary: boolean) {
    if (completed) return
    if (isBinary) {
      invalidate(failure("Unexpected binary WebSocket frame"))
      return
    }

    const text = data.toString()
    const event = (() => {
      try {
        const parsed = JSON.parse(text)
        return typeof parsed === "object" && parsed !== null ? parsed : undefined
      } catch {
        return undefined
      }
    })()

    if (event?.type === "error" && !emitted && options.onRetryableTerminal) {
      cleanupSocket()
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = undefined
      try {
        const next = await options.onRetryableTerminal(event)
        if (completed) {
          if (next) terminateSocket(next)
          return
        }
        if (next) {
          attach(next)
          return
        }
      } catch (error) {
        invalidate(failure(error instanceof Error ? error.message : String(error), error))
        return
      }
    }

    const transportTerminalError = event && terminalTransportError(event, failure)
    if (transportTerminalError) {
      failTerminal(event, transportTerminalError)
      return
    }

    controller?.enqueue(
      encoder.encode(
        `${text
          .split(/\r?\n/)
          .map((line) => `data: ${line}`)
          .join("\n")}\n\n`,
      ),
    )
    release()
    emitted = true
    if (event && modelOutputEvent(event)) emittedModelOutput = true
    resetIdleTimeout("idle timeout waiting for websocket")

    if (!event) return

    if (event.type === "response.completed") {
      completed = true
      options.onComplete?.(event)
      options.onTerminal?.(event)
      release()
      closeCompleted()
      return
    }

    if (event.type === "response.done") {
      const status = responseStatus(event)
      if (status === "completed") {
        completed = true
        options.onComplete?.(event)
        options.onTerminal?.(event)
        release()
        closeCompleted()
        return
      }
      if (status === "incomplete") {
        failTerminal(event, failure("OpenAI response incomplete", event))
        return
      }
      release()
      failTerminal(event, new Error(`OpenAI response ended with status ${status ?? "unknown"}`, { cause: event }))
      return
    }

    if (event.type === "response.incomplete") {
      failTerminal(event, failure("OpenAI response incomplete", event))
      return
    }

    if (event.type === "error") {
      if (!transportErrorEvent(event)) release()
      failTerminal(
        event,
        transportErrorEvent(event)
          ? failure(eventErrorMessage(event), event)
          : new Error(eventErrorMessage(event), { cause: event }),
      )
    }
  }

  function onError(error: Error) {
    invalidate(failure(error.message, error))
  }

  function onClose(code: number, reason: Buffer) {
    if (completed) return
    invalidate(failure(closeMessage("WebSocket closed before response.completed", code, reason)))
  }

  function onAbort() {
    const error = abortError(options.signal)
    if (completed) return
    completed = true
    cleanup()
    terminateSocket()
    options.onAbort?.(error)
    controller?.error(error)
  }

  function onCancel(reason: unknown) {
    if (completed) return
    completed = true
    cleanup()
    terminateSocket()
    options.onAbort?.(cancelError(reason))
  }

  function attach(next: WebSocket) {
    cleanupSocket()
    socket = next
    socket.on("message", onMessage)
    socket.once("error", onError)
    socket.once("close", onClose)
    cleanupSocket = () => {
      socket.off("message", onMessage)
      socket.off("error", onError)
      socket.off("close", onClose)
    }
    const { stream: _stream, background: _background, ...payload } = options.body
    resetIdleTimeout("idle timeout sending websocket request")
    socket.send(JSON.stringify({ type: "response.create", ...payload }), (error) => {
      if (completed) return
      resetIdleTimeout("idle timeout waiting for websocket")
      if (error) invalidate(failure(error.message, error))
    })
  }

  return new Response(
    new ReadableStream<Uint8Array>({
      start(next) {
        controller = next
        options.signal?.addEventListener("abort", onAbort, { once: true })

        if (options.signal?.aborted) {
          onAbort()
          return
        }

        attach(socket)
      },
      cancel(reason) {
        onCancel(reason)
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  )
}

function cancelError(reason: unknown) {
  if (isAbortError(reason)) return reason
  if (reason instanceof Error) return reason
  return new DOMException(typeof reason === "string" ? reason : "Aborted", "AbortError")
}

function abortError(signal: AbortSignal | undefined) {
  const reason = signal?.reason
  if (isAbortError(reason)) return reason
  return new DOMException(reason instanceof Error ? reason.message : "Aborted", "AbortError")
}

function closeMessage(message: string, code: number, reason: Buffer) {
  const details = [`code ${code}`]
  if (code === 1009) details.push("message too big")
  if (reason.length > 0) details.push(reason.toString())
  return `${message} (${details.join(": ")})`
}

function responseStatus(event: Record<string, unknown>) {
  if (!("response" in event)) return
  const response = event.response
  if (!isRecord(response)) return
  return typeof response.status === "string" ? response.status : undefined
}

function terminalTransportError(
  event: Record<string, unknown>,
  failure: (
    message: string,
    cause?: unknown,
    info?: Partial<ProviderError.ResponseStreamInfo>,
  ) => ProviderError.ResponseStreamError,
) {
  if (event.type === "response.failed") return failure(responseFailedMessage(event), event, { terminalEvent: event.type })
  if (event.type === "response.incomplete") return failure("OpenAI response incomplete", event)
  if (event.type === "response.done" && responseStatus(event) === "incomplete") {
    return failure("OpenAI response incomplete", event)
  }
  if (event.type === "error" && transportErrorEvent(event)) return failure(eventErrorMessage(event), event)
}

function responseFailedMessage(event: Record<string, unknown>) {
  const detail = responseFailedDetail(event)
  const message = detail?.message
  const code = detail?.code
  if (message && code) return `OpenAI response failed (${code}): ${message}`
  if (message) return `OpenAI response failed: ${message}`
  if (code) return `OpenAI response failed (${code})`
  return "OpenAI response failed"
}

function responseFailedDetail(event: Record<string, unknown>) {
  const details = [event.error, isRecord(event.response) ? event.response.error : undefined]
    .filter(isRecord)
    .map((error) => ({
      code: typeof error.code === "string" && error.code ? error.code : undefined,
      message: typeof error.message === "string" && error.message ? error.message : undefined,
    }))
    .filter((error) => error.code || error.message)
    .sort((a, b) => (b.message ? 2 : 0) + (b.code ? 1 : 0) - ((a.message ? 2 : 0) + (a.code ? 1 : 0)))
  const best = details[0]
  if (!best) return
  return {
    code: best.code ?? details.find((detail) => detail.code)?.code,
    message: best.message ?? details.find((detail) => detail.message)?.message,
  }
}

function modelOutputEvent(event: Record<string, unknown>) {
  if (typeof event.type !== "string") return false
  if (event.type === "response.output_text.delta") return true
  if (event.type === "response.reasoning_text.delta") return true
  if (event.type === "response.reasoning_summary.delta") return true
  if (event.type === "response.reasoning_summary_text.delta") return true
  if (event.type.endsWith(".delta") && event.type.includes("call")) return true
  if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
    return isRecord(event.item) && event.item.type !== "message"
  }
  return false
}

function eventErrorMessage(event: Record<string, unknown>) {
  if (!("error" in event)) return "OpenAI websocket stream error"
  const error = event.error
  if (!isRecord(error)) return "OpenAI websocket stream error"
  if (typeof error.message === "string" && error.message) return error.message
  if (typeof error.code === "string" && error.code) return error.code
  return "OpenAI websocket stream error"
}

function transportErrorEvent(event: Record<string, unknown>) {
  const message = eventErrorMessage(event)
  const code = eventErrorCode(event)
  if (code === "stream_incomplete" || code === "websocket_connection_limit_reached") return true
  return /before response\.completed/i.test(message) || /stream[_ ]incomplete/i.test(message)
}

function eventErrorCode(event: Record<string, unknown>) {
  if (!("error" in event)) return
  const error = event.error
  if (!isRecord(error)) return
  return typeof error.code === "string" ? error.code : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export * as OpenAIWebSocket from "./ws"
