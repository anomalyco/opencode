import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { LLM, LLMEvent } from "../../src/index.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { configure } from "../../src/providers/openai-compatible-responses.js"
import { OpenAI, XAI } from "../../src/providers.js"
import { LLMClient } from "../../src/route.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

const model = configure({ apiKey: "test-key", baseURL: "https://responses.example.test/v1" }).model("example-model")
const completed = { type: "response.completed", response: { id: "resp_1" } }

const collect = (input: ReadonlyArray<OpenResponses.Event>, selected = model) =>
  Effect.gen(function* () {
    const request = LLM.request({ model: selected, prompt: "Respond." })
    const response = yield* LLMClient.generate(request)
    const events = yield* LLMClient.stream(request).pipe(Stream.runCollect)
    expect(events).toEqual(response.events)
    const active = { text: new Set<string>(), reasoning: new Set<string>() }
    const closed = { text: new Set<string>(), reasoning: new Set<string>() }
    events.forEach((event) => {
      if (event.type === "text-start" || event.type === "reasoning-start") {
        const kind = event.type === "text-start" ? "text" : "reasoning"
        expect(active[kind].size).toBe(0)
        expect(closed[kind].has(event.id)).toBe(false)
        active[kind].add(event.id)
      }
      if (event.type === "text-delta" || event.type === "reasoning-delta") {
        expect(active[event.type === "text-delta" ? "text" : "reasoning"].has(event.id)).toBe(true)
      }
      if (event.type === "text-end" || event.type === "reasoning-end") {
        const kind = event.type === "text-end" ? "text" : "reasoning"
        expect(active[kind].delete(event.id)).toBe(true)
        expect(closed[kind].has(event.id)).toBe(false)
        closed[kind].add(event.id)
      }
      if (event.type === "step-finish" || event.type === "finish") {
        expect(active.text.size).toBe(0)
        expect(active.reasoning.size).toBe(0)
      }
    })
    expect(events[0]?.type).toBe("step-start")
    expect(events.filter(LLMEvent.is.stepStart)).toHaveLength(1)
    expect(events.filter(LLMEvent.is.stepFinish)).toHaveLength(1)
    expect(events.filter(LLMEvent.is.finish)).toHaveLength(1)
    expect(events.slice(-2).map((event) => event.type)).toEqual(["step-finish", "finish"])
    return response
  }).pipe(Effect.provide(fixedResponse(sseEvents(...input))))

