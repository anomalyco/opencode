import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import { LLM, LLMRequest, Message } from "../../src/index.js"
import { LLMClient, WebSocketTransport } from "../../src/route.js"
import { OpenAI } from "../../src/providers.js"
import { testEffect } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"

testEffect(fixedResponse("unexpected HTTP fallback")).effect(
  "WebSocket responses preserve compaction options and replay state",
  () =>
    Effect.gen(function* () {
      const checkpoint = { type: "compaction", id: "cmp_ws", encrypted_content: "opaque" }
      const sent: unknown[] = []
      const webSocket = WebSocketTransport.makeDirect({
        open: () =>
          Effect.succeed({
            sendText: (message) =>
              Effect.sync(() => {
                const body = JSON.parse(message)
                expect(body.context_management).toEqual([{ type: "compaction", compact_threshold: 100000 }])
                expect(body.stream).toBeUndefined()
                if (sent.length) expect(body.input[1]).toEqual(checkpoint)
                sent.push(body)
              }),
            messages: Stream.fromIterable(
              [
                { type: "response.created", response: { id: "resp_ws" } },
                { type: "response.output_item.done", item: checkpoint },
                { type: "response.completed", response: { id: "resp_ws", output: [checkpoint] } },
              ].map((event) => JSON.stringify(event)),
            ),
            close: Effect.void,
          }),
      })
      const request = LLM.request({
        model: OpenAI.configure({ apiKey: "test" }).responses("gpt-5.3-codex"),
        prompt: "hello",
        providerOptions: { contextManagement: [{ type: "compaction", compactThreshold: 100000 }] },
      })
      const first = yield* LLMClient.generate(request, { webSocket })
      expect(first.message.content).toHaveLength(1)
      expect(first.message.content[0]?.type).toBe("compaction")
      yield* LLMClient.generate(
        LLMRequest.update(request, { messages: [...request.messages, first.message, Message.user("continue")] }),
        { webSocket },
      )
      expect(sent).toHaveLength(2)
    }),
)
