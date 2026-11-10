import { describe, expect, test } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import type { ClaudeSessions } from "@opencode/core/plugin/provider/claude-agent/claude/sessions"
import { ClaudeAgentLanguageModel } from "@opencode/core/plugin/provider/claude-agent/language-model/claude-agent-language-model"
import { RequestKind } from "@opencode/core/plugin/provider/claude-agent/language-model/request-kind"

const reminder = "<system-reminder>\nrepro.state = B\n</system-reminder>"

const prompt = (): LanguageModelV3Prompt => [
  { role: "system", content: "Base instruction" },
  { role: "system", content: "Initial policy" },
  { role: "user", content: [{ type: "text", text: "First question" }] },
  { role: "assistant", content: [{ type: "text", text: "First answer" }] },
  { role: "system", content: "repro.state = B" },
  { role: "user", content: [{ type: "text", text: "What is the current state?" }] },
]

async function capture(input: { prompt: LanguageModelV3Prompt; headers?: Record<string, string> }) {
  const calls: ClaudeSessions.Request[] = []
  const model = new ClaudeAgentLanguageModel.Model("claude-test", {
    run: async (request) => {
      calls.push(request)
    },
  })
  const { stream } = await model.doStream(input)
  const reader = stream.getReader()
  while (!(await reader.read()).done) {
    // Drain the stubbed stream so the asynchronous session call finishes.
  }
  expect(calls).toHaveLength(1)
  return calls[0]!
}

describe("Claude Agent provider instruction updates", () => {
  test("primary requests deliver the update to the session without changing the base system prompt", async () => {
    const raw = prompt()
    const original = JSON.stringify(raw)
    const request = await capture({
      prompt: raw,
      headers: {
        [RequestKind.HEADER]: "primary",
        [RequestKind.SESSION_HEADER]: "existing-session",
      },
    })

    expect(request.sessionID).toBe("existing-session")
    expect(request.system).toMatchObject({ type: "preset", preset: "claude_code" })
    expect(JSON.stringify(request.system)).not.toContain("repro.state = B")
    expect(request.prompt.slice(0, 2)).toEqual(raw.slice(0, 2))
    expect(request.prompt[4]).toEqual({ role: "user", content: [{ type: "text", text: reminder }] })
    expect(request.prompt[5]).toEqual(raw[5])
    expect(JSON.stringify(raw)).toBe(original)
  })

  test("utility requests use only leading system messages and deliver the update once in the prompt", async () => {
    const request = await capture({ prompt: prompt() })

    expect(request.system).toBe("Base instruction\n\nInitial policy")
    expect(request.prompt[4]).toEqual({ role: "user", content: [{ type: "text", text: reminder }] })
    expect(request.prompt.filter((message) => message.role === "system")).toHaveLength(2)
    expect(JSON.stringify(request.prompt).match(/repro\.state = B/g)).toHaveLength(1)
    expect(request.sessionID).toBeUndefined()
  })
})