describe("Open Responses final text", () => {
  ;["output_text", "refusal"].forEach((kind) => {
    ;[
      { name: "longer", text: "Draft answer expanded" },
      { name: "shorter", text: "Draft" },
      { name: "non-prefix", text: "Replacement" },
      { name: "empty", text: "" },
    ].forEach((final) => {
      it.effect(`replaces ${kind} deltas with a ${final.name} final at item close`, () =>
        Effect.gen(function* () {
          const response = yield* collect([
            { type: "response.output_item.added", item: { type: "message", id: "msg_1", phase: "commentary" } },
            { type: `response.${kind}.delta`, item_id: "msg_1", content_index: 0, delta: "Draft answer" },
            {
              type: `response.${kind}.done`,
              item_id: "msg_1",
              content_index: 0,
              ...(kind === "refusal" ? { refusal: final.text } : { text: final.text }),
            },
            { type: "response.output_item.done", item: { type: "message", id: "msg_1", phase: "final_answer" } },
            completed,
          ])
          expect(response.text).toBe(final.text)
          expect(response.events.filter(LLMEvent.is.textDelta).map((event) => event.text)).toEqual(["Draft answer"])
          expect(response.events.filter(LLMEvent.is.textEnd)).toEqual([
            {
              type: "text-end",
              id: "msg_1",
              text: final.text,
              providerMetadata: { "openai-compatible": { itemId: "msg_1", phase: "final_answer" } },
            },
          ])
          expect(response.message.content.find((part) => part.type === "text")).toMatchObject({
            text: final.text,
            providerMetadata: { "openai-compatible": { itemId: "msg_1", phase: "final_answer" } },
          })
        }),
      )
    })
  })

  it.effect("aggregates content indexes independently and retains deltas for parts without finals", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        { type: "response.output_text.delta", item_id: "msg_1", content_index: 0, delta: "first draft" },
        { type: "response.output_text.done", item_id: "msg_1", content_index: 0, text: "First " },
        { type: "response.output_text.delta", item_id: "msg_1", content_index: 1, delta: "discard" },
        { type: "response.output_text.done", item_id: "msg_1", content_index: 1, text: "" },
        { type: "response.output_text.delta", item_id: "msg_1", content_index: 2, delta: "fallback " },
        { type: "response.refusal.delta", item_id: "msg_1", content_index: 3, delta: "last draft" },
        { type: "response.refusal.done", item_id: "msg_1", content_index: 3, refusal: "last" },
        { type: "response.output_item.done", item: { type: "message", id: "msg_1" } },
        completed,
      ])
      expect(response.text).toBe("First fallback last")
      expect(response.events.filter(LLMEvent.is.textStart)).toHaveLength(1)
      expect(response.events.filter(LLMEvent.is.textEnd)).toMatchObject([{ id: "msg_1", text: "First fallback last" }])
    }),
  )
  ;[false, true].forEach((streamed) => {
    it.effect(`uses item content over cached part finals ${streamed ? "with" : "without"} deltas`, () =>
      Effect.gen(function* () {
        const response = yield* collect([
          { type: "response.output_item.added", item: { type: "message", id: "msg_1", phase: "commentary" } },
          ...(streamed ? [{ type: "response.output_text.delta", item_id: "msg_1", delta: "Draft" }] : []),
          { type: "response.output_text.done", item_id: "msg_1", content_index: 0, text: "Cached" },
          {
            type: "response.output_item.done",
            item: {
              type: "message",
              id: "msg_1",
              phase: "final_answer",
              content: [
                { type: "output_text", text: "Final " },
                { type: "refusal", refusal: "refusal" },
              ],
            },
          },
          completed,
        ])
        expect(response.text).toBe("Final refusal")
        expect(response.events.filter(LLMEvent.is.textEnd)).toEqual([
          {
            type: "text-end",
            id: "msg_1",
            text: "Final refusal",
            providerMetadata: { "openai-compatible": { itemId: "msg_1", phase: "final_answer" } },
          },
        ])
      }),
    )
  })

  it.effect("uses a tracked message item snapshot without text deltas or part finals", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        {
          type: "response.output_item.done",
          item: { type: "message", id: "msg_1", content: [{ type: "output_text", text: "Snapshot only" }] },
        },
        completed,
      ])
      expect(response.text).toBe("Snapshot only")
      expect(response.events.filter(LLMEvent.is.textEnd)).toMatchObject([{ id: "msg_1", text: "Snapshot only" }])
    }),
  )

  it.effect("uses a content-part snapshot over an earlier scalar final when item content is absent", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Draft" },
        { type: "response.output_text.done", item_id: "msg_1", content_index: 0, text: "Cached" },
        {
          type: "response.content_part.done",
          item_id: "msg_1",
          content_index: 0,
          part: { type: "output_text", text: "Corrected" },
        },
        { type: "response.output_item.done", item: { type: "message", id: "msg_1" } },
        completed,
      ])
      expect(response.text).toBe("Corrected")
      expect(response.events.filter(LLMEvent.is.textEnd)).toEqual([
        {
          type: "text-end",
          id: "msg_1",
          text: "Corrected",
          providerMetadata: { "openai-compatible": { itemId: "msg_1" } },
        },
      ])
    }),
  )
  ;[false, true].forEach((streamed) => {
    it.effect(`empty item content ${streamed ? "preserves streamed text" : "does not create a text fragment"}`, () =>
      Effect.gen(function* () {
        const response = yield* collect([
          { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
          ...(streamed ? [{ type: "response.output_text.delta", item_id: "msg_1", delta: "Keep" }] : []),
          { type: "response.output_item.done", item: { type: "message", id: "msg_1", content: [] } },
          completed,
        ])
        expect(response.text).toBe(streamed ? "Keep" : "")
        expect(response.message.content.filter((part) => part.type === "text")).toHaveLength(streamed ? 1 : 0)
        if (!streamed) {
          expect(response.events.filter((event) => event.type.startsWith("text-"))).toEqual([])
          return
        }
        expect(response.events.filter(LLMEvent.is.textEnd)).toMatchObject([{ id: "msg_1" }])
        expect(response.events.filter(LLMEvent.is.textEnd).map((event) => event.text)).toEqual([undefined])
      }),
    )

    it.effect(`empty scalar and item finals ${streamed ? "clear active text" : "do not create a text fragment"}`, () =>
      Effect.gen(function* () {
        const response = yield* collect([
          { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
          ...(streamed ? [{ type: "response.output_text.delta", item_id: "msg_1", delta: "Discard" }] : []),
          { type: "response.output_text.done", item_id: "msg_1", content_index: 0, text: "" },
          {
            type: "response.content_part.done",
            item_id: "msg_1",
            content_index: 0,
            part: { type: "output_text", text: "" },
          },
          {
            type: "response.output_item.done",
            item: { type: "message", id: "msg_1", content: [{ type: "output_text", text: "" }] },
          },
          completed,
        ])
        expect(response.text).toBe("")
        expect(response.message.content.filter((part) => part.type === "text")).toHaveLength(streamed ? 1 : 0)
        if (!streamed) {
          expect(response.events.filter((event) => event.type.startsWith("text-"))).toEqual([])
          return
        }
        expect(response.events.filter(LLMEvent.is.textEnd)).toMatchObject([{ id: "msg_1", text: "" }])
      }),
    )
  })
  ;[
    {
      name: "readable text beside an unfamiliar part",
      content: [
        { type: "output_text", text: "Readable final" },
        { type: "other", text: { value: "unfamiliar" } },
      ],
      text: "Readable final",
    },
    {
      name: "unknown-only content",
      content: [{ type: "other", text: { value: "unfamiliar" } }],
      text: "Cached final",
    },
    {
      name: "malformed known text content",
      content: [
        { type: "output_text", text: { value: "unfamiliar" } },
        { type: "refusal", refusal: null },
      ],
      text: "Cached final",
    },
    { name: "empty content", content: [], text: "Cached final" },
  ].forEach((fixture) => {
    it.effect(`decodes ${fixture.name} without treating absent text as an empty final`, () =>
      Effect.gen(function* () {
        const response = yield* collect([
          { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
          { type: "response.output_text.delta", item_id: "msg_1", delta: "Draft" },
          { type: "response.output_text.done", item_id: "msg_1", text: "Cached final" },
          { type: "response.output_item.done", item: { type: "message", id: "msg_1", content: fixture.content } },
          completed,
        ])
        expect(response.text).toBe(fixture.text)
        expect(response.events.filter(LLMEvent.is.textEnd)).toEqual([
          {
            type: "text-end",
            id: "msg_1",
            text: fixture.text,
            providerMetadata: { "openai-compatible": { itemId: "msg_1" } },
          },
        ])
      }),
    )
  })

  it.effect("defers cached finals until the next message and ignores late edits to closed text", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "message", id: "msg_1", phase: "commentary" } },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Draft" },
        { type: "response.output_text.done", item_id: "msg_1", text: "First " },
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "Thinking" },
        { type: "response.output_item.added", item: { type: "message", id: "msg_2" } },
        { type: "response.output_text.delta", item_id: "msg_2", delta: "second" },
        { type: "response.output_text.done", item_id: "msg_1", text: "Late final" },
        {
          type: "response.output_item.done",
          item: { type: "message", id: "msg_1", content: [{ type: "output_text", text: "Late snapshot" }] },
        },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Late delta" },
        { type: "response.output_item.done", item: { type: "message", id: "msg_2" } },
        { type: "response.output_item.done", item: { type: "reasoning", id: "rs_1" } },
        completed,
      ])
      expect(response.text).toBe("First second")
      expect(response.reasoning).toBe("Thinking")
      expect(response.events.filter(LLMEvent.is.textEnd)).toMatchObject([
        {
          id: "msg_1",
          text: "First ",
          providerMetadata: { "openai-compatible": { itemId: "msg_1", phase: "commentary" } },
        },
        { id: "msg_2" },
      ])
      expect(
        response.events
          .filter((event) => event.type.endsWith("-start") || event.type.endsWith("-end"))
          .map((event) => event.type),
      ).toEqual(["step-start", "text-start", "reasoning-start", "text-end", "text-start", "text-end", "reasoning-end"])
    }),
  )
})

