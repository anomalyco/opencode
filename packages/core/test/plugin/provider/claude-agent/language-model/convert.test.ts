import { describe, expect, test } from "bun:test"
import { ConvertClaudeStream } from "@opencode/core/plugin/provider/claude-agent/language-model/convert-claude-stream"
import { ConvertToClaudeMessage } from "@opencode/core/plugin/provider/claude-agent/language-model/convert-to-claude-message"
import { ClaudeSystemPrompt } from "@opencode/core/plugin/provider/claude-agent/language-model/system-prompt"
import type { LanguageModelV3FunctionTool, LanguageModelV3Prompt, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { Recorder } from "../lib/recorder"
import { TestTools } from "../lib/tools"

// The recorded first reply calls lookup twice.
function firstToolReply(tools: readonly LanguageModelV3FunctionTool[]) {
  const convert = ConvertClaudeStream.make(tools)
  const parts: LanguageModelV3StreamPart[] = []
  for (const line of Recorder.load("tools")) {
    if (line.from !== "claude" || line.message.type === "control_response") continue
    parts.push(...convert(line.message as SDKMessage))
    if (line.message.type === "stream_event" && line.message.event.type === "message_stop") break
  }
  return parts
}

describe("Claude conversions", () => {
  test("calls to tools we did not offer are left to Claude Code and do not end the step", () => {
    const offered = firstToolReply(TestTools.tools)
    expect(offered.filter((part) => part.type === "tool-call")).toHaveLength(2)
    expect(offered.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "tool-calls" } })
    const unknown = firstToolReply(TestTools.tools.filter((tool) => tool.name !== "lookup"))
    expect(unknown.some((part) => part.type === "tool-call" || part.type === "finish")).toBe(false)
  })

  test("a step's finish carries the plan usage Claude Code reported during it", () => {
    const recorded = Recorder.load("tools").find(
      (line) => line.from === "claude" && line.message.type === "rate_limit_event",
    )
    if (recorded?.from !== "claude" || recorded.message.type !== "rate_limit_event")
      throw new Error("Expected a recorded rate limit event")
    expect(firstToolReply(TestTools.tools).at(-1)).toMatchObject({
      type: "finish",
      providerMetadata: { "claude-agent": { rateLimit: recorded.message.rate_limit_info } },
    })
    expect(ConvertClaudeStream.make([])(Recorder.result("text")).at(-1)).toMatchObject({
      type: "finish",
      providerMetadata: undefined,
    })
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

  test("lifts an instruction update appended mid-conversation to user content and keeps the system prompt", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "Base prompt" },
      { role: "system", content: "Initial instructions" },
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      { role: "system", content: "The value is now B." },
      { role: "user", content: [{ type: "text", text: "What is the value?" }] },
    ]
    const lifted = ConvertToClaudeMessage.liftInstructionUpdates(prompt)
    const update = "<system-reminder>\nThe value is now B.\n</system-reminder>"
    // Leading system messages are the prompt and stay put; the later one becomes a tagged user turn.
    expect(lifted).toEqual([
      { role: "system", content: "Base prompt" },
      { role: "system", content: "Initial instructions" },
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      { role: "user", content: [{ type: "text", text: update }] },
      { role: "user", content: [{ type: "text", text: "What is the value?" }] },
    ])
    // The update rides into the conversation, and the system prompt never sees it.
    expect(ClaudeSystemPrompt.utility(lifted)).toBe("Base prompt\n\nInitial instructions")
    const blocks = ConvertToClaudeMessage.content(lifted)
    expect(blocks).toContainEqual({ type: "text", text: update })
    expect(blocks).not.toContainEqual({ type: "text", text: "Base prompt" })
  })

  test("leaves a prompt without instruction updates unchanged", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "Only prompt" },
      { role: "user", content: [{ type: "text", text: "Question" }] },
    ]
    expect(ConvertToClaudeMessage.liftInstructionUpdates(prompt)).toEqual(prompt)
  })

  test("lifts several consecutive instruction updates and keeps the leading system prompt", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "Base prompt" },
      { role: "system", content: "Initial instructions" },
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      { role: "system", content: "The value is now B." },
      { role: "system", content: "Keep answers terse." },
      { role: "user", content: [{ type: "text", text: "What is the value?" }] },
    ]
    const lifted = ConvertToClaudeMessage.liftInstructionUpdates(prompt)
    const first = "<system-reminder>\nThe value is now B.\n</system-reminder>"
    const second = "<system-reminder>\nKeep answers terse.\n</system-reminder>"
    // The two leading system messages are the prompt and stay put; each later one becomes its own user turn.
    expect(lifted.slice(0, 2)).toEqual([
      { role: "system", content: "Base prompt" },
      { role: "system", content: "Initial instructions" },
    ])
    expect(lifted[4]).toEqual({ role: "user", content: [{ type: "text", text: first }] })
    expect(lifted[5]).toEqual({ role: "user", content: [{ type: "text", text: second }] })
    // Neither update leaks into the utility system prompt.
    expect(ClaudeSystemPrompt.utility(lifted)).toBe("Base prompt\n\nInitial instructions")
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
})
