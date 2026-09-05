import { describe, expect, test } from "bun:test"
import { clearDraft, saveDraft, takeDraft } from "../../src/component/prompt/draft-stash"
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

  test("late acknowledgement clears only an unchanged automatically restored draft", () => {
    const restored = draft("retry me")
    saveDraft("ses_retry", restored)
    expect(clearDraft("ses_retry", restored.prompt)).toBe(true)
    expect(takeDraft("ses_retry")).toBeUndefined()

    const edited = draft("retry me with edits")
    saveDraft("ses_retry", edited)
    expect(clearDraft("ses_retry", restored.prompt)).toBe(false)
    expect(takeDraft("ses_retry")).toBe(edited)
  })
})
