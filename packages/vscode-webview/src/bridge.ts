import type { HostMessage, WebviewMessage } from "../../../sdks/vscode/src/webview-protocol"

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void }

// VS Code allows one call per webview load.
const vscode = acquireVsCodeApi()

export const post = (message: WebviewMessage) => vscode.postMessage(message)

type Pending = {
  resolve(response: Response): void
  reject(reason: unknown): void
  body?: ReadableStreamDefaultController<Uint8Array>
}

const pending = new Map<number, Pending>()

let nextID = 0

// Statuses whose Response must be built without a body.
const bodiless = new Set([101, 103, 204, 205, 304])

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data
  if (message.type === "configuration") return
  const entry = pending.get(message.id)

  if (!entry) return

  if (message.type === "fetch.head") {
    const body = bodiless.has(message.status)
      ? null
      : new ReadableStream<Uint8Array>({
          start: (controller) => {
            entry.body = controller
          },
          cancel: () => {
            pending.delete(message.id)
            post({ type: "fetch.abort", id: message.id })
          },
        })
    entry.resolve(new Response(body, { status: message.status, statusText: message.statusText, headers: message.headers }))
    return
  }

  if (message.type === "fetch.chunk") return entry.body?.enqueue(message.chunk)

  pending.delete(message.id)

  if (message.type === "fetch.end") return entry.body?.close()

  const error = new TypeError(message.message)
  if (entry.body) return entry.body.error(error)
  entry.reject(error)
})

/**
 * A fetch that sends requests for the opencode server through the extension host. The webview's origin is not one the
 * server accepts, and the host adds the service credential, so it never reaches the webview.
 */
export function createProxyFetch(server: string): typeof fetch {
  const origin = new URL(server).origin

  return async (input, init) => {
    const request = new Request(input, init)

    if (new URL(request.url).origin !== origin) return fetch(request)

    request.signal.throwIfAborted()
    const id = ++nextID
    const body =
      request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer())

    return new Promise<Response>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      request.signal.addEventListener(
        "abort",
        () => {
          const entry = pending.get(id)

          if (!entry) return
          pending.delete(id)
          post({ type: "fetch.abort", id })
          if (entry.body) return entry.body.error(request.signal.reason)
          entry.reject(request.signal.reason)
        },
        { once: true },
      )
      post({ type: "fetch", id, url: request.url, method: request.method, headers: [...request.headers], body })
    })
  }
}
