import { describe, expect, test } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { ConvertToClaudeMessage } from "@opencode/core/plugin/provider/claude-agent/language-model/convert-to-claude-message"
import { Fingerprint } from "@opencode/core/plugin/provider/claude-agent/sync/fingerprint"
import { SyncDecision } from "@opencode/core/plugin/provider/claude-agent/sync/decide"

// The provider lifts instruction updates before session reconciliation, so editing an update
// that was already synced has to read back as a changed turn instead of a silent match.
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

describe("#62916 instruction update recovery regressions", () => {
  test("detects edits to a previously synchronized instruction", () => {
    const previous = lift([...past, update("B"), user("Current state?")])
    const saved = { claudeSessionID: "claude-a", history: Fingerprint.groups(previous) }
    const changed = lift([...past, update("C"), user("Current state?")])
    expect(SyncDecision.decide(changed, saved)).toEqual({ kind: "changed", start: 0 })
  })
})
