import { describe, expect, test } from "bun:test"
import { Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { SessionRunnerSystemPrompt } from "@opencode-ai/core/session/runner/system-prompt"

const prompt = (id: string) =>
  SessionRunnerSystemPrompt.provider(Model.make({ id, provider: "test", route: OpenAIChat.route }))

describe("SessionRunnerSystemPrompt", () => {
  test("selects the legacy provider-family prompts from the model id", () => {
    expect(prompt("gpt-5")).toContain("You are OpenCode, You and the user share the same workspace")
    expect(prompt("gpt-4.1")).toContain("THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH")
    expect(prompt("o3")).toContain("THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH")
    expect(prompt("gpt-5-codex")).toContain("## Editing constraints")
    expect(prompt("gemini-2.5-pro")).toContain("# Core Mandates")
    expect(prompt("claude-sonnet-4")).toContain("# Professional objectivity")
    expect(prompt("kimi-k2")).toContain("# Prompt and Tool Use")
    expect(prompt("trinity")).toContain("what command should I run to list files")
    expect(prompt("llama-3.3")).toContain("You are opencode, an interactive CLI tool")
  })
})
