import { describe, expect, test } from "bun:test"
import { saveDraft, takeDraft } from "../../src/component/prompt/draft-stash"
import { emptyPrompt } from "../../src/prompt/history"

// The Prompt component stashes an unsent draft in onCleanup and takes it back
// in onMount across route remounts. The key it uses is undefined by default
// (one global slot that follows focus across tabs) and the tab identity
// (sessionID, or "home") when the tab_drafts experiment is on.

function draft(text: string, cursor = text.length) {
  return { prompt: { ...emptyPrompt(), text }, cursor }
}

describe("prompt draft stash", () => {
  test("global slot follows focus: any tab takes the last stashed draft", () => {
    const entry = draft("follow me")
    saveDraft(undefined, entry)
    expect(takeDraft(undefined)).toBe(entry)
    // Consumed on take, so a remount never restores a stale copy.
    expect(takeDraft(undefined)).toBeUndefined()
  })

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
    saveDraft("home", home)

    expect(takeDraft("home")).toBe(home)
    expect(takeDraft("ses_one")).toBe(one)
  })

  test("global and tab slots never leak into each other when the experiment toggles mid-draft", () => {
    const global = draft("stashed before enabling tab_drafts")
    const keyed = draft("stashed after enabling tab_drafts")
    saveDraft(undefined, global)
    saveDraft("ses_a", keyed)

    // A keyed lookup must not surface the global draft on the wrong tab...
    expect(takeDraft("ses_b")).toBeUndefined()
    // ...and the global slot must not surface a tab's draft.
    expect(takeDraft(undefined)).toBe(global)
    expect(takeDraft("ses_a")).toBe(keyed)
  })

  test("a newer draft for the same slot replaces the older one", () => {
    saveDraft("ses_a", draft("first"))
    const second = draft("second")
    saveDraft("ses_a", second)
    expect(takeDraft("ses_a")).toBe(second)
  })
})
