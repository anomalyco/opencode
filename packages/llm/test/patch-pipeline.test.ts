import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM } from "../src"
import { Patch } from "../src/patch"
import { PatchPipeline } from "../src/patch-pipeline"
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

describe("llm patch pipeline", () => {
  test("patches request, prompt, and tool-schema phases in order", () => {
    const result = Effect.runSync(
      PatchPipeline.make([
        Patch.request("test.id", {
          reason: "rewrite request id",
          apply: (request) => LLM.updateRequest(request, { id: "req_patched" }),
        }),
        Patch.prompt("test.message", {
          reason: "rewrite prompt text",
          apply: mapText(() => "patched"),
        }),
        Patch.toolSchema("test.description", {
          reason: "rewrite tool description",
          apply: (tool) => updateToolDefinition(tool, { description: "patched tool" }),
        }),
      ]).patchRequest(
        LLM.updateRequest(request, {
          tools: [{ name: "lookup", description: "original", inputSchema: {} }],
        }),
      ),
    )

    expect(result.request.id).toBe("req_patched")
    expect(result.request.messages[0]?.content).toEqual([{ type: "text", text: "patched" }])
    expect(result.request.tools[0]?.description).toBe("patched tool")
  })

  test("prompt predicates see request patches", () => {
    const result = Effect.runSync(
      PatchPipeline.make([
        Patch.request("mark-request", {
          reason: "mark request before prompt phase",
          apply: (request) => LLM.updateRequest(request, { metadata: { ...request.metadata, promptPatchEnabled: true } }),
        }),
        Patch.prompt("rewrite-only-when-marked", {
          reason: "rewrite prompt text only after request marker",
          when: (ctx) => ctx.request.metadata?.promptPatchEnabled === true,
          apply: mapText((text) => `rewrote-${text}`),
        }),
      ]).patchRequest(request),
    )

    expect(result.request.messages[0]?.content).toEqual([{ type: "text", text: "rewrote-hello" }])
  })

  test("rejects request-shaped patches that change model routing", () => {
    const changedRoutes = [
      { provider: "other-provider" },
      { id: "other-model" },
      { protocol: "gemini" },
    ] satisfies ReadonlyArray<Partial<LLM.ModelInput>>

    for (const patch of changedRoutes) {
      const error = Effect.runSync(
        PatchPipeline.make([
          Patch.request("route", {
            reason: "attempt to rewrite route",
            apply: (request) => LLM.updateRequest(request, { model: updateModel(request.model, patch) }),
          }),
        ]).patchRequest(request).pipe(Effect.flip),
      )

      expect(error.message).toContain("Patches cannot change model routing")
    }
  })

  test("skips tool-schema patches when there are no tools", () => {
    const result = Effect.runSync(
      PatchPipeline.make([
        Patch.toolSchema("test.description", {
          reason: "rewrite tool description",
          apply: (tool) => updateToolDefinition(tool, { description: "patched tool" }),
        }),
      ]).patchRequest(request),
    )

    expect(result.request.tools).toEqual([])
  })

  test("applies tool-schema patches to every tool", () => {
    const result = Effect.runSync(
      PatchPipeline.make([
        Patch.toolSchema("test.description", {
          reason: "rewrite tool description",
          apply: (tool) => updateToolDefinition(tool, { description: `patched ${tool.name}` }),
        }),
      ]).patchRequest(
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

  test("patches payloads before validation", () => {
    const pipeline = PatchPipeline.make([
      Patch.payload("client", {
        reason: "client payload patch",
        order: 2,
        apply: (payload: { readonly value: string }) => ({ value: `${payload.value}|client` }),
      }),
    ])
    const state = Effect.runSync(pipeline.patchRequest(request))
    const result = Effect.runSync(
      pipeline.patchPayload({
        state,
        payload: { value: "start" },
        adapterPatches: [
          Patch.payload("adapter", {
            reason: "adapter payload patch",
            order: 1,
            apply: (payload: { readonly value: string }) => ({ value: `${payload.value}|adapter` }),
          }),
        ],
        schema: Schema.Struct({ value: Schema.Literal("start|adapter|client") }),
      }),
    )

    expect(result.payload).toEqual({ value: "start|adapter|client" })
  })

  test("patches stream events with the compiled request context", () => {
    const pipeline = PatchPipeline.make([
      Patch.request("mark-request", {
        reason: "mark request before stream phase",
        apply: (request) => LLM.updateRequest(request, { metadata: { ...request.metadata, streamPatchEnabled: true } }),
      }),
      Patch.stream("uppercase", {
        reason: "uppercase when compiled request is marked",
        when: (ctx) => ctx.request.metadata?.streamPatchEnabled === true,
        apply: (event) => (event.type === "text-delta" ? { ...event, text: event.text.toUpperCase() } : event),
      }),
    ])
    const patched = Effect.runSync(pipeline.patchRequest(request))
    const events = Effect.runSync(
      pipeline.patchStreamEvents({
        request: patched.request,
        events: Stream.fromIterable([{ type: "text-delta", text: "hello" }]),
      }).pipe(Stream.runCollect),
    )

    expect(Array.from(events)).toEqual([{ type: "text-delta", text: "HELLO" }])
  })

  test("accepts a prebuilt patch registry", () => {
    const result = Effect.runSync(
      PatchPipeline.make(Patch.registry([
        Patch.prompt("test.message", {
          reason: "rewrite prompt text",
          apply: mapText(() => "patched"),
        }),
      ])).patchRequest(request),
    )

    expect(result.request.messages[0]?.content).toEqual([{ type: "text", text: "patched" }])
  })
})
