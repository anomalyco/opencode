import { describe, expect, test } from "bun:test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { ConvertClaudeStream } from "@opencode/core/claude-agent/language-model/convert-claude-stream"
import { ConvertToClaudeMessage } from "@opencode/core/claude-agent/language-model/convert-to-claude-message"
import { ClaudeSystemPrompt } from "@opencode/core/claude-agent/language-model/system-prompt"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { CatchUp } from "@opencode/core/claude-agent/sync/catch-up"
import { Recorder } from "../lib/recorder"

describe("Claude conversions", () => {
  test("a resumed turn keeps the whole newest user group and its attachments", () => {
    const blocks = CatchUp.content(
      [
        { role: "system", content: "Built-in agent instructions" },
        { role: "user", content: [{ type: "text", text: "Earlier question" }] },
        { role: "assistant", content: [{ type: "text", text: "Earlier reply" }] },
        { role: "user", content: [{ type: "text", text: "A plan-mode reminder" }] },
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect this image" },
            { type: "file", mediaType: "image/png", data: "AQID" },
          ],
        },
      ],
      3,
    )
    expect(blocks).toEqual([
      { type: "text", text: "A plan-mode reminder" },
      { type: "text", text: "Inspect this image" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
    ])
  })

  test("utility calls keep system instructions separate from conversation content and omit thinking", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "Summarize this conversation." },
      { role: "system", content: "Use one sentence." },
      { role: "user", content: [{ type: "text", text: "First question" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Private reasoning" },
          { type: "text", text: "First answer" },
        ],
      },
      { role: "user", content: [{ type: "text", text: "Follow-up" }] },
    ]
    expect(ClaudeSystemPrompt.utility(prompt)).toBe("Summarize this conversation.\n\nUse one sentence.")
    expect(ConvertToClaudeMessage.content(prompt)).toEqual([
      { type: "text", text: "<user>" },
      { type: "text", text: "First question" },
      { type: "text", text: "</user>" },
      { type: "text", text: "<assistant>" },
      { type: "text", text: "First answer" },
      { type: "text", text: "</assistant>" },
      { type: "text", text: "<user>" },
      { type: "text", text: "Follow-up" },
      { type: "text", text: "</user>" },
    ])
  })

  test("preserves byte/base64/URL image and PDF attachments", () => {
    const bytes = new Uint8Array([1, 2, 3])
    const blocks = ConvertToClaudeMessage.content([
      {
        role: "user",
        content: [
          { type: "text", text: "/compact @README.md are literal text" },
          { type: "file", mediaType: "image/png", data: bytes },
          { type: "file", mediaType: "application/pdf", data: "cGRm" },
          { type: "file", mediaType: "image/jpeg", data: new URL("https://example.com/photo.jpg") },
        ],
      },
    ])
    expect(blocks).toEqual([
      { type: "text", text: "/compact @README.md are literal text" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "cGRm" } },
      { type: "image", source: { type: "url", url: "https://example.com/photo.jpg" } },
    ])
  })

  test("emits a real error for a recorded failed turn", () => {
    const parts = convertTurn("text-cancel")
    expect(parts.some((part) => part.type === "text-delta")).toBe(true)
    expect(parts.at(-1)?.type).toBe("error")
    expect(parts.some((part) => part.type === "finish")).toBe(false)
  })
})

// The parts the first recorded turn becomes, up to and including its result
function convertTurn(name: string) {
  const convert = ConvertClaudeStream.make()
  const parts: LanguageModelV3StreamPart[] = []
  for (const line of Recorder.load(name)) {
    if (line.from !== "claude" || line.message.type === "control_response") continue
    parts.push(...convert(line.message as SDKMessage))
    if (line.message.type === "result") break
  }
  return parts
}
