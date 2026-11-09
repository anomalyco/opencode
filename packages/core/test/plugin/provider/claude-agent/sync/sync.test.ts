import { describe, expect, test } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { Fingerprint } from "@opencode/core/plugin/provider/claude-agent/sync/fingerprint"
import { SyncDecision } from "@opencode/core/plugin/provider/claude-agent/sync/decide"
import { CatchUp } from "@opencode/core/plugin/provider/claude-agent/sync/catch-up"

const user = (text: string): LanguageModelV3Prompt[number] => ({ role: "user", content: [{ type: "text", text }] })
const assistant = (text: string): LanguageModelV3Prompt[number] => ({
  role: "assistant",
  content: [{ type: "text", text }],
})
const past = [user("First marker"), assistant("COPPER-OTTER")]
const record = { claudeSessionID: "claude-a", history: Fingerprint.groups(past) }

describe("history reconciliation", () => {
  test("an interrupted reply continues after the submitted input without hiding earlier edits or missed turns", () => {
    const input = [...past, user("List animals")]
    const saved = { claudeSessionID: "claude-a", history: Fingerprint.groups(input), interrupted: true }
    expect(SyncDecision.decide([...input, assistant("1. Ot"), user("Stop")], saved)).toEqual({
      kind: "continue",
      start: 4,
    })
    // With no saved partial reply, the next user message must not merge into the submitted input.
    expect(SyncDecision.decide([...input, user("Stop")], saved)).toEqual({ kind: "continue", start: 3 })
    expect(
      SyncDecision.decide(
        [...input, assistant("1. Ot"), user("Other model"), assistant("New answer"), user("Back")],
        saved,
      ),
    ).toEqual({ kind: "catch-up", start: 4 })
    expect(SyncDecision.decide([past[0]!, assistant("Edited"), input[2]!, user("Stop")], saved).kind).toBe("changed")
  })

  test("branches only at a matching checkpoint, never midway through a group of tool calls", () => {
    const history: LanguageModelV3Prompt = [
      ...past,
      user("Read two files"),
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "a", toolName: "read", input: { path: "a" } },
          { type: "tool-call", toolCallId: "b", toolName: "read", input: { path: "b" } },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "a", toolName: "read", output: { type: "text", value: "A" } }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "b", toolName: "read", output: { type: "text", value: "B" } }],
      },
      assistant("Read both"),
    ]
    const saved = {
      claudeSessionID: "source",
      history: Fingerprint.groups(history).map((group, i) => ({ hash: group.hash, claudeMessageID: `uuid-${i}` })),
    }
    expect(SyncDecision.boundary(history.slice(0, 1), saved)).toBeUndefined()
    expect(SyncDecision.boundary(history.slice(0, 3), saved)?.messageID).toBe("uuid-1")
    expect(SyncDecision.boundary(history.slice(0, 4), saved)?.messageID).toBe("uuid-2")
    expect(SyncDecision.boundary(history.slice(0, 5), saved)?.messageID).toBe("uuid-2")
    expect(SyncDecision.boundary(history, saved)?.messageID).toBe("uuid-6")
    expect(SyncDecision.boundary([user("Edited source"), ...history.slice(1)], saved)).toBeUndefined()
    const noBoundary = { ...saved, history: saved.history.map((checkpoint) => ({ hash: checkpoint.hash })) }
    expect(SyncDecision.boundary(history, noBoundary)).toBeUndefined()
  })

  test("chooses all four cases and never resumes a record without history", () => {
    expect(SyncDecision.decide([...past, user("Next")], record)).toEqual({ kind: "continue", start: 2 })
    expect(SyncDecision.decide([...past, user("Other model"), assistant("LILAC-HERON"), user("Next")], record)).toEqual(
      { kind: "catch-up", start: 2 },
    )
    expect(SyncDecision.decide([past[0]!, assistant("Edited"), user("Next")], record)).toEqual({
      kind: "changed",
      start: 0,
    })
    expect(SyncDecision.decide([past[0]!, user("Undo")], record).kind).toBe("fresh")
    expect(SyncDecision.decide([past[0]!], record).kind).toBe("changed")
    expect(SyncDecision.decide([user("Compacted summary"), user("Next")], record).kind).toBe("fresh")
    expect(SyncDecision.decide([...past, user("Next")], { claudeSessionID: "old" }).kind).toBe("fresh")
  })

  test("ignores thinking, metadata and reordered user notes, but notices changed visible text", () => {
    const original: LanguageModelV3Prompt = [user("Plan reminder"), ...past]
    const changed: LanguageModelV3Prompt = [
      past[0]!,
      user("Plan reminder"),
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Private reasoning" },
          { type: "text", text: "COPPER-", providerOptions: { another: { signature: "opaque" } } },
          { type: "text", text: "OTTER" },
        ],
      },
    ]
    const hashes = (prompt: LanguageModelV3Prompt) => Fingerprint.groups(prompt).map((group) => group.hash)
    expect(hashes(changed)).toEqual(hashes(original))
    expect(hashes([user("Changed reminder"), ...past])).not.toEqual(hashes(original))
  })

  test("compares tool inputs independent of key order and keeps tool images with their result", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call-a", toolName: "read", input: { path: "image.png", offset: 1 } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-a",
            toolName: "read",
            output: { type: "text", value: "Image follows" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Attached media from tool result:" },
          { type: "file", mediaType: "image/png", data: new Uint8Array([1, 2]) },
        ],
      },
    ]
    const groups = Fingerprint.groups(prompt)
    expect(groups.map((group) => group.role)).toEqual(["assistant", "tool"])
    expect(groups[1]!.end).toBe(3)
    prompt[0] = {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "call-a", toolName: "read", input: { offset: 1, path: "image.png" } }],
    }
    prompt[2] = {
      role: "user",
      content: [
        { type: "text", text: "Attached media from tool result:" },
        { type: "file", mediaType: "image/png", data: "AQI=" },
      ],
    }
    expect(Fingerprint.groups(prompt)).toEqual(groups)
    prompt[1] = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-a",
          toolName: "read",
          output: { type: "text", value: "Edited output" },
        },
      ],
    }
    expect(Fingerprint.groups(prompt)[1]!.hash).not.toBe(groups[1]!.hash)
  })

  test("catch-up includes only missed turns and leaves the current request outside the checkpoint", () => {
    const prompt: LanguageModelV3Prompt = [
      ...past,
      user("Other model"),
      assistant("LILAC-HERON"),
      user("What happened?"),
    ]
    const blocks = CatchUp.content(prompt, 2)
    const text = JSON.stringify(blocks)
    expect(text).not.toContain("COPPER-OTTER")
    expect(text).toContain("LILAC-HERON")
    expect(blocks.at(-2)).toEqual({ type: "text", text: "</conversation-checkpoint>" })
    expect(blocks.at(-1)).toEqual({ type: "text", text: "What happened?" })
    expect(CatchUp.content(prompt, 4)).toEqual([{ type: "text", text: "What happened?" }])
  })

  test("catch-up preserves tool calls, results, images and PDFs, excluding reasoning", () => {
    const blocks = CatchUp.content([
      user("Read the files"),
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "PRIVATE" },
          { type: "tool-call", toolCallId: "a", toolName: "read", input: { path: "marker.txt" } },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "a",
            toolName: "read",
            output: { type: "text", value: "LEMON-IBIS\nSecond line" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Attached media from tool result:" },
          { type: "file", mediaType: "image/png", data: "AQI=" },
          { type: "file", mediaType: "application/pdf", data: "AwQ=" },
        ],
      },
      user("Continue"),
    ])
    expect(JSON.stringify(blocks)).toContain("marker.txt")
    expect(JSON.stringify(blocks)).toContain("LEMON-IBIS")
    expect(JSON.stringify(blocks)).not.toContain("PRIVATE")
    expect(blocks.some((block) => block.type === "image")).toBe(true)
    expect(blocks.some((block) => block.type === "document")).toBe(true)
    expect(blocks.at(-1)).toEqual({ type: "text", text: "Continue" })
  })
})
