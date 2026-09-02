import { expect } from "bun:test"
import { LLM, LLMClient, LLMRequest, Message } from "@opencode-ai/ai"
import { OpenAI } from "@opencode-ai/ai/providers"
import { RequestExecutor, WebSocketTransport } from "@opencode-ai/ai/route"
import { SessionModelTransport } from "@opencode-ai/core/session/model-transport"
import { WebSocketConstructor } from "@opencode-ai/core/effect/websocket-constructor"
import { Session } from "@opencode-ai/schema/session"
import { Effect, Latch, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"
import { testEffect } from "./lib/effect"

const decodeBody = Schema.decodeSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

for (const recovery of ["reconnect", "http-fallback", "ambiguous-send"] as const) {
  testEffect(WebSocketConstructor.layer).live(
    `compaction survives ${recovery} without stale response IDs`,
    () =>
      Effect.gen(function* () {
        const constructor = yield* Socket.WebSocketConstructor
        const closed = yield* Latch.make()
        const sockets: Bun.ServerWebSocket<{ id: number }>[] = []
        const websocket: Array<{ connection: number; body: Record<string, unknown> }> = []
        const http: Record<string, unknown>[] = []
        const state = { rejectUpgrade: false }
        const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque-context" }
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve<{ id: number }>({
              hostname: "127.0.0.1",
              port: 0,
              async fetch(request, server) {
                if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
                  if (!state.rejectUpgrade && server.upgrade(request, { data: { id: sockets.length } }))
                    return undefined
                  return new Response("Upgrade rejected", { status: 503 })
                }
                http.push(decodeBody(await request.text()))
                return new Response(
                  `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_http", output: [] } })}\n\n`,
                  {
                    headers: { "content-type": "text/event-stream" },
                  },
                )
              },
              websocket: {
                open(socket) {
                  sockets.push(socket)
                },
                message(socket, data) {
                  websocket.push({ connection: socket.data.id, body: decodeBody(String(data)) })
                  if (recovery === "ambiguous-send" && websocket.length === 3) {
                    socket.close(1011, "fixture failure after receipt")
                    return
                  }
                  const id = `resp_${websocket.length}`
                  const output = websocket.length === 1 ? [checkpoint] : []
                  socket.send(JSON.stringify({ type: "response.created", response: { id } }))
                  if (output.length)
                    socket.send(JSON.stringify({ type: "response.output_item.done", item: checkpoint }))
                  socket.send(JSON.stringify({ type: "response.completed", response: { id, output } }))
                },
              },
            }),
          ),
          (server) =>
            Effect.sync(() => {
              // Bun 1.3 closes the sockets but can leave the stop promise unresolved after upgrades.
              void server.stop(true)
            }),
        )
        const transport = SessionModelTransport.makeLayer({
          open: (input) =>
            WebSocketTransport.open(input).pipe(
              Effect.provideService(Socket.WebSocketConstructor, constructor),
              Effect.map((connection) => ({
                ...connection,
                close: connection.close.pipe(Effect.andThen(closed.open)),
              })),
            ),
        })
        const client = LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer), Layer.provide(FetchHttpClient.layer))
        yield* Effect.gen(function* () {
          const channels = yield* SessionModelTransport.Service
          const options = { webSocket: channels.bind(Session.ID.make(`ses_compaction_${recovery}`)) }
          const first = LLM.request({
            model: OpenAI.configure({ apiKey: "fixture", baseURL: server.url.toString() }).responses("fixture"),
            prompt: "first",
            providerOptions: { contextManagement: [{ type: "compaction", compactThreshold: 100000 }] },
          })
          const compacted = yield* LLMClient.generate(first, options)
          const second = LLMRequest.update(first, {
            messages: [...first.messages, compacted.message, Message.user("second")],
          })
          yield* LLMClient.generate(second, options)
          expect(sockets).toHaveLength(1)
          expect(websocket[1]?.body).toMatchObject({
            store: false,
            previous_response_id: "resp_1",
            input: [{ role: "user", content: [{ type: "input_text", text: "second" }] }],
          })
          const third = LLMRequest.update(second, { messages: [...second.messages, Message.user("third")] })
          if (recovery === "ambiguous-send") {
            const error = yield* LLMClient.generate(third, options).pipe(Effect.flip)
            expect(error.reason).toMatchObject({ _tag: "Transport", delivery: "ambiguous" })
            expect(http).toHaveLength(0)
            expect(websocket).toHaveLength(3)
            state.rejectUpgrade = true
          } else {
            state.rejectUpgrade = recovery === "http-fallback"
            sockets[0]?.close(1011, "fixture idle disconnect")
          }
          // The transport signals this only after discarding the failed physical connection.
          yield* closed.await
          yield* LLMClient.generate(third, options)
          const body = recovery === "reconnect" ? websocket.at(-1)?.body : http[0]
          expect(body).not.toHaveProperty("previous_response_id")
          expect(body).toMatchObject({
            store: false,
            input: [
              { role: "user", content: [{ type: "input_text", text: "first" }] },
              checkpoint,
              { role: "user", content: [{ type: "input_text", text: "second" }] },
              { role: "user", content: [{ type: "input_text", text: "third" }] },
            ],
          })
          expect(http).toHaveLength(recovery === "reconnect" ? 0 : 1)
          expect(sockets).toHaveLength(recovery === "reconnect" ? 2 : 1)
        }).pipe(Effect.provide(Layer.merge(transport, client)))
      }),
    10000,
  )
}
