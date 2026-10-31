import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, Message, ToolCallPart } from "../src/effect.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { AnthropicMessages } from "../src/protocols/anthropic-messages.js"
import { OpenAIResponses } from "../src/protocols/openai-responses.js"
import { Gemini } from "../src/protocols/gemini.js"
import { AmazonBedrockMantle, GoogleVertexMessages, OpenAI } from "../src/providers.js"
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

const conversation = [Message.user("Before."), Message.assistant("First.", { effort: "high" }), Message.user("After.")]

const systemMessages = (body: AnthropicMessages.AnthropicMessagesBody) =>
  body.messages.filter((message) => message.role === "system")

const updates = (body: OpenAIResponses.OpenAIResponsesBody) =>
  body.input.filter((item) => "type" in item && item.type === "configuration_update")

describe("unsupported protocols", () => {
  it.effect("ignores assistant effort annotations on protocols without per-message effort", () =>
    Effect.gen(function* () {
      const model = Gemini.route
        .with({
          endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
          auth: Auth.header("x-goog-api-key", "test"),
        })
        .model({ id: "gemini-3.5-flash" })
      const withEffort = yield* compileRequest(ai.request({ model, messages: conversation }))
      const plain = yield* compileRequest(
        ai.request({ model, messages: [Message.user("Before."), Message.assistant("First."), Message.user("After.")] }),
      )

      expect(withEffort.body).toEqual(plain.body)
    }),
  )
})

describe("cache policy", () => {
  it.effect("keeps the tail breakpoint on the preceding tool result when a trailing effort marker is emitted", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          messages: [
            Message.user("first"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })], { effort: "high" }),
            Message.tool({ id: "call_1", name: "lookup", result: "ok" }),
          ],
          providerOptions: { effort: "low" },
          cache: "auto",
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "first", cache_control: undefined }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "lookup", input: {} }] },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: '"ok"',
              is_error: undefined,
              cache_control: { type: "ephemeral" },
            },
          ],
        },
        { role: "system", content: [], output_config: { effort: "low" } },
      ])
    }),
  )
})

