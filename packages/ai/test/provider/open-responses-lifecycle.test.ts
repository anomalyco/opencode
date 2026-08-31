import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
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

const collect = (...input: OpenResponses.Event[]) =>
  Effect.gen(function* () {
    const events = yield* LLMClient.stream(request).pipe(
      Stream.runCollect,
      Effect.provide(fixedResponse(sseEvents(...input))),
    )
    expectLifecycle(
      events,
      input.some((event) => event.type === "response.completed"),
    )
    return events
  })

// Deliberately local to these basic-item fixtures, not a general stream validator.
function expectLifecycle(events: ReadonlyArray<LLMEvent>, completed: boolean) {
  const active = { text: new Set<string>(), reasoning: new Set<string>() }
  const tools = new Map<string, "started" | "ended" | "called">()
  events.forEach((event) => {
    if (event.type === "text-start" || event.type === "reasoning-start") {
      const blocks = event.type === "text-start" ? active.text : active.reasoning
      expect(blocks.size).toBe(0)
      blocks.add(event.id)
    }
    if (event.type === "text-delta" || event.type === "reasoning-delta") {
      expect((event.type === "text-delta" ? active.text : active.reasoning).has(event.id)).toBe(true)
    }
    if (event.type === "text-end" || event.type === "reasoning-end") {
      expect((event.type === "text-end" ? active.text : active.reasoning).delete(event.id)).toBe(true)
    }
    if (event.type === "tool-input-start") {
      expect(tools.has(event.id)).toBe(false)
      tools.set(event.id, "started")
    }
    if (event.type === "tool-input-delta") expect(tools.get(event.id)).toBe("started")
    if (event.type === "tool-input-end") {
      expect(tools.get(event.id)).toBe("started")
      tools.set(event.id, "ended")
    }
    if (event.type === "tool-call") {
      expect(tools.get(event.id)).toBe("ended")
      tools.set(event.id, "called")
    }
    // Incomplete responses may leave pending tool inputs without a call.
    if (event.type === "finish" && completed) {
      expect(active.text.size).toBe(0)
      expect(active.reasoning.size).toBe(0)
      expect([...tools.values()].every((status) => status === "called")).toBe(true)
    }
  })
  expect(events.filter(LLMEvent.is.stepStart)).toHaveLength(1)
  expect(events[0]?.type).toBe("step-start")
  expect(events.filter(LLMEvent.is.stepFinish)).toHaveLength(1)
  expect(events.filter(LLMEvent.is.finish)).toHaveLength(1)
  expect(events.slice(-2).map((event) => event.type)).toEqual(["step-finish", "finish"])
}

