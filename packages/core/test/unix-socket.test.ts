import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, LanguageModel } from "@opencode/ai/effect"
import { OpenAICompatible } from "@opencode/ai/providers"
import { LLMClient, mergeTransport } from "@opencode/ai/route"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { randomUUID } from "node:crypto"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { it } from "./lib/effect"

const sse = (...chunks: ReadonlyArray<unknown>) =>
  `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`

const chatChunk = (delta: object, finishReason: string | null = null) => ({
  id: "chatcmpl_unix",
  choices: [{ delta, finish_reason: finishReason }],
  usage: null,
})

const sockets: string[] = []
const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
  for (const path of sockets.splice(0)) rmSync(path, { force: true })
})

describe.skipIf(process.platform === "win32")("native transport in the app graph", () => {
  it.effect("dials the provider's Unix socket instead of the base URL's TCP host", () =>
    Effect.gen(function* () {
      const socketRequests: string[] = []
      const socket = join(tmpdir(), `oc-graph-${randomUUID()}.sock`)
      sockets.push(socket)
      servers.push(
        Bun.serve({
          unix: socket,
          fetch(request) {
            socketRequests.push(new URL(request.url).pathname)
            return new Response(
              sse(chatChunk({ role: "assistant", content: "over socket" }), chatChunk({}, "stop")),
              { headers: { "content-type": "text/event-stream" } },
            )
          },
        }),
      )
      const tcpRequests: string[] = []
      const tcp = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          tcpRequests.push(request.url)
          return new Response("not the socket")
        },
      })
      servers.push(tcp)

      const baseURL = `http://127.0.0.1:${tcp.port}/v1`
      const runtime = OpenAICompatible.model("local-model", { apiKey: "test", baseURL })
      const model = LanguageModel.update(runtime, {
        options: mergeTransport(runtime.options, { http: { socketPath: socket } }),
      })

      const response = yield* LLMClient.generate(ai.request({ model, prompt: "Hello" })).pipe(
        Effect.provide(AppNodeBuilder.build(LayerNodePlatform.llmClient)),
      )

      expect(response.text).toBe("over socket")
      expect(socketRequests).toEqual(["/v1/chat/completions"])
      expect(tcpRequests).toEqual([])
    }),
  )
})
