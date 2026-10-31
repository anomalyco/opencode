import type { OpenCodeEvent } from "@opencode/client/promise"
import type { Page } from "@playwright/test"

/**
 * The app's event stream from a real SSE endpoint on loopback, in place of the mock server's in-page stream. Events
 * reach the renderer over the network as they do from a server, so delivering them costs the measured page nothing,
 * and `stream` keeps its own pace like a model's reply: it never waits for the renderer to keep up.
 *
 * Install it before `mockOpenCodeServer`, which then leaves the event stream alone.
 */
export async function eventSource(page: Page, server: string) {
  const encoder = new TextEncoder()
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const write = (text: string) => clients.forEach((client) => client.enqueue(encoder.encode(text)))

  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    // An event stream is quiet between events; Bun would otherwise close it after 10 seconds.
    idleTimeout: 0,
    fetch(request) {
      const state: Connection = {}

      const end = () => {
        clearInterval(state.keepalive)

        if (state.controller) clients.delete(state.controller)
      }

      request.signal.addEventListener("abort", end, { once: true })

      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            state.controller = controller
            clients.add(controller)
            controller.enqueue(encoder.encode(connected))
            // The real server's keepalive, so a long run never trips the client's stall watchdog.
            state.keepalive = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 15_000)
          },
          cancel: end,
        }),
        {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "access-control-allow-origin": "*",
          },
        },
      )
    },
  })

  page.on("close", () => void http.stop(true))

  await page.addInitScript(
    ({ source, server }) => {
      // Tells the mock server's init script, which runs after this one, to leave `/api/event` to this source.
      Object.assign(window, { __testSseTransport: true })
      const fetch = window.fetch.bind(window)

      const route = (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)

        return fetch(
          url.origin === server && url.pathname === "/api/event"
            ? new Request(source, { signal: request.signal })
            : request,
        )
      }

      Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: route })
    },
    { source: http.url.href, server: new URL(server).origin },
  )

  return {
    send: (events: readonly OpenCodeEvent[]) => events.forEach((event) => write(frame(event))),
    /** Sends one event every `every` milliseconds; resolves after the last. */
    stream: (events: readonly OpenCodeEvent[], every: number) =>
      new Promise<void>((resolve) => {
        const queue = [...events]

        const timer = setInterval(() => {
          const event = queue.shift()

          if (event) write(frame(event))

          if (queue.length > 0) return
          clearInterval(timer)
          resolve()
        }, every)
      }),
  }
}

/** One client's stream and its keepalive timer, once it starts. */
type Connection = {
  controller?: ReadableStreamDefaultController<Uint8Array>
  keepalive?: ReturnType<typeof setInterval>
}

const connected = `data: ${JSON.stringify({ id: "evt_source_connected", type: "server.connected", data: {} })}\n\n`

const frame = (event: OpenCodeEvent) => `data: ${JSON.stringify(event)}\n\n`
