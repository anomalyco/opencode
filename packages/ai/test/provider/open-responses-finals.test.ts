import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMEvent } from "../../src/index.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { configure } from "../../src/providers/openai-compatible-responses.js"
import { LLMClient } from "../../src/route.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const request = LLM.request({
  model: configure({ apiKey: "test-key", baseURL: "https://responses.example.test/v1" }).model("example-model"),
  prompt: "Respond.",
})
const completed = { type: "response.completed", response: { id: "resp_1" } }
const generate = (...events: OpenResponses.Event[]) =>
  LLMClient.generate(request).pipe(Effect.provide(fixedResponse(sseEvents(...events))))

describe("Open Responses completed item text", () => {
  ;["Draft expanded", "D", "Replacement", ""].forEach((text) => {
    it.effect(`replaces streamed text with completed item text ${JSON.stringify(text)}`, () =>
      Effect.gen(function* () {
        const response = yield* generate(
          { type: "response.output_item.added", item: { type: "message", id: "msg_1", phase: "commentary" } },
          { type: "response.output_text.delta", item_id: "msg_1", delta: "Draft" },
          { type: "response.output_text.done", item_id: "msg_1", text: "Part final" },
          {
            type: "response.output_item.done",
            item: { type: "message", id: "msg_1", phase: "final_answer", content: [{ type: "output_text", text }] },
          },
          completed,
        )
        expect(response.text).toBe(text)
        expect(response.events.filter(LLMEvent.is.textDelta).map((event) => event.text)).toEqual(["Draft"])
        expect(response.events.filter(LLMEvent.is.textEnd)).toEqual([
          {
            type: "text-end",
            id: "msg_1",
            text,
            providerMetadata: { "openai-compatible": { itemId: "msg_1", phase: "final_answer" } },
          },
        ])
      }),
    )
  })

  it.effect("joins completed text and refusal parts without streamed text", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            id: "msg_1",
            content: [
              { type: "output_text", text: "Answer. " },
              { type: "refusal", refusal: "Cannot help." },
            ],
          },
        },
        completed,
      )
      expect(response.text).toBe("Answer. Cannot help.")
      expect(response.events.filter(LLMEvent.is.textStart)).toHaveLength(1)
      expect(response.events.filter(LLMEvent.is.textEnd)).toHaveLength(1)
    }),
  )

  it.effect("does not create an empty text fragment for an empty completed message", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        { type: "response.output_text.done", item_id: "msg_1", text: "" },
        {
          type: "response.output_item.done",
          item: { type: "message", id: "msg_1", content: [{ type: "output_text", text: "" }] },
        },
        completed,
      )
      expect(response.message.content).toEqual([])
      expect(response.events.filter(LLMEvent.is.textStart)).toEqual([])
    }),
  )

  it.effect("assembles a done-only message once across replayed item events", () =>
    Effect.gen(function* () {
      const item = {
        type: "message",
        id: "msg_1",
        content: [{ type: "output_text", text: "Recovered" }],
      }
      const response = yield* generate(
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Ignored after resume" },
        { type: "response.output_item.done", item },
        { type: "response.output_item.added", item },
        { type: "response.output_item.done", item },
        completed,
      )
      expect(response.text).toBe("Recovered")
      expect(response.message.content).toEqual([
        {
          type: "text",
          text: "Recovered",
          providerMetadata: { "openai-compatible": { itemId: "msg_1" } },
        },
      ])
      expect(response.events.filter(LLMEvent.is.textEnd)).toHaveLength(1)
    }),
  )
})

describe("Open Responses completed item reasoning", () => {
  ;[
    {
      name: "summary",
      summary: [
        { type: "summary_text", text: "Final" },
        { type: "summary_text", text: "summary" },
      ],
      content: [{ type: "reasoning_text", text: "Raw" }],
      text: "Final\n\nsummary",
    },
    {
      name: "raw text",
      summary: [
        { type: "summary_text", text: "" },
        { type: "summary_text", text: "" },
      ],
      content: [{ type: "reasoning_text", text: "Raw" }],
      text: "Raw",
    },
    {
      name: "streamed fallback",
      summary: [
        { type: "summary_text", text: "" },
        { type: "summary_text", text: "" },
      ],
      content: [
        { type: "reasoning_text", text: "" },
        { type: "reasoning_text", text: "" },
      ],
      text: "Draft",
    },
  ].forEach((fixture) => {
    it.effect(`uses ${fixture.name} at item completion`, () =>
      Effect.gen(function* () {
        const response = yield* generate(
          { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
          { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "Draft" },
          { type: "response.reasoning_summary_text.done", item_id: "rs_1", text: "Part final" },
          {
            type: "response.output_item.done",
            item: {
              type: "reasoning",
              id: "rs_1",
              summary: fixture.summary,
              content: fixture.content,
              encrypted_content: "encrypted",
            },
          },
          completed,
        )
        expect(response.reasoning).toBe(fixture.text)
        expect(response.events.filter(LLMEvent.is.reasoningEnd)).toHaveLength(1)
        expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
          "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "encrypted" },
        })
      }),
    )
  })

  it.effect("replaces only the still-open summary without repeating earlier text", () =>
    Effect.gen(function* () {
      const response = yield* generate(
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "First " },
        { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 1 },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 1, delta: "draft" },
        {
          type: "response.output_item.done",
          item: {
            type: "reasoning",
            id: "rs_1",
            summary: [
              { type: "summary_text", text: "First " },
              { type: "summary_text", text: "final" },
            ],
          },
        },
        completed,
      )
      expect(response.reasoning).toBe("First final")
      expect(response.events.filter(LLMEvent.is.reasoningEnd).map((event) => event.text)).toEqual([undefined, "final"])
    }),
  )
})
;["response.completed", "response.incomplete"].forEach((type) => {
  it.effect(`keeps streamed text when part finals are followed by ${type} without item completion`, () =>
    Effect.gen(function* () {
      const response = yield* generate(
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        { type: "response.output_text.delta", item_id: "msg_1", content_index: 0, delta: "Hel" },
        { type: "response.output_text.delta", item_id: "msg_1", content_index: 1, delta: "world" },
        { type: "response.output_text.done", item_id: "msg_1", content_index: 0, text: "Hello " },
        {
          type: "response.content_part.done",
          item_id: "msg_1",
          content_index: 0,
          part: { type: "output_text", text: "Hello " },
        },
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "Draft" },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", text: "Part final" },
        {
          type: "response.reasoning_summary_part.done",
          item_id: "rs_1",
          summary_index: 0,
          part: { type: "summary_text", text: "Part final" },
        },
        {
          type,
          response: {
            id: "resp_1",
            incomplete_details: type === "response.incomplete" ? { reason: "max_output_tokens" } : undefined,
          },
        },
      )
      expect(response.text).toBe("Helworld")
      expect(response.reasoning).toBe("Draft")
      expect(response.events.filter(LLMEvent.is.textEnd).map((event) => event.text)).toEqual([undefined])
      expect(response.events.filter(LLMEvent.is.reasoningEnd).map((event) => event.text)).toEqual([undefined])
    }),
  )
})
