import WebSocket from "ws"
import { Log } from "@/util/log"

const log = Log.create({ service: "plugin.openai.websocket" })

export interface CreateWebSocketFetchOptions {
  /**
   * WebSocket endpoint URL.
   * @default 'wss://api.openai.com/v1/responses'
   */
  url?: string
}

/**
 * Creates a `fetch` function that routes OpenAI Responses API streaming
 * requests through a persistent WebSocket connection instead of HTTP.
 *
 * Non-streaming requests and requests to other endpoints are passed
 * through to the standard `fetch`.
 *
 * The connection is created lazily on the first streaming request and
 * reused for subsequent ones, which is the main source of latency
 * savings in multi-step tool-calling workflows.
 *
 * @example
 * ```ts
 * import { createOpenAI } from '@ai-sdk/openai';
 * import { createWebSocketFetch } from 'ai-sdk-openai-websocket-fetch';
 *
 * const wsFetch = createWebSocketFetch();
 * const openai = createOpenAI({ fetch: wsFetch });
 *
 * const result = streamText({
 *   model: openai('gpt-4.1-mini'),
 *   prompt: 'Hello!',
 *   onFinish: () => wsFetch.close(),
 * });
 * ```
 */
export function createWebSocketFetch(options?: CreateWebSocketFetchOptions) {
  let ws: WebSocket | null = null
  let connecting: Promise<WebSocket> | null = null
  let busy = false

  function getConnection(url: string, headers: Record<string, string>): Promise<WebSocket> {
    if (ws?.readyState === WebSocket.OPEN && !busy) {
      log.debug("reusing websocket", { url })
      return Promise.resolve(ws)
    }
    if (connecting && !busy) return connecting

    connecting = new Promise<WebSocket>((resolve, reject) => {
      log.debug("connecting websocket", {
        url,
        headers: Object.keys(headers).sort().join(","),
      })
      const socket = new WebSocket(url, { headers })

      socket.on("open", () => {
        ws = socket
        connecting = null
        log.debug("websocket connected", { url })
        resolve(socket)
      })

      socket.on("error", (err) => {
        log.debug("websocket connect error", {
          url,
          error: err.message,
        })
        if (connecting) {
          connecting = null
          reject(err)
        }
      })

      socket.on("close", () => {
        log.debug("websocket closed", { url })
        if (ws === socket) ws = null
      })
    })

    return connecting
  }

  async function websocketFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url

    if (init?.method !== "POST" || !url.endsWith("/responses")) {
      return globalThis.fetch(input, init)
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(typeof init.body === "string" ? init.body : "")
    } catch {
      return globalThis.fetch(input, init)
    }

    if (!body.stream) {
      return globalThis.fetch(input, init)
    }

    const wsUrl = getWebSocketURL(url, options?.url)
    const headers = getWebSocketHeaders(init.headers)

    log.debug("intercepting responses request", {
      url,
      wsUrl,
      stream: true,
    })

    const connection = await getConnection(wsUrl, headers)
    busy = true

    const { stream: _, ...requestBody } = body
    const encoder = new TextEncoder()

    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        function cleanup() {
          connection.off("message", onMessage)
          connection.off("error", onError)
          connection.off("close", onClose)
          busy = false
        }

        function onMessage(data: WebSocket.RawData) {
          const text = data.toString()
          log.debug("websocket event", { event: pretty(text), url: wsUrl })
          controller.enqueue(encoder.encode(`data: ${text}\n\n`))

          try {
            const event = JSON.parse(text)
            if (event.type === "response.completed" || event.type === "error") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              cleanup()
              controller.close()
            }
          } catch {
            // non-JSON frame, continue
          }
        }

        function onError(err: Error) {
          log.debug("websocket stream error", { url: wsUrl, error: err.message })
          cleanup()
          controller.error(err)
        }

        function onClose() {
          log.debug("websocket stream close", { url: wsUrl })
          cleanup()
          try {
            controller.close()
          } catch {
            // already closed
          }
        }

        connection.on("message", onMessage)
        connection.on("error", onError)
        connection.on("close", onClose)

        if (init?.signal) {
          if (init.signal.aborted) {
            cleanup()
            controller.error(init.signal.reason ?? new DOMException("Aborted", "AbortError"))
            return
          }
          init.signal.addEventListener(
            "abort",
            () => {
              cleanup()
              try {
                controller.error(init!.signal!.reason ?? new DOMException("Aborted", "AbortError"))
              } catch {
                // already closed
              }
            },
            { once: true },
          )
        }

        connection.send(JSON.stringify({ type: "response.create", ...requestBody }))
      },
    })

    return new Response(responseStream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })
  }

  return Object.assign(websocketFetch, {
    /** Close the underlying WebSocket connection. */
    close() {
      if (ws) {
        ws.close()
        ws = null
      }
    },
  })
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result

  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      result[k.toLowerCase()] = v
    })
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      result[k.toLowerCase()] = v
    }
  } else {
    for (const [k, v] of Object.entries(headers)) {
      if (v != null) result[k.toLowerCase()] = v
    }
  }

  return result
}

function getWebSocketHeaders(headers: HeadersInit | undefined) {
  const result = normalizeHeaders(headers)
  delete result["content-length"]
  result["openai-beta"] ??= "responses_websockets=2026-02-06"
  return result
}

function getWebSocketURL(url: string, fallback?: string) {
  if (fallback) return fallback

  const parsed = new URL(url)
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:"
  return parsed.toString()
}

function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
