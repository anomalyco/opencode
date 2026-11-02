import { expect, mock, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { ServerConnection } from "@/runtime/server/registry"
import { ServerScope } from "@/runtime/server/scope"

// Runs under the browser build: the server build of Solid never runs the effect that follows the plugin's endpoint.
test("a plugin server's event stream follows the endpoint the plugin reports", async () => {
  // Event streams start with `server.connected` and stay open; the restored placeholder never answers.
  const streams: Array<{ url: string; aborted: boolean }> = []

  // SAFETY: the SDK calls fetch only with a URL or Request and an optional init, which this fake accepts.
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)

    if (new URL(request.url).port === "0") throw new TypeError("Failed to fetch")

    const entry = { url: request.url, aborted: false }
    const connected = JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })

    streams.push(entry)

    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${connected}\n\n`))
          request.signal.addEventListener("abort", () => {
            entry.aborted = true
            controller.error(request.signal.reason)
          })
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    )
  }) as typeof globalThis.fetch

  // The SDK reads only `fetch` from the platform; spreading the real module keeps every other export.
  const real = await import("@/runtime/platform/platform")

  mock.module("@/runtime/platform/platform", () => ({ ...real, usePlatform: () => ({ fetch }) }))

  const { createServerSdkContext } = await import("@/runtime/server/client")

  // A server restored from the plugin's last inventory: a placeholder endpoint and no `reconnect`.
  const [http, setHttp] = createSignal<ServerConnection.HttpBase>({ url: "http://127.0.0.1:0" })

  const server = {
    type: "plugin",
    key: "remote:box",
    plugin: "remote",
    state: "ready",
    connecting: false,
    authenticationRequired: false,
    managed: false,
    get http() {
      return http()
    },
  } satisfies ServerConnection.Plugin

  const ctx = createRoot((dispose) => ({
    // SAFETY: a plugin server's key is its `${plugin}:${id}` string, which is how the app keys it.
    sdk: createServerSdkContext(server, ServerScope.fromServerKey(server.key as ServerConnection.Key)),
    dispose,
  }))

  try {
    setHttp({ url: "http://127.0.0.1:4101", password: "first" })
    await until(() => ctx.sdk.connection.status() === "connected")
    expect(streams.map((stream) => stream.url)).toEqual(["http://127.0.0.1:4101/api/event"])

    // A connected stream moves as soon as the plugin reports another endpoint.
    setHttp({ url: "http://127.0.0.1:4102", password: "second" })
    await until(() => streams.length === 2 && ctx.sdk.connection.status() === "connected")
    expect(streams.map((stream) => [stream.url, stream.aborted])).toEqual([
      ["http://127.0.0.1:4101/api/event", true],
      ["http://127.0.0.1:4102/api/event", false],
    ])
    expect(ctx.sdk.url).toBe("http://127.0.0.1:4102")
  } finally {
    ctx.dispose()
  }
})

async function until(check: () => boolean, timeout = 3_000) {
  const deadline = Date.now() + timeout

  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
