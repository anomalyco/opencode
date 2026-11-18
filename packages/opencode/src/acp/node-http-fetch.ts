import http from "node:http"
import https from "node:https"

/**
 * Bun's `fetch` on Windows never completes a request once the process holds an
 * open streaming HTTP response: every subsequent `fetch()` queues forever and
 * the request is never dispatched (it never reaches the server). The problem is
 * unrelated to proxy settings, origins, or connection headers, and `node:http`
 * in the same process is unaffected.
 *
 * The ACP server keeps a long-lived SSE subscription (`/global/event`, see
 * `acp/event.ts`) to its own embedded HTTP server, while every session method
 * (`session/new`, `session/list`, ...) performs SDK calls over HTTP to that
 * same server. On Windows this starves all session methods indefinitely, so
 * the SDK transport is swapped for a `node:http` implementation there.
 */
export const nodeHttpFetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(input, init)
  const url = new URL(request.url)
  if (url.protocol !== "http:" && url.protocol !== "https:") return fetch(request)

  const client = url.protocol === "https:" ? https : http
  const headers: Record<string, string> = {}
  for (const [key, value] of request.headers.entries()) {
    if (key === "host" || key === "content-length" || key === "connection" || key === "transfer-encoding") continue
    headers[key] = value
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body
  const body = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined
  if (body) headers["content-length"] = String(body.length)

  return await new Promise<Response>((resolve, reject) => {
    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: request.method,
        headers,
      },
      (res) => {
        const responseHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === "string") responseHeaders[key] = value
          if (typeof value === "number") responseHeaders[key] = String(value)
          if (Array.isArray(value)) responseHeaders[key] = value.join(", ")
        }
        delete responseHeaders["transfer-encoding"]
        delete responseHeaders["connection"]
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            res.on("data", (chunk) => {
              try {
                controller.enqueue(new Uint8Array(chunk))
              } catch {
                // stream already closed by cancellation
              }
            })
            res.on("end", () => {
              try {
                controller.close()
              } catch {
                // stream already closed by cancellation
              }
            })
            res.on("error", (error) => {
              try {
                controller.error(error)
              } catch {
                // stream already closed by cancellation
              }
            })
          },
          cancel() {
            res.destroy()
          },
        })
        resolve(new Response(stream, { status: res.statusCode, headers: responseHeaders }))
      },
    )
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
  },
  // satisfy `typeof fetch` (bun-types adds `preconnect`)
  { preconnect: () => {} },
)
