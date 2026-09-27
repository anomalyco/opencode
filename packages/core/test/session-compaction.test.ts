import { expect, test } from "bun:test"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toStartWith(
    "Here is the conversation so far:\n\n<conversation>\nconversation history\n</conversation>",
  )
  expect(prompt.indexOf("</conversation>")).toBeLessThan(prompt.indexOf("Create a new anchored summary"))
  expect(prompt).toContain("conversation history in the <conversation> tags above")
  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction prompt gives update instructions for a prior summary", () => {
  const prompt = SessionCompaction.buildPrompt({
    context: ["new conversation"],
    previousSummary: "existing summary",
  })

  expect(prompt.indexOf("<conversation>")).toBeLessThan(prompt.indexOf("<prior-summary>"))
  expect(prompt.indexOf("</prior-summary>")).toBeLessThan(prompt.indexOf("The <prior-summary> summarizes"))
  expect(prompt).toContain(
    "Carry forward objectives, constraints, user directives, decisions, and parallel workstreams from the <prior-summary>",
  )
  expect(prompt).toContain('Move completed work from "Active" to "Completed".')
  expect(prompt).toContain('Update "Objective" and "Next Move" to reflect the current work state.')
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

// --- local-fix-14: compaction.model override -------------------------------------

import { describe, expect as expect2 } from "bun:test"
import { Effect, Stream } from "effect"
import { LLM } from "@opencode-ai/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV2 } from "@opencode-ai/core/session"
import { it } from "./lib/effect"

const catalogModel = (id: string, providerID: string) =>
  ModelV2.Info.make({
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.make(providerID),
    name: id,
    api: { id: ModelV2.ID.make(id), type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://override.example/v1" },
    capabilities: { tools: false, input: ["text"], output: ["text"] },
    request: { headers: {}, body: {} },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 1_000_000, output: 4096 },
  })

const userEntry = (text: string) => ({
  seq: 1,
  message: { id: "msg_test_1", sessionID: "ses_test_1", time: 0, type: "user" as const, text, files: [] },
})

describe("compaction model override (local-fix-14)", () => {
  it.effect("summarizes with the configured compaction.model instead of the session model", () =>
    Effect.gen(function* () {
      const captured: Array<{ id: string | undefined; provider: string | undefined }> = []
      const llm = {
        stream: (request: unknown) =>
          Stream.succeed([
            { type: "text-delta", id: "cb1", text: "## Objective\n- test summary" },
          ]).pipe(
            Stream.map(() => {
              captured.push({ id: (request as any).model?.id, provider: (request as any).model?.provider })
              return { type: "text-delta", id: "cb1", text: "## Objective\n- test summary" }
            }),
          ) as unknown as typeof LLM.stream,
      }
      const overrideModel = yield* SessionRunnerModel.fromCatalogModel(
        catalogModel("override-model", "override-provider"),
      )
      const compaction = (SessionCompaction as any).make({
        events: { publish: () => Effect.void },
        llm,
        config: [{ type: "document", info: { compaction: { model: "override-provider/override-model" } } }],
        models: { resolveRef: () => Effect.succeed(overrideModel) },
      })
      const sessionModel = yield* SessionRunnerModel.fromCatalogModel(
        catalogModel("session-model", "session-provider"),
      )
      const result = yield* (compaction as any).compactAfterOverflow({
        sessionID: "ses_test_1",
        entries: [userEntry("context fill ".repeat(4000))],
        model: sessionModel,
        request: { system: "", messages: [], tools: [] } as never,
      })
      expect2(result).toBe(true)
      expect2(captured.length).toBeGreaterThan(0)
      expect2(captured[0]).toEqual({ id: "override-model", provider: "override-provider" })
    }),
  )

  it.effect("falls back to the session model when no compaction.model is configured", () =>
    Effect.gen(function* () {
      const captured: Array<{ id: string | undefined; provider: string | undefined }> = []
      const llm = {
        stream: (request: unknown) =>
          Stream.succeed([{ type: "text-delta", id: "cb1", text: "## Objective\n- fallback" }]).pipe(
            Stream.map(() => {
              captured.push({ id: (request as any).model?.id, provider: (request as any).model?.provider })
              return { type: "text-delta", id: "cb1", text: "## Objective\n- fallback" }
            }),
          ) as unknown as typeof LLM.stream,
      }
      const sessionModel = yield* SessionRunnerModel.fromCatalogModel(
        catalogModel("session-model", "session-provider"),
      )
      const compaction = (SessionCompaction as any).make({
        events: { publish: () => Effect.void },
        llm,
        config: [{ type: "document", info: {} }],
      })
      const result = yield* (compaction as any).compactAfterOverflow({
        sessionID: "ses_test_1",
        entries: [userEntry("context fill ".repeat(4000))],
        model: sessionModel,
        request: { system: "", messages: [], tools: [] } as never,
      })
      expect2(result).toBe(true)
      expect2(captured[0]).toEqual({ id: "session-model", provider: "session-provider" })
    }),
  )
})
