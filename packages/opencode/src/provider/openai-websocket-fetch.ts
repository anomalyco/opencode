import WebSocket from "ws"
import { Log } from "@/util/log"

type WsFetch = ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) & { close: () => void }

const BETA = "responses_websockets=2026-02-06"
const log = Log.create({ service: "provider.openai.websocket" })

export function createOpenAIWebsocketFetch(input?: { url?: string; scope?: string }): WsFetch {
  const url = input?.url ?? "wss://api.openai.com/v1/responses"
  const scope = input?.scope ?? "openai"
  let ws: WebSocket | undefined
  let con: Promise<WebSocket> | undefined
  let busy = false
  let seen = false
  let sig = ""

  const open = (head: Record<string, string>) => {
    const next = JSON.stringify({
      auth: head["authorization"] ?? "",
      account: head["chatgpt-account-id"] ?? "",
      org: head["openai-organization"] ?? "",
      project: head["openai-project"] ?? "",
    })
    if (ws?.readyState === WebSocket.OPEN && !busy && sig === next) {
      return Promise.resolve(ws)
    }
    if (ws && sig !== next) {
      ws.close()
      ws = undefined
    }
    if (con && !busy) {
      return con
    }
    con = new Promise<WebSocket>((resolve, reject) => {
      const req = {
        Authorization: head["authorization"] ?? "",
        "OpenAI-Beta": BETA,
        ...(head["chatgpt-account-id"] ? { "ChatGPT-Account-Id": head["chatgpt-account-id"] } : {}),
        ...(head["openai-organization"] ? { "OpenAI-Organization": head["openai-organization"] } : {}),
        ...(head["openai-project"] ? { "OpenAI-Project": head["openai-project"] } : {}),
      }
      const sock = new WebSocket(url, {
        headers: req,
      })
      sock.on("open", () => {
        ws = sock
        con = undefined
        sig = next
        log.info("connected", { url, scope })
        resolve(sock)
      })
      sock.on("error", (err: Error) => {
        if (!con) return
        con = undefined
        log.warn("connect_failed", { error: err, scope })
        reject(err)
      })
      sock.on("close", () => {
        const isCurrentSocket = ws === sock
        if (isCurrentSocket) ws = undefined
        // If the connection promise is still pending when the socket closes,
        // reject it so callers don't get a never-settled promise.
        if (con) {
          const err = new Error("WebSocket connection closed before it was established")
          con = undefined
          log.warn("connect_closed_before_ready", { error: err, scope })
          reject(err)
          return
        }
        log.info("closed", { scope })
      })
    })
    return con
  }

  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    const req = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url
    if (method !== "POST" || !req.endsWith("/responses")) {
      return fetch(input, init)
    }
    if (!init?.body || typeof init.body !== "string") {
      return fetch(input, init)
    }

    let data: Record<string, unknown>
    try {
      const parsed = JSON.parse(init.body)
      if (!parsed || typeof parsed !== "object") {
        return fetch(input, init)
      }
      data = parsed as Record<string, unknown>
    } catch {
      return fetch(input, init)
    }

    if (data.stream !== true) {
      return fetch(input, init)
    }

    const h = headers(init.headers)
    if (!h["authorization"]) {
      return fetch(input, init)
    }

    let conn: WebSocket
    try {
      conn = await open(h)
    } catch {
      log.warn("fallback_http", { endpoint: req, scope })
      return fetch(input, init)
    }

    busy = true
    if (!seen) {
      seen = true
      log.info("streaming via websocket", { endpoint: req, scope })
    }
    const { stream: _, background: __, ...body } = data
    const enc = new TextEncoder()

    const bodyStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const done = () => {
          conn.off("message", msg)
          conn.off("error", err)
          conn.off("close", close)
          busy = false
        }

        const msg = (buf: WebSocket.RawData) => {
          const text = buf.toString()
          ctrl.enqueue(enc.encode(`data: ${text}\n\n`))
          let event: { type?: string } | undefined
          try {
            const parsed = JSON.parse(text)
            if (parsed && typeof parsed === "object") {
              event = parsed as { type?: string }
            }
          } catch {
            return
          }
          if (event?.type !== "response.completed" && event?.type !== "error") {
            return
          }
          ctrl.enqueue(enc.encode("data: [DONE]\n\n"))
          done()
          ctrl.close()
        }

        const err = (e: Error) => {
          done()
          ctrl.error(e)
        }

        const close = () => {
          done()
          ctrl.close()
        }

        conn.on("message", msg)
        conn.on("error", err)
        conn.on("close", close)

        if (init.signal) {
          if (init.signal.aborted) {
            done()
            ctrl.error(init.signal.reason ?? new DOMException("Aborted", "AbortError"))
            return
          }
          init.signal.addEventListener(
            "abort",
            () => {
              done()
              ctrl.error(init.signal?.reason ?? new DOMException("Aborted", "AbortError"))
            },
            { once: true },
          )
        }

        conn.send(
          JSON.stringify({
            type: "response.create",
            ...body,
          }),
        )
      },
    })

    return new Response(bodyStream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    })
  }

  return Object.assign(fn, {
    close() {
      ws?.close()
      ws = undefined
      log.info("manual_close", { scope })
    },
  })
}

function headers(input: HeadersInit | undefined) {
  const result: Record<string, string> = {}
  if (!input) return result

  if (input instanceof Headers) {
    input.forEach((v, k) => {
      result[k.toLowerCase()] = v
    })
    return result
  }

  if (Array.isArray(input)) {
    for (const [k, v] of input) {
      result[k.toLowerCase()] = v
    }
    return result
  }

  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue
    result[k.toLowerCase()] = String(v)
  }
  return result
}
