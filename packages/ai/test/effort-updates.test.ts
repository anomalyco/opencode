import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMRequest, Message, ToolCallPart } from "../src/index.js"
import { Auth, LLMClient } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { AnthropicMessages } from "../src/protocols/anthropic-messages.js"
import { OpenAIResponses } from "../src/protocols/openai-responses.js"
import { Gemini } from "../src/protocols/gemini.js"
import { GoogleVertexMessages, OpenAI } from "../src/providers.js"
import { applyCachePolicy } from "../src/cache-policy.js"
import { applyEffortUpdates } from "../src/effort-updates.js"
import { it, testEffect } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"
import { sseEvents } from "./lib/sse.js"

const anthropic = (id: string, compatibility?: { readonly supportsEffortUpdates?: boolean }) =>
  AnthropicMessages.route
    .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
    .model({ id, compatibility })

const openai = (id: string, compatibility?: { readonly supportsEffortUpdates?: boolean }) =>
  OpenAIResponses.route
    .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
    .model({ id, compatibility })

const opus5 = anthropic("claude-opus-5")
const astra = openai("gpt-6-astra")

const lowFromHigh = Message.effort({ effort: "low", previous: "high" })
const conversation = [Message.user("Before."), lowFromHigh, Message.user("After.")]

const systemMessages = (body: AnthropicMessages.AnthropicMessagesBody) =>
  body.messages.filter((message) => message.role === "system")

const updates = (body: OpenAIResponses.OpenAIResponsesBody) =>
  body.input.filter((item) => "type" in item && item.type === "configuration_update")

describe("applyEffortUpdates", () => {
  test("keeps the request identity without markers and for protocols that lower them", () => {
    const plain = LLM.request({ model: opus5, prompt: "hi" })
    expect(applyEffortUpdates(plain)).toBe(plain)

    const supported = LLM.request({ model: opus5, messages: conversation, providerOptions: { effort: "low" } })
    expect(applyEffortUpdates(supported)).toBe(supported)
  })

  it.effect("compiles markers away for protocols without per-message effort", () =>
    Effect.gen(function* () {
      const model = Gemini.route
        .with({
          endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
          auth: Auth.header("x-goog-api-key", "test"),
        })
        .model({ id: "gemini-3.5-flash" })
      const withMarkers = yield* compileRequest(LLM.request({ model, messages: conversation }))
      const withoutMarkers = yield* compileRequest(
        LLM.request({ model, messages: [Message.user("Before."), Message.user("After.")] }),
      )

      expect(withMarkers.body).toEqual(withoutMarkers.body)
    }),
  )
})

describe("cache policy", () => {
  it.effect("walks the tail breakpoint back past a trailing effort marker", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: opus5,
          messages: [Message.user("first"), Message.assistant("reply"), Message.user("latest"), lowFromHigh],
          providerOptions: { effort: "low" },
          cache: "auto",
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "first" }] },
        { role: "assistant", content: [{ type: "text", text: "reply" }] },
        { role: "user", content: [{ type: "text", text: "latest", cache_control: { type: "ephemeral" } }] },
        { role: "system", content: [], output_config: { effort: "low" } },
      ])
    }),
  )
})

