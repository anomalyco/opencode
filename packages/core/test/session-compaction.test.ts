import { expect, test } from "bun:test"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionCompactionTranscript } from "@opencode-ai/core/session/compaction-transcript"

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

const transcript = SessionCompactionTranscript.buildTranscriptCompaction({
  segments: [
    { type: "text", role: "user", text: "Fix the failing build" },
    {
      type: "tool",
      tool: "read",
      input: { path: "src/a.ts" },
      status: "completed",
      output: "200 lines of file content",
    },
    { type: "text", role: "assistant", text: "I will check the file." },
    { type: "reasoning", text: "The build fails because of a missing import" },
  ],
  previousSummary: "PRIOR",
})

test("transcript compaction keeps user and assistant text verbatim", () => {
  const prompt = transcript.prompt!
  expect(prompt).toContain("1. [tool] read(")
  expect(prompt).toContain("2. [thinking]")
  expect(prompt).toContain("→ result: 200 lines of file content")
  // The verbatim text is never sent through the model.
  expect(prompt).not.toContain("Fix the failing build")
  expect(prompt).not.toContain("I will check the file.")

  const text = transcript.assemble(
    SessionCompactionTranscript.parseSummaries("1. read src/a.ts — 200 lines\n2. build fails on missing import"),
  )
  expect(text).toContain("[User]: Fix the failing build")
  expect(text).toContain("[Assistant]: I will check the file.")
  expect(text).toContain("[tool]: read src/a.ts — 200 lines")
  expect(text).toContain("[thinking]: build fails on missing import")
  expect(text).toContain("[Earlier compaction]\nPRIOR")
  expect(text).not.toContain("200 lines of file content")
})

test("transcript compaction falls back to mechanical lines on unusable model output", () => {
  const text = transcript.assemble(
    SessionCompactionTranscript.parseSummaries("Sorry, I cannot produce numbered lines today."),
  )
  expect(text).toContain("[User]: Fix the failing build")
  expect(text).toContain("[tool]: read(")
  expect(text).toContain("200 lines of file content".slice(0, 120))
  expect(text).toContain("[thinking]: The build fails because of a missing import".slice(0, 120))
})

test("transcript compaction skips the model call when there is nothing to condense", () => {
  const onlyText = SessionCompactionTranscript.buildTranscriptCompaction({
    segments: [
      { type: "text", role: "user", text: "hello" },
      { type: "text", role: "assistant", text: "hi" },
    ],
  })
  expect(onlyText.prompt).toBeUndefined()
  const text = onlyText.assemble(new Map())
  expect(text).toContain("[User]: hello")
  expect(text).toContain("[Assistant]: hi")
})

test("parseSummaries caps lines and ignores unnumbered prose", () => {
  const parsed = SessionCompactionTranscript.parseSummaries(
    ["1. short line", `2. ${"x".repeat(600)}`, "garbage line without a number", "3. third"].join("\n"),
  )
  expect(parsed.get(1)).toBe("short line")
  expect((parsed.get(2) ?? "").length).toBeLessThanOrEqual(400)
  expect(parsed.get(3)).toBe("third")
  expect(parsed.size).toBe(3)
})