describe("Anthropic Messages effort updates", () => {
  it.effect("lowers switches to per-turn system messages and freezes the top-level effort", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({ model: opus5, messages: conversation, providerOptions: { effort: "low" }, cache: "none" }),
      )

      expect(prepared.body.output_config).toEqual({ effort: "high" })
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Before." }] },
        { role: "assistant", content: [{ type: "text", text: "First." }] },
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "user", content: [{ type: "text", text: "After." }] },
      ])
    }),
  )

  it.effect("preserves the frozen baseline and earlier markers after reverting or forking to an earlier turn", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          messages: [
            Message.user("One."),
            Message.assistant("First.", { effort: "high" }),
            Message.user("Two."),
            Message.assistant("Second.", { effort: "low" }),
            Message.user("Forked follow-up."),
          ],
          providerOptions: { effort: "max" },
          cache: "none",
        }),
      )

      expect(prepared.body.output_config).toEqual({ effort: "high" })
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "One." }] },
        { role: "assistant", content: [{ type: "text", text: "First." }] },
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "user", content: [{ type: "text", text: "Two." }] },
        { role: "assistant", content: [{ type: "text", text: "Second." }] },
        { role: "system", content: [], output_config: { effort: "max" } },
        { role: "user", content: [{ type: "text", text: "Forked follow-up." }] },
      ])
    }),
  )

  it.effect("omits the frozen effort for the model default and sends the model default when switching back", () =>
    Effect.gen(function* () {
      const format = { type: "json_schema" as const, schema: { type: "object" } }
      for (const [id, expectedDefault] of [
        ["claude-opus-5", "high"],
        ["claude-sonnet-5-5", "high"],
        ["claude-opus-5-5", "medium"],
        ["claude-haiku-5-5", "medium"],
      ] as const) {
        const prepared = yield* compileRequest(
          ai.request({
            model: anthropic(id),
            messages: [
              Message.user("One."),
              Message.assistant("First.", { effort: null }),
              Message.user("Two."),
              Message.assistant("Second.", { effort: "low" }),
              Message.user("Three."),
            ],
            providerOptions: { output_config: { format } },
            cache: "none",
          }),
        )

        expect(prepared.body.output_config).toEqual({ format })
        expect(systemMessages(prepared.body)).toEqual([
          { role: "system", content: [], output_config: { effort: "low" } },
          { role: "system", content: [], output_config: { effort: expectedDefault } },
        ])
      }
    }),
  )

  it.effect("places an effort marker before a trailing unstamped assistant prefill", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          messages: [
            Message.user("Before."),
            Message.assistant("First.", { effort: "high" }),
            Message.user("After."),
            Message.assistant("Summary:"),
          ],
          providerOptions: { effort: "low" },
          cache: "none",
        }),
      )

      expect(prepared.body.output_config).toEqual({ effort: "high" })
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Before." }] },
        { role: "assistant", content: [{ type: "text", text: "First." }] },
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "user", content: [{ type: "text", text: "After." }] },
        { role: "assistant", content: [{ type: "text", text: "Summary:" }] },
      ])
    }),
  )

  it.effect("requests the mid-conversation output config beta only when markers are sent", () =>
    Effect.gen(function* () {
      for (const [model, expected] of [
        [opus5, true],
        [anthropic("claude-sonnet-5"), false],
      ] as const) {
        const request = ai.request({
          model,
          messages: conversation,
          providerOptions: { effort: "low" },
          http: { headers: { "anthropic-beta": "existing-beta" } },
        })
        const compiled = yield* compileRequest(request)
        const prepared = yield* AnthropicMessages.route.prepareTransport(compiled.body, request)
        const betas = prepared.request.headers["anthropic-beta"]!.split(",")
        expect(betas).toContain("existing-beta")
        expect(betas.includes("mid-conversation-output-config-2026-07-01")).toBe(expected)
      }
    }),
  )

  it.effect("places a mid-tool-loop effort switch after the tool result", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          messages: [
            Message.user("Weather?"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })], { effort: "high" }),
            Message.tool({ id: "call_1", name: "lookup", result: { temp: 72 } }),
          ],
          providerOptions: { effort: "low" },
          cache: "none",
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Weather?" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "lookup", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"temp":72}' }] },
        { role: "system", content: [], output_config: { effort: "low" } },
      ])
    }),
  )

  it.effect("releases a held system update after the user turn while keeping the effort marker before it", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: opus5,
          messages: [
            Message.user("Fix it."),
            Message.assistant("Done.", { effort: "high" }),
            Message.system("Update."),
            Message.user("Next."),
          ],
          providerOptions: { effort: "low" },
          cache: "none",
        }),
      )

      expect(prepared.body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Fix it." }] },
        { role: "assistant", content: [{ type: "text", text: "Done." }] },
        { role: "system", content: [], output_config: { effort: "low" } },
        { role: "user", content: [{ type: "text", text: "Next." }] },
        { role: "system", content: [{ type: "text", text: "Update.", cache_control: undefined }] },
      ])
    }),
  )

  for (const [id, supported] of [
    ["claude-opus-5", true],
    ["claude-opus-5-20260901", true],
    ["anthropic/claude-opus-5", true],
    ["claude-fable-5-1", true],
    ["claude-mythos-5-1", true],
    ["claude-opus-5-5", true],
    ["claude-sonnet-5-5", true],
    ["anthropic/claude-sonnet-5-5", true],
    ["claude-sonnet-6", true],
    ["claude-haiku-6", true],
    ["claude-fable-5", false],
    ["claude-opus-4-8", false],
    ["claude-sonnet-5", false],
    ["claude-sonnet-5-20260801", false],
    ["kimi-k2.5", false],
  ] as const) {
    it.effect(`${supported ? "lowers" : "omits"} markers for ${id}`, () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          ai.request({ model: anthropic(id), messages: conversation, providerOptions: { effort: "low" } }),
        )

        expect(systemMessages(prepared.body)).toHaveLength(supported ? 1 : 0)
        expect(prepared.body.output_config).toEqual({ effort: supported ? "high" : "low" })
      }),
    )
  }

  it.effect("honors the compatibility override in both directions", () =>
    Effect.gen(function* () {
      const enabled = yield* compileRequest(
        ai.request({
          model: anthropic("claude-sonnet-5", { supportsEffortUpdates: true }),
          messages: conversation,
          providerOptions: { effort: "low" },
        }),
      )
      const disabled = yield* compileRequest(
        ai.request({
          model: anthropic("claude-opus-5", { supportsEffortUpdates: false }),
          messages: conversation,
          providerOptions: { effort: "low" },
        }),
      )

      expect(systemMessages(enabled.body)).toHaveLength(1)
      expect(systemMessages(disabled.body)).toHaveLength(0)
    }),
  )

  it.effect("uses top-level effort when thinking is disabled or between_tools", () =>
    Effect.gen(function* () {
      const sonnet = anthropic("claude-sonnet-5-5")
      const betweenTools = yield* compileRequest(
        ai.request({
          model: sonnet,
          messages: conversation,
          providerOptions: { thinking: { type: "between_tools" }, effort: "low" },
        }),
      )

      expect(systemMessages(betweenTools.body)).toHaveLength(0)
      expect(betweenTools.body.output_config).toEqual({ effort: "low" })
    }),
  )

  it.effect("omits markers for Opus 5.0 on Bedrock Mantle Messages while lowering Opus 5.5", () =>
    Effect.gen(function* () {
      const mantle = AmazonBedrockMantle.configure({ apiKey: "test", region: "us-east-1" })
      const opus50 = yield* compileRequest(
        ai.request({
          model: mantle.messages("anthropic.claude-opus-5"),
          messages: conversation,
          providerOptions: { effort: "low" },
        }),
      )
      const opus55 = yield* compileRequest(
        ai.request({
          model: mantle.messages("anthropic.claude-opus-5-5"),
          messages: conversation,
          providerOptions: { effort: "low" },
        }),
      )

      expect(systemMessages(opus50.body)).toHaveLength(0)
      expect(opus50.body.output_config).toEqual({ effort: "low" })
      expect(systemMessages(opus55.body)).toEqual([{ role: "system", content: [], output_config: { effort: "low" } }])
      expect(opus55.body.output_config).toEqual({ effort: "high" })
    }),
  )

  it.effect("lowers markers on the Vertex Anthropic route for models that support them", () =>
    Effect.gen(function* () {
      const vertex = GoogleVertexMessages.configure({ accessToken: "test", location: "global", project: "test" })
      const opus5 = yield* compileRequest(
        ai.request({
          model: vertex.model("claude-opus-5"),
          messages: conversation,
          providerOptions: { effort: "low" },
        }),
      )
      const opus48 = yield* compileRequest(
        ai.request({
          model: vertex.model("claude-opus-4-8"),
          messages: conversation,
          providerOptions: { effort: "low" },
        }),
      )

      expect(systemMessages(opus5.body)).toEqual([{ role: "system", content: [], output_config: { effort: "low" } }])
      expect(opus5.body.output_config).toEqual({ effort: "high" })
      expect(systemMessages(opus48.body)).toHaveLength(0)
      expect(opus48.body.output_config).toEqual({ effort: "low" })
    }),
  )
})

