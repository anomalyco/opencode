import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ai, LanguageModel } from "../src/effect.js"
import { OpenAICompatible } from "../src/providers.js"
import { LLMClient, RequestExecutor, mergeTransport, unixSocketFetch } from "../src/route.js"
import { deltaChunk, finishChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"
import { it } from "./lib/effect.js"
import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sockets: string[] = []
const servers: Array<ReturnType<typeof Bun.serve>> = []

const serveUnix = (fetch: (request: Request) => Response | Promise<Response>) => {
  const path = join(tmpdir(), `oc-unix-${randomUUID()}.sock`)
  const server = Bun.serve({ unix: path, fetch })
  servers.push(server)
  sockets.push(path)
  return path
}

const serveTcp = (fetch: (request: Request) => Response | Promise<Response>) => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })
  servers.push(server)
  return server
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const path of sockets.splice(0)) rmSync(path, { force: true })
})

const encoder = new TextEncoder()

describe.skipIf(process.platform === "win32")("unixSocketFetch", () => {
  test("round-trips a JSON POST over the socket and ignores the URL host", async () => {
    const seen: Array<{ method: string; path: string; token: string | null; body: string }> = []
    const path = serveUnix(async (request) => {
      seen.push({
        method: request.method,
        path: new URL(request.url).pathname + new URL(request.url).search,
        token: request.headers.get("x-token"),
        body: await request.text(),
      })
      return Response.json({ ok: true })
    })

    const response = await unixSocketFetch(path)("http://ignored.invalid/v1/chat?stream=1", {
      method: "POST",
      headers: { "x-token": "secret" },
      body: JSON.stringify({ hello: "world" }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(seen).toEqual([
      { method: "POST", path: "/v1/chat?stream=1", token: "secret", body: '{"hello":"world"}' },
    ])
  })

  test("delivers SSE chunks before the response completes", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let pull = 0
    const path = serveUnix(
      () =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              if (pull++ === 0) {
                controller.enqueue(encoder.encode("data: first\n\n"))
                return
              }
              await gate
              controller.enqueue(encoder.encode("data: second\n\ndata: [DONE]\n\n"))
              controller.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    )

    const response = await unixSocketFetch(path)("http://localhost/v1/chat")
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n")

    release()
    const rest: string[] = []
    while (true) {
      const part = await reader.read()
      if (part.done) break
      rest.push(new TextDecoder().decode(part.value))
    }

    expect(rest.join("")).toBe("data: second\n\ndata: [DONE]\n\n")
  })

  test("aborts while waiting for response headers", async () => {
    let arrived!: () => void
    const started = new Promise<void>((resolve) => {
      arrived = resolve
    })
    const path = serveUnix(() => {
      arrived()
      return new Promise<Response>(() => {})
    })
    const controller = new AbortController()

    const call = unixSocketFetch(path)("http://localhost/v1/chat", { signal: controller.signal })
    await started
    controller.abort()

    await expect(call).rejects.toMatchObject({ name: "AbortError" })
  })

  test("aborts while reading the response body", async () => {
    const path = serveUnix(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode("data: first\n\n"))
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    )
    const controller = new AbortController()

    const response = await unixSocketFetch(path)("http://localhost/v1/chat", { signal: controller.signal })
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBeFalse()

    controller.abort()

    await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" })
  })

  test("returns redirects instead of following them over TCP", async () => {
    const tcpRequests: string[] = []
    const tcp = serveTcp((request) => {
      tcpRequests.push(request.url)
      return new Response("tcp")
    })
    const path = serveUnix(
      () => new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${tcp.port}/elsewhere` } }),
    )

    const response = await unixSocketFetch(path)("http://ignored.invalid/v1/chat")

    expect(response.status).toBe(302)
    expect(tcpRequests).toEqual([])
  })

  test("rejects an encrypted URL and an empty socket path", async () => {
    const path = serveUnix(() => new Response("unused"))

    await expect(unixSocketFetch(path)("https://localhost/v1/chat")).rejects.toThrow("requires an http URL")
    await expect(unixSocketFetch("")("http://localhost/v1/chat")).rejects.toThrow("must not be empty")
  })

  test("fails when the socket does not exist", async () => {
    const path = join(tmpdir(), `oc-missing-${randomUUID()}.sock`)

    await expect(unixSocketFetch(path)("http://localhost/v1/chat")).rejects.toThrow()
  })
})

describe.skipIf(process.platform === "win32")("native transport with a socket", () => {
  it.effect("dials the socket instead of the base URL's TCP host", () =>
    Effect.gen(function* () {
      const socketRequests: string[] = []
      const socket = serveUnix((request) => {
        socketRequests.push(new URL(request.url).pathname)
        return new Response(
          sseEvents(deltaChunk({ role: "assistant", content: "over socket" }), finishChunk("stop")),
          { headers: { "content-type": "text/event-stream" } },
        )
      })
      const tcpRequests: string[] = []
      const tcp = serveTcp((request) => {
        tcpRequests.push(request.url)
        return new Response("not the socket")
      })

      const baseURL = `http://127.0.0.1:${tcp.port}/v1`
      const runtime = OpenAICompatible.model("local-model", { apiKey: "test", baseURL })
      const model = LanguageModel.update(runtime, {
        options: mergeTransport(runtime.options, { http: { socketPath: socket } }),
      })

      const response = yield* LLMClient.generate(ai.request({ model, prompt: "Hello" })).pipe(
        Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.fetchLayer))),
      )

      expect(response.text).toBe("over socket")
      expect(socketRequests).toEqual(["/v1/chat/completions"])
      expect(tcpRequests).toEqual([])
    }),
  )
})
