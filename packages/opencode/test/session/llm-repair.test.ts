import { expect } from "bun:test"
import type { JSONSchema7, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { jsonSchema, tool } from "ai"
import { MockLanguageModelV3 } from "ai/test"
import { Effect, Schema, Stream } from "effect"
import z from "zod"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Parameters } from "@/tool/invalid"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"

for (const item of [
  { label: "missing name", name: undefined, input: { filePath: "README.md" }, expected: "unknown" },
  { label: "empty name", name: "", input: { filePath: "README.md" }, expected: "unknown" },
  { label: "case mismatch", name: "READ", input: { filePath: "README.md" }, expected: "read" },
  { label: "unknown name", name: "not_available", input: { filePath: "README.md" }, expected: "not_available" },
  { label: "invalid arguments", name: "read", input: {}, expected: "read" },
]) {
  const language = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          // The missing name deliberately exercises malformed external model output.
          controller.enqueue({
            type: "tool-call",
            toolCallId: "call_repair",
            toolName: item.name,
            input: JSON.stringify(item.input),
          } as LanguageModelV3StreamPart)
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          })
          controller.close()
        },
      }),
      warnings: [],
    }),
  })
  const provider = ProviderTest.fake({ getLanguage: () => Effect.succeed(language) })
  const it = testEffect(
    AppNodeBuilder.build(LLM.node, [
      [Provider.node, provider.layer],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalNativeLlm: false })],
    ]),
  )

  it.instance(`repairs tool calls with ${item.label} through the session stream`, () =>
    Effect.gen(function* () {
      const llm = yield* LLM.Service
      const calls: Schema.Schema.Type<typeof Parameters>[] = []
      const reads: { filePath: string }[] = []
      const sessionID = SessionID.make("session-repair")
      const events = yield* llm
        .stream({
          sessionID,
          user: {
            id: MessageID.make("msg_user-repair"),
            sessionID,
            role: "user",
            time: { created: 0 },
            agent: "build",
            model: { providerID: provider.model.providerID, modelID: provider.model.id },
          },
          model: provider.model,
          agent: { name: "build", mode: "primary", options: {}, permission: [] },
          system: [],
          messages: [{ role: "user", content: "Read README.md" }],
          tools: {
            invalid: tool({
              inputSchema: jsonSchema<Schema.Schema.Type<typeof Parameters>>(
                Schema.toJsonSchemaDocument(Parameters).schema as JSONSchema7,
                {
                  validate: (value) =>
                    Schema.is(Parameters)(value)
                      ? { success: true, value }
                      : { success: false, error: new Error("Invalid tool input") },
                },
              ),
              execute: async (input) => {
                calls.push(input)
                return { title: "Invalid Tool", output: input.error, metadata: {} }
              },
            }),
            read: tool({
              inputSchema: z.object({ filePath: z.string() }),
              execute: async (input) => {
                reads.push(input)
                return { title: "Read", output: "repository contents", metadata: {} }
              },
            }),
          },
        })
        .pipe(Stream.runCollect)

      expect(events.some((event) => event.type === "tool-result")).toBe(true)
      if (item.label === "case mismatch") {
        expect(reads).toHaveLength(1)
        expect(reads[0]?.filePath).toBe("README.md")
        expect(calls).toEqual([])
        return
      }
      expect(reads).toEqual([])
      expect(calls).toHaveLength(1)
      expect(calls[0]?.tool).toBe(item.expected)
      if (!item.name) {
        expect(calls[0]?.error).toContain("tool name")
        expect(calls[0]?.error.length).toBeLessThan(200)
      }
      if (item.label === "invalid arguments") expect(calls[0]?.error).toContain("filePath")
    }),
  )
}
