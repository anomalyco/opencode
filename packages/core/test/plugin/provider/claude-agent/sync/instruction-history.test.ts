import { describe, expect, test } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { ConvertToClaudeMessage } from "@opencode/core/plugin/provider/claude-agent/language-model/convert-to-claude-message"
import { Fingerprint } from "@opencode/core/plugin/provider/claude-agent/sync/fingerprint"
import { SyncDecision } from "@opencode/core/plugin/provider/claude-agent/sync/decide"
import { CatchUp } from "@opencode/core/plugin/provider/claude-agent/sync/catch-up"
import { Checkpoints } from "@opencode/core/plugin/provider/claude-agent/sync/checkpoints"

// The provider lifts instruction updates before session reconciliation.
// Exercise recovery and checkpoint behavior using the normalized prompt.
const user = (text: string): LanguageModelV3Prompt[number] => ({ role: "user", content: [{ type: "text", text }] })
const assistant = (text: string): LanguageModelV3Prompt[number] => ({
  role: "assistant",
  content: [{ type: "text", text }],
})
const update = (value: string): LanguageModelV3Prompt[number] => ({
  role: "system",
  content: `Instructions updated: repro.state\nrepro.state = ${value}`,
})
const lift = (raw: LanguageModelV3Prompt) => ConvertToClaudeMessage.liftInstructionUpdates(raw)
const past: LanguageModelV3Prompt = [user("First marker"), assistant("COPPER-OTTER")]
const content = (prompt: LanguageModelV3Prompt, start = 0) =>
  CatchUp.content(prompt, start)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")

describe("#62916 instruction update recovery regressions", () => {
  test("detects edits to a previously synchronized instruction", () => {
    const previous = lift([...past, update("B"), user("Current state?")])
    const saved = { claudeSessionID: "claude-a", history: Fingerprint.groups(previous) }
    const changed = lift([...past, update("C"), user("Current state?")])
    expect(SyncDecision.decide(changed, saved)).toEqual({ kind: "changed", start: 0 })
  })

  test("recovers an update from legacy session history", () => {
    const question = user("What is the current state?")
    // The saved checkpoints predate the fix, so they omit the update entirely.
    const legacy = {
      claudeSessionID: "claude-legacy",
      history: Fingerprint.groups([...past, question]).map((group, index) => ({
        hash: group.hash,
        ...(index < 2 ? { claudeMessageID: `checkpoint-${index}` } : {}),
      })),
    }
    const prompt = lift([...past, update("B"), question])
    expect(SyncDecision.decide(prompt, legacy)).toEqual({ kind: "changed", start: 0 })
    const boundary = SyncDecision.boundary(prompt, legacy)
    expect(boundary?.messageID).toBe("checkpoint-1")
    expect(boundary?.start).toBe(2)
    expect(content(prompt, boundary!.start)).toContain("repro.state = B")
    expect(content(prompt, boundary!.start)).toContain("What is the current state?")
  })

  test("tracks an update after a reasoning-only assistant message", () => {
    const raw: LanguageModelV3Prompt = [
      { role: "system", content: "Initial instructions" },
      { role: "assistant", content: [{ type: "reasoning", text: "Private reasoning" }] },
      update("B"),
      user("Current state?"),
    ]
    const prompt = lift(raw)
    expect(content(prompt)).toContain("repro.state = B")
    expect(content(prompt)).not.toContain("Private reasoning")
    expect(Fingerprint.groups(prompt)[0]?.start).toBe(2)
  })

  test("preserves checkpoint IDs and resumes after the answered update", () => {
    const raw: LanguageModelV3Prompt = [...past, update("B"), user("Current state?")]
    const prompt = lift(raw)
    const previous = {
      claudeSessionID: "claude-a",
      history: Fingerprint.groups(past).map((group, index) => ({
        hash: group.hash,
        claudeMessageID: `previous-${index}`,
      })),
    }
    const history = Checkpoints.build({
      prompt,
      previous,
      userID: "current-user",
      reply: [{ type: "text", text: "State B" }],
      messageID: "reply-b",
      toolMessages: new Map(),
    })
    // The connector may group the update with the next user input.
    // Check the semantics of checkpoint IDs rather than the number of groups.
    expect(history[0]?.claudeMessageID).toBe("previous-0")
    expect(history[1]?.claudeMessageID).toBe("previous-1")
    expect(history.at(-2)?.claudeMessageID).toBe("current-user")
    expect(history.at(-1)?.claudeMessageID).toBe("reply-b")
    const next = lift([...raw, assistant("State B"), user("Next question")])
    expect(SyncDecision.decide(next, { claudeSessionID: "claude-a", history })).toEqual({
      kind: "continue",
      start: 5,
    })
  })
})
