import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent, LLMRequest, Message } from "../../src/index.js"
import { Meta } from "../../src/providers/meta.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const meta = Meta.configure({ apiKey: process.env.META_API_KEY ?? "fixture" })
const recorded = recordedTests({
  prefix: "meta-search",
  provider: "meta",
  requires: ["META_API_KEY"],
  tags: ["tool", "hosted", "web-search", "citation", "continuation"],
  metadata: { model: "muse-spark-1.3" },
})

for (const api of ["responses", "messages"] as const) {
  recorded.effect.with(
    `searches and replays grounded ${api}`,
    { protocol: `meta-${api}` },
    () =>
      Effect.gen(function* () {
        const request = LLM.request({
          model: meta[api]("muse-spark-1.3"),
          prompt:
            "Use web search to find NASA's page identifying the first person to walk on the Moon. Answer in one sentence with a source citation.",
          tools: [Meta.webSearch()],
          generation: { maxTokens: 2048 },
          providerOptions:
            api === "responses"
              ? { reasoningEffort: "low", include: ["reasoning.encrypted_content", "web_search_call.results"] }
              : { effort: "low" },
        })
        const compiled = yield* compileRequest(request)
        expect(compiled.body.tools).toEqual([
          api === "responses" ? { type: "web_search" } : { type: "web_search", name: "web_search" },
        ])
        const first = yield* LLMClient.generate(request)
        expect(first.text.toLowerCase()).toContain("armstrong")
        expect(
          first.events.some(
            (event) => LLMEvent.is.toolCall(event) && event.providerExecuted && event.name === "web_search",
          ),
        ).toBe(true)
        expect(first.finishReason.normalized).toBe("stop")
        if (api === "responses") {
          const results = first.events
            .filter(LLMEvent.is.toolResult)
            .filter((event) => event.providerExecuted && event.name === "web_search")
          expect(results.length).toBeGreaterThan(0)
          expect(structuredClone(results[0]?.result)).toMatchObject({
            type: "json",
            value: {
              type: "web_search_call",
              results: expect.arrayContaining([
                expect.objectContaining({ url: expect.any(String), title: expect.any(String) }),
              ]),
            },
          })
          const annotations = first.message.content
            .filter((part) => part.type === "text")
            .flatMap((part) => part.providerMetadata?.meta?.annotations ?? [])
          expect(annotations).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: "url_citation", url: expect.stringMatching(/^https?:\/\//) }),
            ]),
          )
        }
        const next = LLMRequest.update(request, {
          tools: [],
          messages: [
            ...request.messages,
            first.message,
            Message.user("Using the information already found, reply with just that person's surname."),
          ],
        })
        const replay = yield* compileRequest(next)
        if (api === "responses")
          expect(replay.body.input).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ type: "web_search_call", results: expect.any(Array) }),
              expect.objectContaining({ type: "reasoning", encrypted_content: expect.any(String) }),
            ]),
          )
        if (api === "messages")
          expect(replay.body.messages[1].content).toEqual(
            expect.arrayContaining([expect.objectContaining({ type: "server_tool_use", name: "web_search" })]),
          )
        const second = yield* LLMClient.generate(next)
        expect(second.text.toLowerCase()).toContain("armstrong")
        expect(second.finishReason.normalized).toBe("stop")
      }),
    120_000,
  )
}
