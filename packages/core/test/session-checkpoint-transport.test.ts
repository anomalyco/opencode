import { expect } from "bun:test"
import { LLM, LLMRequest, Message } from "@opencode-ai/ai"
import { LLMClient, RequestExecutor } from "@opencode-ai/ai/route"
import { configure } from "@opencode-ai/ai/providers/openai"
import { SessionModelTransport } from "../src/session/model-transport"
import { WebSocketConstructor } from "../src/effect/websocket-constructor"
import { Session } from "@opencode-ai/schema/session"
import { Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { testEffect } from "./lib/effect"
import { makeWebSocketServer } from "./lib/websocket-server"

const runtime = Layer.mergeAll(
  LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer), Layer.provide(FetchHttpClient.layer)),
  SessionModelTransport.layer.pipe(Layer.provide(WebSocketConstructor.layer)),
)
const it = testEffect(runtime)
const sessionID = Session.ID.make("ses_checkpoint_transport")
const checkpoint = { type: "compaction", encrypted_content: "opaque" }
const fixture = (mode: "success" | "invalid" | "fallback") =>
  Effect.gen(function* () {
    const requests: Array<Record<string, unknown>> = []
    const http: Array<Record<string, unknown>> = []
    let disconnect: (() => void) | undefined
    const server = yield* makeWebSocketServer({
      upgrade: () => mode !== "fallback" || disconnect === undefined,
      async http(request) {
        http.push(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(await request.json()))
        return new Response(
          `data: ${JSON.stringify({
            type: "response.completed",
            response: {
              id: "resp_http",
              output: [checkpoint],
              usage: { input_tokens: 70, output_tokens: 7 },
            },
          })}\n\n`,
          { headers: { "content-type": "text/event-stream", "x-response": "http" } },
        )
      },
      open(socket) {
        disconnect = () => socket.close()
      },
      message(socket, message) {
        const body = JSON.parse(message.toString())
        requests.push(body)
        const id = `resp_${requests.length}`
        const send = (event: unknown) => socket.send(JSON.stringify(event))
        if (body.input.at(-1)?.type !== "compaction_trigger") {
          const item = {
            type: "message",
            id: `msg_${requests.length}`,
            role: "assistant",
            content: [{ type: "output_text", text: "Hello" }],
          }
          send({ type: "response.created", response: { id } })
          send({ type: "response.output_item.added", output_index: 0, item })
          send({ type: "response.output_text.delta", item_id: item.id, delta: "Hello" })
          send({ type: "response.output_item.done", output_index: 0, item })
          send({ type: "response.completed", response: { id, output: [item] } })
          return
        }
        send({ type: "response.created", response: { id } })
        send({ type: "response.output_item.done", output_index: 0, item: checkpoint })
        send({
          type: "response.completed",
          response: {
            id,
            output: mode === "invalid" ? [checkpoint, { ...checkpoint, encrypted_content: "second" }] : [checkpoint],
            usage: { input_tokens: 100, output_tokens: 10 },
          },
        })
      },
    })
    return {
      requests,
      headers: server.state.headers,
      http,
      opens: () => server.state.opens,
      disconnect: () => disconnect?.(),
      request: LLM.request({
        model: configure({
          apiKey: "fixture",
          baseURL: server.url.replace(/^ws/, "http").replace(/responses$/, ""),
          headers: { "chatgpt-account-id": "account", "x-codex-beta-features": "remote_compaction_v2" },
          providerOptions: { parallelToolCalls: true },
        }).responses("fixture"),
        prompt: "First",
        promptCacheKey: "session-key",
      }),
    }
  })

it.live("trigger reuses the append baseline and clears it before the next generation", () =>
  Effect.gen(function* () {
    const server = yield* fixture("success")
    const transport = yield* SessionModelTransport.Service
    const webSocket = transport.bind(sessionID)
    const first = yield* LLMClient.generate(server.request, { webSocket })
    const compacted = yield* LLMClient.compact(
      LLMRequest.update(server.request, {
        messages: [...server.request.messages, first.message],
      }),
      { mechanism: "trigger", webSocket },
    )
    expect(server.requests[1]).toMatchObject({
      previous_response_id: "resp_1",
      input: [{ type: "compaction_trigger" }],
    })
    expect(compacted.responseID).toBe("resp_2")
    expect(compacted.usage).toMatchObject({ inputTokens: 100, outputTokens: 10 })
    expect(compacted.checkpoint.encrypted).toBe("opaque")
    const messages = [Message.assistant(compacted.checkpoint), Message.user("Continue")]
    yield* LLMClient.generate(LLMRequest.update(server.request, { messages }), { webSocket })
    expect(server.requests[2]?.previous_response_id).toBeUndefined()
    expect(server.requests[2]?.input).toMatchObject([
      { type: "compaction", encrypted_content: "opaque" },
      { role: "user", content: [{ type: "input_text", text: "Continue" }] },
    ])
    expect(server.requests[1]?.stream).toBeUndefined()
    expect(server.requests[1]?.store).toBe(false)
    expect(server.headers[0]).toMatchObject({
      authorization: "Bearer fixture",
      "chatgpt-account-id": "account",
      "x-codex-beta-features": "remote_compaction_v2",
    })
    expect(server.opens()).toBe(1)
    expect(server.http).toHaveLength(0)
  }),
)

it.live("invalid trigger output does not retry or commit a continuation checkpoint", () =>
  Effect.gen(function* () {
    const server = yield* fixture("invalid")
    const transport = yield* SessionModelTransport.Service
    const webSocket = transport.bind(sessionID)
    const first = yield* LLMClient.generate(server.request, { webSocket })
    const input = LLMRequest.update(server.request, { messages: [...server.request.messages, first.message] })
    const error = yield* LLMClient.compact(input, { mechanism: "trigger", webSocket }).pipe(Effect.flip)
    expect(error.reason._tag).toBe("InvalidProviderOutput")
    expect(server.requests).toHaveLength(2)
    expect(server.http).toHaveLength(0)
    yield* LLMClient.generate(input, { webSocket })
    expect(server.requests[2]?.previous_response_id).toBeUndefined()
    expect(server.requests[2]?.input).toHaveLength(2)
  }),
)

it.live("trigger recovers over SSE with complete input after the old socket closes and reconnect is rejected", () =>
  Effect.gen(function* () {
    const server = yield* fixture("fallback")
    const transport = yield* SessionModelTransport.Service
    const webSocket = transport.bind(sessionID)
    const first = yield* LLMClient.generate(server.request, { webSocket })
    server.disconnect()
    // Let the real close event reach the connector before the next send.
    yield* Effect.sleep("20 millis")
    const result = yield* LLMClient.compact(
      LLMRequest.update(server.request, {
        messages: [...server.request.messages, first.message],
      }),
      { mechanism: "trigger", webSocket },
    )
    expect(result.responseID).toBe("resp_http")
    expect(result.usage).toMatchObject({ inputTokens: 70, outputTokens: 7 })
    expect(server.http).toHaveLength(1)
    expect(server.http[0]?.previous_response_id).toBeUndefined()
    expect(server.http[0]?.stream).toBe(true)
    expect(server.http[0]?.input).toHaveLength(3)
    expect(server.requests).toHaveLength(1)
  }),
)