describe("Anthropic Messages effort updates", () => {
  it.effect("lowers markers to per-turn system messages and freezes the top-level effort", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({ model: opus5, messages: conversation, providerOptions: { effort: "low" }, cache: "none" }),
      )

      expect(prepared.body.output_config).toEqual({ effort: "high" })
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Before." }] },
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "user", content: [{ type: "text", text: "After." }] },
      ])
    }),
  )

  it.effect("omits the frozen effort for the model default and sends `high` for a switch back to it", () =>
    Effect.gen(function* () {
      const format = { type: "json_schema" as const, schema: { type: "object" } }
      const prepared = yield* compileRequest(
        LLM.request({
          model: opus5,
          messages: [
            Message.user("One."),
            Message.effort({ effort: "low" }),
            Message.user("Two."),
            Message.effort({ previous: "low" }),
            Message.user("Three."),
          ],
          providerOptions: { output_config: { format } },
          cache: "none",
        }),
      )

      expect(prepared.body.output_config).toEqual({ format })
      expect(systemMessages(prepared.body)).toEqual([
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "system", content: [], output_config: { effort: "high" } },
      ])
    }),
  )

  it.effect("requests the mid-conversation output config beta only when markers are sent", () =>
    Effect.gen(function* () {
      for (const [model, betas] of [
        [opus5, "existing-beta,mid-conversation-output-config-2026-07-01"],
        [anthropic("claude-sonnet-5"), "existing-beta"],
      ] as const) {
        const request = LLM.request({
          model,
          messages: conversation,
          providerOptions: { effort: "low" },
          http: { headers: { "anthropic-beta": "existing-beta" } },
        })
        const compiled = yield* compileRequest(request)
        const prepared = yield* AnthropicMessages.route.prepareTransport(compiled.body, request)
        expect(prepared.request.headers["anthropic-beta"]).toBe(betas)
      }
    }),
  )

  it.effect("accepts a marker between a tool call and its result", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: opus5,
          messages: [
            Message.user("Weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })]),
            lowFromHigh,
            Message.tool({ id: "call_1", name: "lookup", result: { temp: 72 } }),
          ],
          providerOptions: { effort: "low" },
          cache: "none",
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Weather?" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "lookup", input: {} }] },
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"temp":72}' }] },
      ])
    }),
  )

  it.effect("falls back to a plain top-level effort when history drifted from the current effort", () =>
    Effect.gen(function* () {
      const drifted = yield* compileRequest(
        LLM.request({ model: opus5, messages: conversation, providerOptions: { effort: "medium" }, cache: "none" }),
      )
      const plain = yield* compileRequest(
        LLM.request({
          model: opus5,
          messages: [Message.user("Before."), Message.user("After.")],
          providerOptions: { effort: "medium" },
          cache: "none",
        }),
      )

      expect(drifted.body).toEqual(plain.body)
      expect(drifted.body.output_config).toEqual({ effort: "medium" })
    }),
  )

  for (const [id, supported] of [
    ["claude-opus-5", true],
    ["claude-opus-5-20260901", true],
    ["anthropic/claude-opus-5", true],
    ["claude-fable-5-1", true],
    ["claude-mythos-5-1", true],
    ["claude-fable-5", false],
    ["claude-opus-4-8", false],
    ["claude-sonnet-5", false],
    ["kimi-k2.5", false],
  ] as const) {
    it.effect(`${supported ? "lowers" : "strips"} markers for ${id}`, () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          LLM.request({ model: anthropic(id), messages: conversation, providerOptions: { effort: "low" } }),
        )

        expect(systemMessages(prepared.body)).toHaveLength(supported ? 1 : 0)
        expect(prepared.body.output_config).toEqual({ effort: supported ? "high" : "low" })
      }),
    )
  }

  it.effect("honors the compatibility override in both directions", () =>
    Effect.gen(function* () {
      const enabled = yield* compileRequest(
        LLM.request({
          model: anthropic("claude-sonnet-5", { supportsEffortUpdates: true }),
          messages: conversation,
          providerOptions: { effort: "low" },
        }),
      )
      const disabled = yield* compileRequest(
        LLM.request({
          model: anthropic("claude-opus-5", { supportsEffortUpdates: false }),
          messages: conversation,
          providerOptions: { effort: "low" },
        }),
      )

      expect(systemMessages(enabled.body)).toHaveLength(1)
      expect(systemMessages(disabled.body)).toHaveLength(0)
    }),
  )

  it.effect("strips markers on the Vertex Anthropic route, whose protocol wrapper does not forward support", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: GoogleVertexMessages.configure({ accessToken: "test", location: "global", project: "test" }).model(
            "claude-opus-5",
          ),
          messages: conversation,
          providerOptions: { effort: "low" },
        }),
      )

      expect(systemMessages(prepared.body)).toHaveLength(0)
      expect(prepared.body.output_config).toEqual({ effort: "low" })
    }),
  )
})

