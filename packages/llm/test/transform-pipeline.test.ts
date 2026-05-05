import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM } from "../src"
import { Transform } from "../src/transform"
import { TransformPipeline } from "../src/transform-pipeline"
import type { LLMRequest, ModelRef, ToolDefinition } from "../src/schema"

const request = LLM.request({
  id: "req_1",
  model: LLM.model({ id: "fake-model", provider: "fake-provider", protocol: "openai-chat" }),
  prompt: "hello",
})

const updateModel = (model: ModelRef, patch: Partial<LLM.ModelInput>) =>
  LLM.model({
    ...model,
    ...patch,
  })

const mapText = (fn: (text: string) => string) => (request: LLMRequest): LLMRequest =>
  LLM.updateRequest(request, {
    messages: request.messages.map((message) =>
      LLM.message({
        id: message.id,
        role: message.role,
        metadata: message.metadata,
        native: message.native,
        content: message.content.map((part) => (part.type === "text" ? { ...part, text: fn(part.text) } : part)),
      }),
    ),
  })

const updateToolDefinition = (tool: ToolDefinition, patch: Partial<ToolDefinition>) =>
  LLM.toolDefinition({
    ...tool,
    ...patch,
  })

describe("llm transform pipeline", () => {
  test("transforms request, prompt, and tool-schema phases in order", () => {
    const result = Effect.runSync(
      TransformPipeline.make([
        Transform.request("test.id", {
          reason: "rewrite request id",
          apply: (request) => LLM.updateRequest(request, { id: "req_patched" }),
        }),
        Transform.prompt("test.message", {
          reason: "rewrite prompt text",
          apply: mapText(() => "patched"),
        }),
        Transform.toolSchema("test.description", {
          reason: "rewrite tool description",
          apply: (tool) => updateToolDefinition(tool, { description: "patched tool" }),
        }),
      ]).transformRequest(
        LLM.updateRequest(request, {
          tools: [{ name: "lookup", description: "original", inputSchema: {} }],
        }),
      ),
    )

    expect(result.request.id).toBe("req_patched")
    expect(result.request.messages[0]?.content).toEqual([{ type: "text", text: "patched" }])
    expect(result.request.tools[0]?.description).toBe("patched tool")
  })

  test("prompt predicates see request transforms", () => {
    const result = Effect.runSync(
      TransformPipeline.make([
        Transform.request("mark-request", {
          reason: "mark request before prompt phase",
          apply: (request) => LLM.updateRequest(request, { metadata: { ...request.metadata, promptPatchEnabled: true } }),
        }),
        Transform.prompt("rewrite-only-when-marked", {
          reason: "rewrite prompt text only after request marker",
          when: (ctx) => ctx.request.metadata?.promptPatchEnabled === true,
          apply: mapText((text) => `rewrote-${text}`),
        }),
      ]).transformRequest(request),
    )

    expect(result.request.messages[0]?.content).toEqual([{ type: "text", text: "rewrote-hello" }])
  })

  test("rejects request-shaped transforms that change model routing", () => {
    const changedRoutes = [
      { provider: "other-provider" },
      { id: "other-model" },
      { protocol: "gemini" },
    ] satisfies ReadonlyArray<Partial<LLM.ModelInput>>

    for (const patch of changedRoutes) {
      const error = Effect.runSync(
        TransformPipeline.make([
          Transform.request("route", {
            reason: "attempt to rewrite route",
            apply: (request) => LLM.updateRequest(request, { model: updateModel(request.model, patch) }),
          }),
        ]).transformRequest(request).pipe(Effect.flip),
      )

      expect(error.message).toContain("Transforms cannot change model routing")
    }
  })

  test("skips tool-schema transforms when there are no tools", () => {
    const result = Effect.runSync(
      TransformPipeline.make([
        Transform.toolSchema("test.description", {
          reason: "rewrite tool description",
          apply: (tool) => updateToolDefinition(tool, { description: "patched tool" }),
        }),
      ]).transformRequest(request),
    )

    expect(result.request.tools).toEqual([])
  })

  test("applies tool-schema transforms to every tool", () => {
    const result = Effect.runSync(
      TransformPipeline.make([
        Transform.toolSchema("test.description", {
          reason: "rewrite tool description",
          apply: (tool) => updateToolDefinition(tool, { description: `patched ${tool.name}` }),
        }),
      ]).transformRequest(
        LLM.updateRequest(request, {
          tools: [
            { name: "first", description: "original", inputSchema: {} },
            { name: "second", description: "original", inputSchema: {} },
          ],
        }),
      ),
    )

    expect(result.request.tools.map((tool) => tool.description)).toEqual(["patched first", "patched second"])
  })

  test("adapter-local payload transforms run before validation", () => {
    const pipeline = TransformPipeline.make()
    const state = Effect.runSync(pipeline.transformRequest(request))
    const result = Effect.runSync(
      pipeline.transformPayload({
        state,
        payload: { value: "start" },
        adapterTransforms: [
          Transform.payload("adapter", {
            reason: "adapter payload transform",
            order: 1,
            apply: (payload: { readonly value: string }) => ({ value: `${payload.value}|adapter` }),
          }),
        ],
        schema: Schema.Struct({ value: Schema.Literal("start|adapter") }),
      }),
    )

    expect(result.payload).toEqual({ value: "start|adapter" })
  })

  test("transforms stream events with the compiled request context", () => {
    const pipeline = TransformPipeline.make([
      Transform.request("mark-request", {
        reason: "mark request before stream phase",
        apply: (request) => LLM.updateRequest(request, { metadata: { ...request.metadata, streamPatchEnabled: true } }),
      }),
      Transform.stream("uppercase", {
        reason: "uppercase when compiled request is marked",
        when: (ctx) => ctx.request.metadata?.streamPatchEnabled === true,
        apply: (event) => (event.type === "text-delta" ? { ...event, text: event.text.toUpperCase() } : event),
      }),
    ])
    const transformed = Effect.runSync(pipeline.transformRequest(request))
    const events = Effect.runSync(
      pipeline.transformStreamEvents({
        request: transformed.request,
        events: Stream.fromIterable([{ type: "text-delta", text: "hello" }]),
      }).pipe(Stream.runCollect),
    )

    expect(Array.from(events)).toEqual([{ type: "text-delta", text: "HELLO" }])
  })

  test("accepts a prebuilt transform registry", () => {
    const result = Effect.runSync(
      TransformPipeline.make(Transform.registry([
        Transform.prompt("test.message", {
          reason: "rewrite prompt text",
          apply: mapText(() => "patched"),
        }),
      ])).transformRequest(request),
    )

    expect(result.request.messages[0]?.content).toEqual([{ type: "text", text: "patched" }])
  })
})