describe("Open Responses final reasoning", () => {
  ;["reasoning_summary_text.done", "reasoning_summary_part.done"].forEach((kind) => {
    ;[
      { name: "longer", text: "Draft reasoning expanded" },
      { name: "shorter", text: "Draft" },
      { name: "non-prefix", text: "Replacement" },
      { name: "empty", text: "" },
    ].forEach((final) => {
      it.effect(`replaces reasoning with a ${final.name} ${kind} snapshot at item close`, () =>
        Effect.gen(function* () {
          const response = yield* collect([
            { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1", encrypted_content: null } },
            {
              type: "response.reasoning_summary_text.delta",
              item_id: "rs_1",
              summary_index: 0,
              delta: "Draft reasoning",
            },
            {
              type: `response.${kind}`,
              item_id: "rs_1",
              summary_index: 0,
              ...(kind === "reasoning_summary_part.done"
                ? { part: { type: "summary_text", text: final.text } }
                : { text: final.text }),
            },
            {
              type: "response.output_item.done",
              item: { type: "reasoning", id: "rs_1", encrypted_content: "final-state" },
            },
            completed,
          ])
          expect(response.reasoning).toBe(final.text)
          expect(response.events.filter(LLMEvent.is.reasoningDelta).map((event) => event.text)).toEqual([
            "Draft reasoning",
          ])
          expect(response.events.filter(LLMEvent.is.reasoningEnd)).toEqual([
            {
              type: "reasoning-end",
              id: "rs_1:0",
              text: final.text,
              providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "final-state" } },
            },
          ])
          expect(response.message.content.find((part) => part.type === "reasoning")).toMatchObject({
            text: final.text,
            providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "final-state" } },
          })
        }),
      )
    })
  })

  it.effect("closes per-index finals at the next summary and only reconciles still-open item summaries", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "Draft zero" },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 0, text: "Zero" },
        { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 1 },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 1, delta: "Draft one" },
        {
          type: "response.reasoning_summary_part.done",
          item_id: "rs_1",
          summary_index: 1,
          part: { type: "summary_text", text: "Cached one" },
        },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 0, text: "Late final" },
        {
          type: "response.reasoning_summary_part.done",
          item_id: "rs_1",
          summary_index: 0,
          part: { type: "summary_text", text: "Late part" },
        },
        {
          type: "response.output_item.done",
          item: {
            type: "reasoning",
            id: "rs_1",
            encrypted_content: "final-state",
            summary: [
              { type: "summary_text", text: "Late item edit" },
              { type: "summary_text", text: "One" },
              { type: "summary_text", text: "Two" },
            ],
          },
        },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 2, text: "Late closed item" },
        completed,
      ])
      expect(response.reasoning).toBe("ZeroOneTwo")
      expect(response.events.filter(LLMEvent.is.reasoningEnd)).toMatchObject([
        { id: "rs_1:0", text: "Zero", providerMetadata: { "openai-compatible": { itemId: "rs_1" } } },
        { id: "rs_1:1", text: "One" },
        {
          id: "rs_1:2",
          text: "Two",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "final-state" } },
        },
      ])
    }),
  )

  it.effect("uses done-only reasoning summary text and ignores duplicate item finals", () =>
    Effect.gen(function* () {
      const item = {
        type: "reasoning",
        id: "rs_1",
        encrypted_content: "final-state",
        summary: [{ type: "summary_text", text: "Only summary" }],
      }
      const response = yield* collect([
        { type: "response.output_item.done", item },
        {
          type: "response.output_item.done",
          item: { ...item, summary: [{ type: "summary_text", text: "Late edit" }] },
        },
        completed,
      ])
      expect(response.reasoning).toBe("Only summary")
      expect(response.events.filter(LLMEvent.is.reasoningEnd)).toMatchObject([
        {
          text: "Only summary",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "final-state" } },
        },
      ])
    }),
  )

  it.effect("ignores earlier summary gaps without closing or reopening the active later index", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "Draft zero" },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 0, text: "Closed zero " },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 2, delta: "Draft two" },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 2, text: "Cached two" },
        {
          type: "response.output_item.done",
          item: {
            type: "reasoning",
            id: "rs_1",
            encrypted_content: "final-state",
            summary: [
              { type: "summary_text", text: "Late zero" },
              { type: "summary_text", text: "Earlier gap" },
              { type: "summary_text", text: "Final two" },
            ],
          },
        },
        completed,
      ])
      expect(response.reasoning).toBe("Closed zero Final two")
      expect(response.events.filter(LLMEvent.is.reasoningStart).map((event) => event.id)).toEqual(["rs_1:0", "rs_1:2"])
      expect(response.events.filter(LLMEvent.is.reasoningEnd)).toEqual([
        {
          type: "reasoning-end",
          id: "rs_1:0",
          text: "Closed zero ",
          providerMetadata: { "openai-compatible": { itemId: "rs_1" } },
        },
        {
          type: "reasoning-end",
          id: "rs_1:2",
          text: "Final two",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "final-state" } },
        },
      ])
    }),
  )

  it.effect("retains summary indexes and neighboring finals around an unfamiliar summary part", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "Draft" },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 0, text: "Cached zero" },
        {
          type: "response.output_item.done",
          item: {
            type: "reasoning",
            id: "rs_1",
            encrypted_content: "final-state",
            summary: [
              { type: "summary_text", text: "Final zero " },
              { type: "other", text: { value: "unfamiliar" } },
              { type: "summary_text", text: "Final two" },
            ],
          },
        },
        completed,
      ])
      expect(response.reasoning).toBe("Final zero Final two")
      expect(response.events.filter(LLMEvent.is.reasoningStart).map((event) => event.id)).toEqual(["rs_1:0", "rs_1:2"])
      expect(response.events.filter(LLMEvent.is.reasoningEnd)).toMatchObject([
        { id: "rs_1:0", text: "Final zero " },
        {
          id: "rs_1:2",
          text: "Final two",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "final-state" } },
        },
      ])
    }),
  )

  it.effect("uses a part-only summary final without any streamed reasoning deltas", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
        {
          type: "response.reasoning_summary_part.done",
          item_id: "rs_1",
          summary_index: 0,
          part: { type: "summary_text", text: "Only final" },
        },
        completed,
      ])
      expect(response.reasoning).toBe("Only final")
      expect(response.events.filter(LLMEvent.is.reasoningEnd)).toMatchObject([{ id: "rs_1:0", text: "Only final" }])
    }),
  )

  it.effect("closes cached summary finals at implicit boundaries while retaining unsnapshotted indexes", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "Draft" },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 0, text: "First " },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 1, text: "second " },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 2, delta: "fallback" },
        {
          type: "response.output_item.done",
          item: { type: "reasoning", id: "rs_1", encrypted_content: "final-state" },
        },
        completed,
      ])
      expect(response.reasoning).toBe("First second fallback")
      expect(
        response.events.filter(LLMEvent.is.reasoningEnd).map((event) => ({ id: event.id, text: event.text })),
      ).toEqual([
        { id: "rs_1:0", text: "First " },
        { id: "rs_1:1", text: "second " },
        { id: "rs_1:2", text: undefined },
      ])
    }),
  )
})

