import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Stream } from "effect"
import { InvalidRequestReason, LLM, LLMError, LLMEvent, Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"

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

describe("compaction summary failure classification (#50187)", () => {
  test("recognizes context window overflow messages", () => {
    expect(SessionCompaction.isOverflowMessage("exceed_context_size_error: request exceeds the available context size"))
      .toBe(true)
    expect(SessionCompaction.isOverflowMessage("exceed_context_size_error")).toBe(true)
    expect(SessionCompaction.isOverflowMessage("prompt is too long")).toBe(true)
    expect(SessionCompaction.isOverflowMessage("Input exceeds the context window of this model")).toBe(true)
  })

  test("does not mistake unrelated failures for context overflow", () => {
    expect(SessionCompaction.isOverflowMessage("summary unavailable")).toBe(false)
    expect(SessionCompaction.isOverflowMessage("Provider request failed with HTTP 500")).toBe(false)
    expect(SessionCompaction.isOverflowMessage("Compaction summary reached the output token limit")).toBe(false)
  })

  const model = Model.make({
    id: "summary-test",
    provider: "test",
    route: OpenAIChat.route.with({ limits: { context: 128_000, output: 4_000 } }),
  })
  const sessionID = SessionSchema.ID.make("ses_compaction_test")

  const entry = (seq: number, text: string) => ({
    seq,
    message: SessionMessage.User.make({
      id: SessionMessage.ID.create(),
      type: "user",
      text,
      time: { created: DateTime.nowUnsafe() },
    }),
  })

  const harness = (stream: Stream.Stream<LLMEvent, LLMError>) => {
    const published: string[] = []
    const compaction = SessionCompaction.make({
      events: {
        publish: (definition: { readonly type: string }) => {
          published.push(definition.type)
          return Effect.void
        },
      } as unknown as EventV2.Interface,
      llm: { stream: () => stream },
      config: [],
    })
    const input = {
      sessionID,
      entries: [entry(1, `first ${"a".repeat(20_000)}`), entry(2, `second ${"b".repeat(20_000)}`)],
      model,
      request: LLM.request({ model, prompt: "trigger" }),
    }
    return { compaction, input, published }
  }

  const summaryEvents = (text: string): LLMEvent[] => [
    LLMEvent.textDelta({ id: "summary-0", text }),
    LLMEvent.stepFinish({ index: 0, reason: "stop" }),
    LLMEvent.finish({ reason: "stop" }),
  ]

  test("stores a completed summary", async () => {
    const { compaction, input, published } = harness(Stream.fromIterable(summaryEvents("## Objective\n- Done")))
    expect(await Effect.runPromise(compaction.compactAfterOverflow(input))).toBe(true)
    expect(published).toContain("session.next.compaction.ended")
  })

  test("fails without storing when the summary request exceeds the context window", async () => {
    const { compaction, input, published } = harness(
      Stream.fromIterable([
        LLMEvent.providerError({
          message: "exceed_context_size_error: request exceeds the available context size",
        }),
      ]),
    )
    expect(await Effect.runPromise(compaction.compactAfterOverflow(input))).toBe(false)
    expect(published).not.toContain("session.next.compaction.ended")
  })

  test("fails without storing on classified context overflow", async () => {
    const { compaction, input, published } = harness(
      Stream.fromIterable([LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" })]),
    )
    expect(await Effect.runPromise(compaction.compactAfterOverflow(input))).toBe(false)
    expect(published).not.toContain("session.next.compaction.ended")
  })

  test("fails without storing when the summary stream raises context overflow", async () => {
    const { compaction, input, published } = harness(
      Stream.fail(
        new LLMError({
          module: "test",
          method: "stream",
          reason: new InvalidRequestReason({
            message: "exceed_context_size_error: request exceeds the available context size",
            classification: "context-overflow",
          }),
        }),
      ),
    )
    expect(await Effect.runPromise(compaction.compactAfterOverflow(input))).toBe(false)
    expect(published).not.toContain("session.next.compaction.ended")
  })

  test("fails without storing a summary cut off by the output limit", async () => {
    const { compaction, input, published } = harness(
      Stream.fromIterable([
        LLMEvent.textDelta({ id: "summary-0", text: "## Objective\n- Partial" }),
        LLMEvent.stepFinish({ index: 0, reason: "length" }),
        LLMEvent.finish({ reason: "length" }),
      ]),
    )
    expect(await Effect.runPromise(compaction.compactAfterOverflow(input))).toBe(false)
    expect(published).not.toContain("session.next.compaction.ended")
  })
})