describe("Open Responses basic-item lifecycles", () => {
  it.effect("closes implicit summary boundaries and ignores late events for completed reasoning", () =>
    Effect.gen(function* () {
      const item = { type: "reasoning", id: "rs_1", encrypted_content: "encrypted-state" }
      const events = yield* collect(
        { type: "response.output_item.added", output_index: 0, item: { ...item, encrypted_content: null } },
        { type: "response.output_item.added", item: { ...item, encrypted_content: null } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "First" },
        { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 1 },
        { type: "response.reasoning_summary_part.done", item_id: "rs_1", summary_index: 0 },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 1, text: "Second" },
        // The third part omits both explicit summary boundaries.
        {
          type: "response.reasoning_summary_text.delta",
          output_index: 0,
          item_id: "wrong",
          summary_index: 2,
          delta: "Third",
        },
        { type: "response.output_item.done", item },
        { type: "response.output_item.done", item },
        { type: "response.output_item.added", item },
        { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 3 },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 3, delta: "late" },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 2, text: "late final" },
        { type: "response.reasoning_summary_part.done", item_id: "rs_1", summary_index: 3 },
        completed,
      )

      expect(events.filter((event) => event.type.startsWith("reasoning-"))).toEqual([
        {
          type: "reasoning-start",
          id: "rs_1:0",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: null } },
        },
        { type: "reasoning-delta", id: "rs_1:0", text: "First" },
        { type: "reasoning-end", id: "rs_1:0", providerMetadata: { "openai-compatible": { itemId: "rs_1" } } },
        {
          type: "reasoning-start",
          id: "rs_1:1",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: null } },
        },
        { type: "reasoning-delta", id: "rs_1:1", text: "Second" },
        { type: "reasoning-end", id: "rs_1:1", providerMetadata: { "openai-compatible": { itemId: "rs_1" } } },
        {
          type: "reasoning-start",
          id: "rs_1:2",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: null } },
        },
        { type: "reasoning-delta", id: "rs_1:2", text: "Third" },
        {
          type: "reasoning-end",
          id: "rs_1:2",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
        },
      ])
    }),
  )

  it.effect("preserves done-only reasoning text and encryption without replaying late events", () =>
    Effect.gen(function* () {
      const item = {
        type: "reasoning",
        id: "rs_1",
        encrypted_content: "encrypted-state",
        summary: [{ type: "summary_text", text: "Not streamed" }],
      }
      const events = yield* collect(
        { type: "response.output_item.done", item },
        { type: "response.output_item.done", item },
        { type: "response.output_item.added", item },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "late" },
        { type: "response.reasoning_summary_part.added", item_id: "rs_1", summary_index: 1 },
        { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 1, text: "late final" },
        completed,
        // Route termination must also prevent events after response completion.
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_after" } },
      )
      expect(events.filter((event) => event.type.startsWith("reasoning-"))).toEqual([
        {
          type: "reasoning-start",
          id: "rs_1",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
        },
        {
          type: "reasoning-end",
          id: "rs_1",
          text: "Not streamed",
          providerMetadata: { "openai-compatible": { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" } },
        },
      ])
    }),
  )

  it.effect("forgets never-streamed messages at implicit boundaries and preserves refusal phases", () =>
    Effect.gen(function* () {
      const events = yield* collect(
        { type: "response.output_item.added", item: { type: "message", id: "msg_empty" } },
        { type: "response.output_item.added", item: { type: "message", id: "msg_1", phase: "commentary" } },
        { type: "response.output_text.done", item_id: "msg_1", text: "Checking" },
        { type: "response.output_text.done", item_id: "msg_1", text: "Duplicate" },
        { type: "response.output_item.added", item: { type: "message", id: "msg_2", phase: null } },
        { type: "response.output_text.delta", item_id: "msg_empty", delta: "stale" },
        { type: "response.output_text.done", item_id: "msg_empty", text: "stale final" },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "late" },
        { type: "response.refusal.delta", item_id: "msg_2", delta: "Cannot help." },
        { type: "response.refusal.done", item_id: "msg_2", refusal: "Cannot help." },
        { type: "response.output_item.done", item: { type: "message", id: "msg_2", phase: "final_answer" } },
        { type: "response.output_item.added", item: { type: "message", id: "msg_3", phase: null } },
        { type: "response.refusal.done", item_id: "msg_3", refusal: "Done-only refusal." },
        { type: "response.output_item.done", item: { type: "message", id: "msg_3" } },
        completed,
      )
      expect(events.filter((event) => event.type.startsWith("text-"))).toEqual([
        {
          type: "text-start",
          id: "msg_1",
          providerMetadata: { "openai-compatible": { itemId: "msg_1", phase: "commentary" } },
        },
        { type: "text-delta", id: "msg_1", text: "Checking" },
        {
          type: "text-end",
          id: "msg_1",
          providerMetadata: { "openai-compatible": { itemId: "msg_1", phase: "commentary" } },
        },
        {
          type: "text-start",
          id: "msg_2",
          providerMetadata: { "openai-compatible": { itemId: "msg_2", phase: null } },
        },
        { type: "text-delta", id: "msg_2", text: "Cannot help." },
        {
          type: "text-end",
          id: "msg_2",
          providerMetadata: { "openai-compatible": { itemId: "msg_2", phase: "final_answer" } },
        },
        {
          type: "text-start",
          id: "msg_3",
          providerMetadata: { "openai-compatible": { itemId: "msg_3", phase: null } },
        },
        { type: "text-delta", id: "msg_3", text: "Done-only refusal." },
        { type: "text-end", id: "msg_3", providerMetadata: { "openai-compatible": { itemId: "msg_3", phase: null } } },
      ])
    }),
  )
  it.effect("allows a message to be registered again without inheriting its previous phase", () =>
    Effect.gen(function* () {
      const events = yield* collect(
        { type: "response.output_item.added", item: { type: "message", id: "msg_1", phase: "commentary" } },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "First" },
        { type: "response.output_item.done", item: { type: "message", id: "msg_1" } },
        { type: "response.output_item.added", item: { type: "message", id: "msg_1" } },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Second" },
        { type: "response.output_item.done", item: { type: "message", id: "msg_1" } },
        completed,
      )
      expect(events.filter(LLMEvent.is.textEnd)).toEqual([
        {
          type: "text-end",
          id: "msg_1",
          providerMetadata: { "openai-compatible": { itemId: "msg_1", phase: "commentary" } },
        },
        { type: "text-end", id: "msg_1", providerMetadata: { "openai-compatible": { itemId: "msg_1" } } },
      ])
      expect(events.filter(LLMEvent.is.textDelta).map((event) => event.text)).toEqual(["First", "Second"])
    }),
  )
  ;[undefined, "fc_1"].forEach((id) => {
    it.effect(`opens and closes a done-only tool ${id === undefined ? "without" : "with"} an item id`, () =>
      Effect.gen(function* () {
        const item = {
          type: "function_call",
          ...(id === undefined ? {} : { id }),
          call_id: "call_1",
          name: "lookup",
          arguments: '{"query":"weather"}',
        }
        const events = yield* collect(
          { type: "response.output_item.done", item },
          { type: "response.output_item.done", item: { ...item, id: "fc_1" } },
          { type: "response.output_item.added", item },
          completed,
        )
        const providerMetadata = id === undefined ? undefined : { "openai-compatible": { itemId: id } }
        expect(events.filter((event) => event.type.startsWith("tool-"))).toEqual([
          { type: "tool-input-start", id: "call_1", name: "lookup", providerMetadata },
          { type: "tool-input-end", id: "call_1", name: "lookup", providerMetadata },
          { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" }, providerMetadata },
        ])
        expect(events.filter(LLMEvent.is.finish)).toEqual([
          {
            type: "finish",
            reason: { normalized: "tool-calls", raw: undefined },
            providerMetadata: { "openai-compatible": { responseId: "resp_1", serviceTier: undefined } },
          },
        ])
      }),
    )

    it.effect(`deduplicates a pending call whose item id is ${id === undefined ? "introduced" : "omitted"} later`, () =>
      Effect.gen(function* () {
        const item = { type: "function_call", call_id: "call_1", name: "lookup" }
        const first = { ...item, ...(id === undefined ? {} : { id }) }
        const duplicate = { ...item, ...(id === undefined ? { id: "fc_1" } : {}) }
        const events = yield* collect(
          { type: "response.output_item.added", item: first },
          { type: "response.function_call_arguments.delta", item_id: id ?? "call_1", delta: '{"query":"weather"}' },
          { type: "response.output_item.added", item: duplicate },
          { type: "response.output_item.done", item: duplicate },
          { type: "response.output_item.done", item: first },
          { type: "response.output_item.added", item: duplicate },
          completed,
        )
        // Identity metadata comes from the first admission, not the duplicate.
        const providerMetadata = id === undefined ? undefined : { "openai-compatible": { itemId: id } }
        expect(events.filter((event) => event.type.startsWith("tool-"))).toEqual([
          { type: "tool-input-start", id: "call_1", name: "lookup", providerMetadata },
          {
            type: "tool-input-delta",
            id: "call_1",
            name: "lookup",
            text: '{"query":"weather"}',
            input: { query: "weather" },
          },
          { type: "tool-input-end", id: "call_1", name: "lookup", providerMetadata },
          { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" }, providerMetadata },
        ])
      }),
    )
  })

  it.effect("recovers pending calls without reconciling terminal reasoning", () =>
    Effect.gen(function* () {
      const events = yield* collect(
        {
          type: "response.output_item.added",
          item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup" },
        },
        { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"query":"draft"}' },
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1", encrypted_content: null } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "Thinking" },
        { type: "response.reasoning_summary_part.done", item_id: "rs_1", summary_index: 0 },
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            output: [
              { type: "reasoning", id: "rs_1", encrypted_content: "terminal-state" },
              { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: '{"query":"final"}' },
              { type: "function_call", id: "fc_unseen", call_id: "call_unseen", name: "lookup", arguments: "{}" },
            ],
          },
        },
      )
      expect(events.slice(5, -2)).toEqual([
        {
          type: "tool-input-end",
          id: "call_1",
          name: "lookup",
          providerMetadata: { "openai-compatible": { itemId: "fc_1" } },
        },
        {
          type: "tool-call",
          id: "call_1",
          name: "lookup",
          input: { query: "final" },
          providerExecuted: undefined,
          providerMetadata: { "openai-compatible": { itemId: "fc_1" } },
        },
        { type: "reasoning-end", id: "rs_1:0" },
      ])
    }),
  )

  it.effect("preserves call identity and pending order when an item id is reused", () =>
    Effect.gen(function* () {
      const first = { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup", arguments: "{}" }
      const events = yield* collect(
        { type: "response.output_item.added", item: first },
        { type: "response.output_item.added", item: { ...first, id: "fc_2", call_id: "call_2" } },
        { type: "response.output_item.done", item: first },
        { type: "response.output_item.added", item: { ...first, call_id: "call_3" } },
        { type: "response.output_item.done", item: first },
        completed,
      )
      expect(events.filter(LLMEvent.is.toolCall).map((event) => event.id)).toEqual(["call_1", "call_2", "call_3"])
    }),
  )

  it.effect("keeps text and reasoning identities separate even with empty item ids", () =>
    Effect.gen(function* () {
      const events = yield* collect(
        { type: "response.output_item.added", item: { type: "reasoning", id: "" } },
        { type: "response.output_item.added", item: { type: "message", id: "" } },
        { type: "response.output_item.added", item: { type: "reasoning", id: "" } },
        { type: "response.reasoning_summary_text.delta", item_id: "", delta: "Thinking" },
        { type: "response.output_text.delta", item_id: "", delta: "Answer" },
        { type: "response.output_item.done", item: { type: "reasoning", id: "", encrypted_content: "state" } },
        { type: "response.output_item.done", item: { type: "message", id: "" } },
        completed,
      )
      expect(events.filter(LLMEvent.is.reasoningDelta).map((event) => event.text)).toEqual(["Thinking"])
      expect(events.filter(LLMEvent.is.textDelta).map((event) => event.text)).toEqual(["Answer"])
      expect(events.filter(LLMEvent.is.reasoningEnd)).toEqual([
        {
          type: "reasoning-end",
          id: ":0",
          providerMetadata: { "openai-compatible": { itemId: "", reasoningEncryptedContent: "state" } },
        },
      ])
    }),
  )

  it.effect("does not recover a completed tool from a tracked message with the same id", () =>
    Effect.gen(function* () {
      const events = yield* collect(
        { type: "response.output_item.added", item: { type: "message", id: "item_1" } },
        { type: "response.output_text.delta", item_id: "item_1", delta: "Answer" },
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            output: [{ type: "function_call", id: "item_1", call_id: "call_1", name: "lookup", arguments: "{}" }],
          },
        },
      )
      expect(events.filter(LLMEvent.is.toolCall)).toEqual([])
      expect(events.filter(LLMEvent.is.finish).map((event) => event.reason.normalized)).toEqual(["stop"])
    }),
  )

  it.effect("flushes pending calls and open text when completed output is absent", () =>
    Effect.gen(function* () {
      const events = yield* collect(
        { type: "response.output_item.added", item: { type: "message", id: "msg_1", phase: "final_answer" } },
        { type: "response.output_text.delta", item_id: "msg_1", delta: "Answer" },
        {
          type: "response.output_item.added",
          item: { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
        },
        completed,
      )
      // Generic terminal closure does not repeat the message's phase metadata.
      expect(events.slice(4, -2)).toEqual([
        { type: "tool-input-end", id: "call_1", name: "lookup" },
        { type: "tool-call", id: "call_1", name: "lookup", input: {} },
        { type: "text-end", id: "msg_1" },
      ])
    }),
  )

  it.effect("does not reconcile pending calls or terminal reasoning metadata on incomplete responses", () =>
    Effect.gen(function* () {
      const events = yield* collect(
        { type: "response.output_item.added", item: { type: "reasoning", id: "rs_1", encrypted_content: null } },
        { type: "response.reasoning_summary_text.delta", item_id: "rs_1", delta: "Partial" },
        {
          type: "response.output_item.added",
          item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "lookup" },
        },
        { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"query":' },
        {
          type: "response.incomplete",
          response: {
            id: "resp_1",
            incomplete_details: { reason: "max_output_tokens" },
            output: [
              { type: "reasoning", id: "rs_1", encrypted_content: "not-reconciled" },
              {
                type: "function_call",
                id: "fc_1",
                call_id: "call_1",
                name: "lookup",
                arguments: '{"query":"not-reconciled"}',
              },
            ],
          },
        },
      )
      expect(events.filter(LLMEvent.is.toolInputEnd)).toEqual([])
      expect(events.filter(LLMEvent.is.toolCall)).toEqual([])
      expect(events.filter(LLMEvent.is.reasoningEnd)).toEqual([{ type: "reasoning-end", id: "rs_1:0" }])
      expect(events.filter(LLMEvent.is.finish)).toEqual([
        {
          type: "finish",
          reason: { normalized: "length", raw: "max_output_tokens" },
          providerMetadata: { "openai-compatible": { responseId: "resp_1", serviceTier: undefined } },
        },
      ])
    }),
  )
})