describe("Open Responses terminal finals", () => {
  it.effect("recovers tracked messages with no deltas from completed output", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        {
          type: "response.completed",
          response: {
            output: [{ type: "message", id: "msg_1", content: [{ type: "output_text", text: "Terminal only" }] }],
          },
        },
      ])
      expect(response.text).toBe("Terminal only")
      expect(response.events.filter(LLMEvent.is.textEnd)).toMatchObject([{ id: "msg_1", text: "Terminal only" }])
    }),
  )
  ;[
    { name: "compatible", model, key: "openai-compatible" },
    { name: "OpenAI", model: OpenAI.configure({ apiKey: "test-key" }).responses("gpt-5"), key: "openai" },
    { name: "xAI", model: XAI.configure({ apiKey: "test-key" }).responses("grok-4.6"), key: "xai" },
  ].forEach((provider) => {
    it.effect(`reconciles tracked text and reasoning from ${provider.name} completed output`, () =>
      Effect.gen(function* () {
        const response = yield* collect(
          [
            { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1", encrypted_content: null } },
            { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "Reasoning draft" },
            { type: "response.reasoning_summary_text.done", item_id: "rs_1", text: "Cached reasoning" },
            { type: "response.output_item.added", item: { type: "message", id: "msg_1", phase: "commentary" } },
            { type: "response.output_text.delta", item_id: "msg_1", delta: "Text draft" },
            { type: "response.output_text.done", item_id: "msg_1", text: "Cached text" },
            {
              type: "response.completed",
              response: {
                id: "resp_1",
                output: [
                  { type: "reasoning", id: "rs_unknown", summary: [{ type: "summary_text", text: "Untracked" }] },
                  { type: "message", id: "msg_unknown", content: [{ type: "output_text", text: "Untracked" }] },
                  {
                    type: "reasoning",
                    id: "rs_1",
                    encrypted_content: "terminal-state",
                    summary: [{ type: "summary_text", text: "Final reasoning" }],
                  },
                  {
                    type: "message",
                    id: "msg_1",
                    phase: "final_answer",
                    content: [{ type: "output_text", text: "Final text" }],
                  },
                ],
              },
            },
          ],
          provider.model,
        )
        expect(response.text).toBe("Final text")
        expect(response.reasoning).toBe("Final reasoning")
        expect(response.events.filter(LLMEvent.is.textEnd)).toEqual([
          {
            type: "text-end",
            id: "msg_1",
            text: "Final text",
            providerMetadata: { [provider.key]: { itemId: "msg_1", phase: "final_answer" } },
          },
        ])
        expect(response.events.filter(LLMEvent.is.reasoningEnd)).toEqual([
          {
            type: "reasoning-end",
            id: "rs_1:0",
            text: "Final reasoning",
            providerMetadata: { [provider.key]: { itemId: "rs_1", reasoningEncryptedContent: "terminal-state" } },
          },
        ])
        expect(response.message.content.find((part) => part.type === "reasoning")?.providerMetadata).toEqual({
          [provider.key]: { itemId: "rs_1", reasoningEncryptedContent: "terminal-state" },
        })
        expect(response.message.content.find((part) => part.type === "text")?.providerMetadata).toEqual({
          [provider.key]: { itemId: "msg_1", phase: "final_answer" },
        })
      }),
    )
  })
  ;["response.completed", "response.incomplete"].forEach((terminal) => {
    ;[false, true].forEach((finals) => {
      it.effect(`flushes ${finals ? "cached finals" : "delta fallback"} on ${terminal}`, () =>
        Effect.gen(function* () {
          const response = yield* collect([
            { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
            { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "Reasoning draft" },
            { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
            { type: "response.output_text.delta", item_id: "msg_1", delta: "Text draft" },
            ...(finals
              ? [
                  { type: "response.reasoning_summary_text.done", item_id: "rs_1", text: "Reasoning final" },
                  { type: "response.output_text.done", item_id: "msg_1", text: "Text final" },
                ]
              : []),
            {
              type: terminal,
              response: {
                id: "resp_1",
                ...(terminal === "response.incomplete"
                  ? {
                      incomplete_details: { reason: "max_output_tokens" },
                      output: [
                        { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "Not reconciled" }] },
                        { type: "message", id: "msg_1", content: [{ type: "output_text", text: "Not reconciled" }] },
                      ],
                    }
                  : {}),
              },
            },
          ])
          expect(response.text).toBe(finals ? "Text final" : "Text draft")
          expect(response.reasoning).toBe(finals ? "Reasoning final" : "Reasoning draft")
          expect(response.events.filter(LLMEvent.is.textEnd).map((event) => event.text)).toEqual([
            finals ? "Text final" : undefined,
          ])
          expect(response.events.filter(LLMEvent.is.reasoningEnd).map((event) => event.text)).toEqual([
            finals ? "Reasoning final" : undefined,
          ])
          expect(response.events.filter(LLMEvent.is.finish).map((event) => event.reason.normalized)).toEqual([
            terminal === "response.incomplete" ? "length" : "stop",
          ])
        }),
      )
    })
  })

  it.effect("does not reopen closed text or reasoning from completed output", () =>
    Effect.gen(function* () {
      const response = yield* collect([
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1" } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "Original reasoning" },
        { type: "response.output_item.done", item: { type: "reasoning", id: "rs_1" } },
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Original text" },
        { type: "response.output_item.done", item: { type: "message", id: "msg_1" } },
        {
          type: "response.completed",
          response: {
            output: [
              { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "Late reasoning" }] },
              { type: "message", id: "msg_1", content: [{ type: "output_text", text: "Late text" }] },
            ],
          },
        },
      ])
      expect(response.text).toBe("Original text")
      expect(response.reasoning).toBe("Original reasoning")
      expect(response.events.filter(LLMEvent.is.textEnd)).toHaveLength(1)
      expect(response.events.filter(LLMEvent.is.reasoningEnd)).toHaveLength(1)
    }),
  )
})
