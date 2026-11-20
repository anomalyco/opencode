import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/composer/state"
import { prependHistoryEntry, removeHistoryEntry, type PromptHistoryComment, type PromptHistoryEntry } from "./entry"

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

  test("removeHistoryEntry drops the entry recorded for a prompt and leaves others alone", () => {
    const image: Prompt = [
      { type: "text", content: "look", start: 0, end: 4 },
      { type: "image", id: "img", filename: "big.png", mime: "image/png", blob: { id: "hash", url: "" } },
    ]

    const entries = prependHistoryEntry(prependHistoryEntry([], text("earlier")), image, [comment("c1")])
    expect(entries).toHaveLength(2)

    const untouched = removeHistoryEntry(entries, text("never sent"))
    expect(untouched).toBe(entries)

    const withoutComments = removeHistoryEntry(entries, image)
    expect(withoutComments).toBe(entries)

    const removed = removeHistoryEntry(entries, image, [comment("c1")])
    expect(removed).toEqual(prependHistoryEntry([], text("earlier")))
  })

  test("prependHistoryEntry keeps 100 recent entries and up to 100 older attachment-free ones", () => {
    const attached = (index: number): Prompt => [
      ...text(`shot ${index}`),
      index % 2
        ? { type: "image", id: `img${index}`, filename: "a.png", mime: "image/png", blob: { id: `h${index}`, url: "" } }
        : { type: "path", id: `att${index}`, filename: "a.mp4", mime: "video/mp4", path: `/tmp/${index}.mp4` },
    ]

    const sent = Array.from({ length: 300 }, (_, index) => (index % 3 ? text(`prompt ${index}`) : attached(index)))
    const mixed = sent.reduce<PromptHistoryEntry[]>((entries, prompt) => prependHistoryEntry(entries, prompt), [])
    const newest = sent.toReversed()

    expect(mixed.slice(0, 100).map((entry) => entry.prompt)).toEqual(newest.slice(0, 100))
    expect(mixed.slice(100).map((entry) => entry.prompt)).toEqual(
      newest
        .slice(100)
        .filter((prompt) => prompt.length === 1)
        .slice(0, 100),
    )
  })

  test("insertion isolates canonical entries from source mutations", () => {
    const prompt: Prompt = [
      {
        type: "file",
        path: "src/a.ts",
        content: "@src/a.ts",
        start: 0,
        end: 9,
        selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 },
      },
    ]

    const comments = [comment("c1")]
    const entries = prependHistoryEntry([], prompt, comments)
    const stored = entries[0]

    if (prompt[0]?.type !== "file" || stored?.prompt[0]?.type !== "file") throw new Error("expected file")
    prompt[0].selection!.startLine = 9
    comments[0].selection.start = 9

    expect(stored.prompt[0].selection?.startLine).toBe(1)
    expect(stored.comments[0]?.selection.start).toBe(2)
  })
})