describe("OpenAI Responses effort updates", () => {
  it.effect("lowers switches to configuration_update items and freezes reasoning.effort", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({ model: astra, messages: conversation, providerOptions: { reasoningEffort: "low" } }),
      )

      expect(prepared.body.reasoning).toEqual({ effort: "high" })
      expect(prepared.body.input).toEqual([
        { type: "message", role: "user", content: [{ type: "input_text", text: "Before." }] },
        { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "First." }] },
        { type: "configuration_update", reasoning: { effort: "low" } },
        { type: "message", role: "user", content: [{ type: "input_text", text: "After." }] },
      ])
    }),
  )

  it.effect("coalesces consecutive updates when an intermediate assistant message emits no items", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          messages: [
            Message.user("Before."),
            Message.assistant("First.", { effort: "medium" }),
            Message.assistant([], { effort: "low" }),
            Message.user("After."),
          ],
          providerOptions: { reasoningEffort: "xhigh" },
        }),
      )

      expect(prepared.body.reasoning).toEqual({ effort: "medium" })
      expect(prepared.body.input).toEqual([
        { type: "message", role: "user", content: [{ type: "input_text", text: "Before." }] },
        { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "First." }] },
        { type: "configuration_update", reasoning: { effort: "xhigh" } },
        { type: "message", role: "user", content: [{ type: "input_text", text: "After." }] },
      ])
    }),
  )

  it.effect("preserves the frozen baseline and earlier updates after reverting or forking to an earlier turn", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          messages: [
            Message.user("One."),
            Message.assistant("First.", { effort: "high" }),
            Message.user("Two."),
            Message.assistant("Second.", { effort: "low" }),
            Message.user("Forked follow-up."),
          ],
          providerOptions: { reasoningEffort: "xhigh" },
        }),
      )

      expect(prepared.body.reasoning).toEqual({ effort: "high" })
      expect(updates(prepared.body)).toEqual([
        { type: "configuration_update", reasoning: { effort: "low" } },
        { type: "configuration_update", reasoning: { effort: "xhigh" } },
      ])
    }),
  )

  it.effect("omits reasoning.effort for the model default and sends `medium` for a switch back to it", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: astra,
          messages: [
            Message.user("One."),
            Message.assistant("First.", { effort: null }),
            Message.user("Two."),
            Message.assistant("Second.", { effort: "low" }),
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

  it.effect("omits updates when automatic context management or auto truncation is enabled", () =>
    Effect.gen(function* () {
      const withCompaction = yield* compileRequest(
        ai.request({
          model: astra,
          messages: conversation,
          providerOptions: { reasoningEffort: "low", contextManagement: [{ type: "compaction" }] },
        }),
      )
      const withTruncation = yield* compileRequest(
        ai.request({
          model: astra,
          messages: conversation,
          providerOptions: { reasoningEffort: "low", truncation: "auto" },
        }),
      )

      expect(updates(withCompaction.body)).toEqual([])
      expect(withCompaction.body.reasoning).toEqual({ effort: "low" })
      expect(withCompaction.body.context_management).toEqual([{ type: "compaction" }])
      expect(updates(withTruncation.body)).toEqual([])
      expect(withTruncation.body.reasoning).toEqual({ effort: "low" })
      expect(withTruncation.body.truncation).toBe("auto")
    }),
  )

  it.effect("omits updates when pro reasoning mode is selected", () =>
    Effect.gen(function* () {
      const fromOverlay = yield* compileRequest(
        ai.request({
          model: OpenAI.configure({ apiKey: "fixture", http: { body: { reasoning: { mode: "pro" } } } }).responses(
            "gpt-6-sol",
          ),
          messages: conversation,
          providerOptions: { reasoningEffort: "low" },
        }),
      )
      const fromOption = yield* compileRequest(
        ai.request({
          model: astra,
          messages: conversation,
          providerOptions: { reasoningEffort: "low", reasoningMode: "pro" },
        }),
      )

      expect(updates(fromOverlay.body)).toEqual([])
      expect(fromOverlay.body.reasoning).toEqual({ effort: "low" })
      expect(updates(fromOption.body)).toEqual([])
      expect(fromOption.body.reasoning).toEqual({ effort: "low", mode: "pro" })
    }),
  )

  for (const [id, supported] of [
    ["gpt-6-astra", true],
    ["openai/gpt-6-astra", true],
    ["gpt-6-sol", true],
    ["openai/gpt-6-sol", true],
    ["gpt-6-luna", true],
    ["openai/gpt-6-luna", true],
    ["gpt-6", true],
    ["gpt-6.1-sol", true],
    ["openai/gpt-6.1-sol", true],
    ["GPT-6.1-SOL", true],
    ["gpt-6-astra-2026-09-01", true],
    ["gpt-6-sol-pro", true],
    ["gpt-6-luna-pro", true],
    ["gpt-6-sol-fast", true],
    ["gpt-7", true],
    ["openai/gpt-7.2-new-family", true],
    ["gpt-10.1", true],
    ["gpt-5", false],
    ["gpt-5.6-sol", false],
    ["gpt-5.10", false],
    ["not-gpt-6-sol", false],
    ["gpt-6foo", false],
    ["gpt-6.x-sol", false],
    ["future-model", false],
  ] as const) {
    it.effect(`${supported ? "lowers" : "omits"} markers for ${id}`, () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          ai.request({ model: openai(id), messages: conversation, providerOptions: { reasoningEffort: "low" } }),
        )

        expect(updates(prepared.body)).toHaveLength(supported ? 1 : 0)
        expect(prepared.body.reasoning).toEqual({ effort: supported ? "high" : "low" })
      }),
    )
  }

  it.effect("honors the compatibility override in both directions", () =>
    Effect.gen(function* () {
      const enabled = yield* compileRequest(
        ai.request({
          model: openai("gpt-5.5", { supportsEffortUpdates: true }),
          messages: conversation,
          providerOptions: { reasoningEffort: "low" },
        }),
      )
      const disabled = yield* compileRequest(
        ai.request({
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
  const compactRequest = ai.request({
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
          { type: "message", role: "user", content: [{ type: "input_text", text: "Before." }] },
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "First." }],
          },
          { type: "configuration_update", reasoning: { effort: "low" } },
          { type: "message", role: "user", content: [{ type: "input_text", text: "After." }] },
          { type: "compaction_trigger" },
        ])
        return respond(sseEvents({ type: "response.completed", response: { id: "resp_1", output: [checkpoint] } }), {
          headers: { "content-type": "text/event-stream" },
        })
      }),
    ),
  ).effect("keeps configuration updates in the checkpoint body", () =>
    Effect.gen(function* () {
      const result = yield* ai.compact(compactRequest, { mechanism: "trigger" })
      expect(result.checkpoint.encrypted).toBe("opaque")
    }),
  )

  testEffect(
    dynamicResponse(({ request, text, respond }) =>
      Effect.sync(() => {
        expect(new URL(request.url).pathname).toEndWith("/responses/compact")
        expect(JSON.parse(text).input).toEqual([
          { type: "message", role: "user", content: [{ type: "input_text", text: "Before." }] },
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "First." }],
          },
          { type: "message", role: "user", content: [{ type: "input_text", text: "After." }] },
        ])
        return respond(JSON.stringify({ object: "response.compaction", output: [checkpoint] }))
      }),
    ),
  ).effect("omits configuration updates from the standalone compaction endpoint", () =>
    Effect.gen(function* () {
      const result = yield* ai.compact(compactRequest, { mechanism: "endpoint" })
      expect(result.replacement.map((message) => message.content[0]?.type)).toEqual(["compaction"])
    }),
  )
})
