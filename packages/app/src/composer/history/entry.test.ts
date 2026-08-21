import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/composer/state"
import { clonePromptParts, prependHistoryEntry, promptLength, type PromptHistoryComment } from "./entry"
import { upgradeHistoryState } from "./store"

const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

const text = (value: string): Prompt => [{ type: "text", content: value, start: 0, end: value.length }]
const comment = (id: string, value = "note"): PromptHistoryComment => ({
  id,
  path: "src/a.ts",
  selection: { start: 2, end: 4 },
  comment: value,
  time: 1,
  origin: "review",
  preview: "const a = 1",
})

describe("Composer history", () => {
  test("prependHistoryEntry skips empty prompt and deduplicates consecutive entries", () => {
    const first = prependHistoryEntry([], DEFAULT_PROMPT)
    expect(first).toEqual([])

    const commentsOnly = prependHistoryEntry([], DEFAULT_PROMPT, [comment("c1")])
    expect(commentsOnly).toHaveLength(1)

    const withOne = prependHistoryEntry([], text("hello"))
    expect(withOne).toHaveLength(1)

    const deduped = prependHistoryEntry(withOne, text("hello"))
    expect(deduped).toBe(withOne)

    const dedupedComments = prependHistoryEntry(commentsOnly, DEFAULT_PROMPT, [comment("c1")])
    expect(dedupedComments).toBe(commentsOnly)
  })

  test("upgrades stored prompt arrays once at the persistence boundary", () => {
    expect(upgradeHistoryState({ entries: [text("stored")] })).toEqual({
      entries: [{ prompt: text("stored"), comments: [] }],
    })
  })

  test("helpers clone prompt and count text content length", () => {
    const original: Prompt = [
      { type: "text", content: "one", start: 0, end: 3 },
      {
        type: "file",
        path: "src/a.ts",
        content: "@src/a.ts",
        start: 3,
        end: 12,
        selection: { startLine: 1, startChar: 1, endLine: 2, endChar: 1 },
      },
      { type: "image", id: "1", filename: "img.png", mime: "image/png", blob: { id: "blob", url: "blob:test" } },
    ]
    const copy = clonePromptParts(original)
    expect(copy).not.toBe(original)
    expect(promptLength(copy)).toBe(12)
    if (copy[1]?.type !== "file") throw new Error("expected file")
    copy[1].selection!.startLine = 9
    if (original[1]?.type !== "file") throw new Error("expected file")
    expect(original[1].selection?.startLine).toBe(1)
  })
})
