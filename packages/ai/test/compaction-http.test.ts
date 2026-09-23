import { expect } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { LLM, LLMRequest, Message } from "../src/index.js"
import { LLMClient } from "../src/route/client.js"
import { OpenAI } from "../src/providers.js"
import { testEffect } from "./lib/effect.js"
import { runtimeLayer } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

testEffect(runtimeLayer(FetchHttpClient.layer)).live("compaction and a tool loop work end to end over HTTP", () =>
  Effect.gen(function* () {
    const checkpoint = { type: "compaction", id: "cmp_local", encrypted_content: "opaque-local-state" }
    const calls: string[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            const path = new URL(request.url).pathname
            calls.push(path)
            const body = await request.json()
            expect(request.headers.get("authorization")).toBe("Bearer fixture")
            if (path === "/v1/responses/compact") {
              expect(body.stream).toBeUndefined()
              return Response.json({
                object: "response.compaction",
                output: [checkpoint],
                usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
              })
            }
            expect(body.input[0]).toEqual(checkpoint)
            expect(body.stream).toBe(true)
            if (calls.length === 2)
              return new Response(
                sseEvents(
                  {
                    type: "response.output_item.done",
                    item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: "{}" },
                  },
                  { type: "response.completed", response: { id: "resp_1" } },
                ),
                { headers: { "content-type": "text/event-stream" } },
              )
            expect(body.input.at(-2)).toMatchObject({ type: "function_call", call_id: "call_1" })
            expect(body.input.at(-1)).toEqual({ type: "function_call_output", call_id: "call_1", output: "42" })
            const output = sseEvents(
              { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
              { type: "response.output_text.delta", item_id: "msg_1", delta: "The answer is 42." },
              {
                type: "response.output_item.done",
                item: { type: "message", id: "msg_1", content: [{ type: "output_text", text: "The answer is 42." }] },
              },
              { type: "response.completed", response: { id: "resp_2" } },
            )
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode(output.slice(0, 37)))
                  controller.enqueue(new TextEncoder().encode(output.slice(37)))
                  controller.close()
                },
              }),
              { headers: { "content-type": "text/event-stream" } },
            )
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    const model = OpenAI.configure({ apiKey: "fixture", baseURL: `http://127.0.0.1:${server.port}/v1` }).responses(
      "fixture",
    )
    const request = LLM.request({
      model,
      prompt: "original",
      tools: [{ name: "lookup", description: "Lookup a number", inputSchema: { type: "object", properties: {} } }],
    })
    const compacted = yield* LLMClient.compact(request)
    const messages = [...compacted.replacement, Message.user("Look up the answer")]
    const first = yield* LLMClient.generate(LLMRequest.update(request, { messages }))
    expect(first.toolCalls).toHaveLength(1)
    const call = first.toolCalls[0]!
    const last = yield* LLMClient.generate(
      LLMRequest.update(request, {
        messages: [
          ...messages,
          first.message,
          Message.tool({ id: call.id, name: call.name, result: "42", resultType: "text" }),
        ],
      }),
    )
    expect(last.text).toBe("The answer is 42.")
    expect(calls).toEqual(["/v1/responses/compact", "/v1/responses", "/v1/responses"])
  }),
)
