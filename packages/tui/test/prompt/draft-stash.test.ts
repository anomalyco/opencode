import { describe, expect, test } from "bun:test"
import {
  failedDrafts,
  saveDraft,
  saveFailedDraft,
  takeDraft,
  takeFailedDraft,
} from "../../src/component/prompt/draft-stash"
import { emptyPrompt } from "../../src/prompt/history"

// The Prompt component stashes an unsent draft in onCleanup and takes it back
// in onMount across route remounts, keyed by sessionID or undefined for home.

function draft(text: string, cursor = text.length) {
  return { prompt: { ...emptyPrompt(), text }, cursor }
}

describe("prompt draft stash", () => {
  test("tab-keyed drafts stay on the tab they were written in", () => {
    const two = draft("notes for session two")
    saveDraft("ses_two", two)

    // Switching to another tab or home finds nothing.
    expect(takeDraft("ses_one")).toBeUndefined()
    expect(takeDraft("home")).toBeUndefined()

    // Returning to the original tab restores exactly its draft, once.
    expect(takeDraft("ses_two")).toBe(two)
    expect(takeDraft("ses_two")).toBeUndefined()
  })

  test("each tab keeps its own draft, including home", () => {
    const one = draft("DRAFT-ONE")
    const home = draft("draft on home")
    saveDraft("ses_one", one)
    saveDraft(undefined, home)

    expect(takeDraft(undefined)).toBe(home)
    expect(takeDraft("ses_one")).toBe(one)
  })

  test("a newer draft for the same slot replaces the older one", () => {
    saveDraft("ses_a", draft("first"))
    const second = draft("second")
    saveDraft("ses_a", second)
    expect(takeDraft("ses_a")).toBe(second)
  })

  test("failed drafts retain independent snapshots, metadata, and recovery order per tab", () => {
    const first = {
      prompt: {
        ...emptyPrompt(),
        text: "First",
        mode: "shell" as const,
        files: [{ uri: "file:///note.txt", name: "note.txt" }],
      },
      cursor: 2,
    }
    saveFailedDraft("ses_failed_one", first)
    saveFailedDraft("ses_failed_one", draft("Second"))
    saveFailedDraft("ses_failed_two", draft("Other tab"))
    first.prompt.text = "Changed"
    first.prompt.files[0].name = "changed.txt"

    expect(failedDrafts("ses_failed_one")).toHaveLength(2)
    expect(takeFailedDraft("ses_failed_one")).toEqual({
      prompt: {
        ...emptyPrompt(),
        text: "First",
        mode: "shell",
        files: [{ uri: "file:///note.txt", name: "note.txt" }],
      },
      cursor: 2,
    })
    expect(takeFailedDraft("ses_failed_one")).toEqual(draft("Second"))
    expect(failedDrafts("ses_failed_one")).toEqual([])
    expect(takeFailedDraft("ses_failed_one")).toBeUndefined()
    expect(takeFailedDraft("ses_failed_two")).toEqual(draft("Other tab"))
  })
})
