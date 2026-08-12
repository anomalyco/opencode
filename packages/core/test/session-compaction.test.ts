import { expect, test } from "bun:test"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("assembleSummaryPrompt places the instruction after the conversation history", () => {
  const prompt = SessionCompaction.assembleSummaryPrompt({
    conversation: "[User]: older context\n\n[User]: a previous question?",
    instruction: "Create a new anchored summary from the conversation history.",
  })

  const historyAt = prompt.indexOf("[User]: a previous question?")
  const endAt = prompt.indexOf("End of conversation history.")
  const instructionAt = prompt.indexOf("Create a new anchored summary from the conversation history.")
  const guardAt = prompt.lastIndexOf(SessionCompaction.SUMMARY_GUARD)

  expect(historyAt).toBeGreaterThan(-1)
  expect(prompt).toContain("The following is the conversation history:")
  expect(instructionAt).toBeGreaterThan(historyAt)
  expect(instructionAt).toBeGreaterThan(endAt)
  expect(guardAt).toBeGreaterThan(instructionAt)
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