describe("OpenAI Responses effort updates", () => {
  it.effect("lowers markers to configuration_update items and freezes reasoning.effort", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({ model: astra, messages: conversation, providerOptions: { reasoningEffort: "low" } }),
      )

      expect(prepared.body.reasoning).toEqual({ effort: "high" })
      expect(prepared.body.input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "Before." }] },
        { type: "configuration_update", reasoning: { effort: "low" } },
        { role: "user", content: [{ type: "input_text", text: "After." }] },
      ])
    }),
  )

  it.effect("coalesces consecutive updates so the newest wins", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: astra,
          messages: [
            Message.user("Before."),
            Message.effort({ effort: "low", previous: "medium" }),
            Message.effort({ effort: "xhigh", previous: "low" }),
            Message.user("After."),
          ],
          providerOptions: { reasoningEffort: "xhigh" },
        }),
      )

      expect(prepared.body.reasoning).toEqual({ effort: "medium" })
      expect(prepared.body.input).toEqual([
        { role: "user", content: [{ type: "input_text", text: "Before." }] },
        { type: "configuration_update", reasoning: { effort: "xhigh" } },
        { role: "user", content: [{ type: "input_text", text: "After." }] },
      ])
    }),
  )

  it.effect("omits reasoning.effort for the model default and sends `medium` for a switch back to it", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: astra,
          messages: [
            Message.user("One."),
            Message.effort({ effort: "low" }),
            Message.user("Two."),
            Message.effort({ previous: "low" }),
            Message.user("Three."),
          ],
        }),
      )

      expect(prepared.body.reasoning).toBeUndefined()
      expect(updates(prepared.body)).toEqual([
        { type: "configuration_update", reasoning: { effort: "low" } },
        { type: "configuration_update", reasoning: { effort: "medium" } },
      ])
    }),
  )

  it.effect("falls back to a plain top-level effort when history drifted from the current effort", () =>
    Effect.gen(function* () {
      const drifted = yield* compileRequest(
        LLM.request({ model: astra, messages: conversation, providerOptions: { reasoningEffort: "xhigh" } }),
      )
      const plain = yield* compileRequest(
        LLM.request({
          model: astra,
          messages: [Message.user("Before."), Message.user("After.")],
          providerOptions: { reasoningEffort: "xhigh" },
        }),
      )

      expect(drifted.body).toEqual(plain.body)
      expect(drifted.body.reasoning).toEqual({ effort: "xhigh" })
    }),
  )

  it.effect("strips markers when automatic context management is enabled", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: astra,
          messages: conversation,
          providerOptions: { reasoningEffort: "low", contextManagement: [{ type: "compaction" }] },
        }),
      )

      expect(updates(prepared.body)).toEqual([])
      expect(prepared.body.reasoning).toEqual({ effort: "low" })
      expect(prepared.body.context_management).toEqual([{ type: "compaction" }])
    }),
  )

  for (const [id, supported] of [
    ["gpt-6-astra", true],
    ["openai/gpt-6-astra", true],
    ["gpt-6-astra-2026-09-01", false],
    ["gpt-5.6-sol", false],
  ] as const) {
    it.effect(`${supported ? "lowers" : "strips"} markers for ${id}`, () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          LLM.request({ model: openai(id), messages: conversation, providerOptions: { reasoningEffort: "low" } }),
        )

        expect(updates(prepared.body)).toHaveLength(supported ? 1 : 0)
        expect(prepared.body.reasoning).toEqual({ effort: supported ? "high" : "low" })
      }),
    )
  }

  it.effect("honors the compatibility override in both directions", () =>
    Effect.gen(function* () {
      const enabled = yield* compileRequest(
        LLM.request({
          model: openai("gpt-5.5", { supportsEffortUpdates: true }),
          messages: conversation,
          providerOptions: { reasoningEffort: "low" },
        }),
      )
      const disabled = yield* compileRequest(
        LLM.request({
          model: openai("gpt-6-astra", { supportsEffortUpdates: false }),
          messages: conversation,
          providerOptions: { reasoningEffort: "low" },
        }),
      )

      expect(updates(enabled.body)).toHaveLength(1)
      expect(updates(disabled.body)).toHaveLength(0)
    }),
  )

  const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque" }
  const compactRequest = LLM.request({
    model: OpenAI.configure({ apiKey: "fixture" }).responses("gpt-6-astra"),
    messages: conversation,
    providerOptions: { reasoningEffort: "low" },
  })

  testEffect(
    dynamicResponse(({ text, respond }) =>
      Effect.sync(() => {
        const body = JSON.parse(text)
        expect(body.reasoning).toEqual({ effort: "high" })
        expect(body.input).toEqual([
          { role: "user", content: [{ type: "input_text", text: "Before." }] },
          { type: "configuration_update", reasoning: { effort: "low" } },
          { role: "user", content: [{ type: "input_text", text: "After." }] },
          { type: "compaction_trigger" },
        ])
        return respond(sseEvents({ type: "response.completed", response: { id: "resp_1", output: [checkpoint] } }), {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    ),
  ).effect("keeps configuration updates in the checkpoint body", () =>
    Effect.gen(function* () {
      const result = yield* LLMClient.compact(compactRequest, { mechanism: "trigger" })
      expect(result.checkpoint.encrypted).toBe("opaque")
    }),
  )

  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        expect(new URL(request.url).pathname).toEndWith("/responses/compact")
        expect(JSON.parse(text).input).toEqual([
          { role: "user", content: [{ type: "input_text", text: "Before." }] },
          { role: "user", content: [{ type: "input_text", text: "After." }] },
        ])
        return respond(JSON.stringify({ object: "response.compaction", output: [checkpoint] }))
      }),
    ),
  ).effect("drops markers from the compaction endpoint body", () =>
    Effect.gen(function* () {
      const result = yield* LLMClient.compact(compactRequest, { mechanism: "endpoint" })
      expect(result.replacement.map((message) => message.content[0]?.type)).toEqual(["compaction"])
    }),
  )
})
