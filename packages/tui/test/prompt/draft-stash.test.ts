import { Session } from "@opencode/schema/session"
import { describe, expect, test } from "bun:test"
import { saveDraft, takeDraft } from "../../src/component/prompt/draft-stash"
import { emptyPrompt } from "../../src/prompt/history"

// The Prompt component stashes an unsent draft in onCleanup and takes it back
// in onMount across route remounts, keyed by sessionID or undefined for home.

function draft(text: string, cursor = text.length) {
  return { prompt: { ...emptyPrompt(), text }, cursor }
}

describe("prompt draft stash", () => {
  test("tab-keyed drafts stay on the tab they were written in", () => {
    const two = draft("notes for session two")
    saveDraft(Session.ID.make("ses_two", { disableChecks: true }), two)

    // Switching to another tab or home finds nothing.
    expect(takeDraft(Session.ID.make("ses_one", { disableChecks: true }))).toBeUndefined()
    expect(takeDraft(Session.ID.make("home", { disableChecks: true }))).toBeUndefined()

    // Returning to the original tab restores exactly its draft, once.
    expect(takeDraft(Session.ID.make("ses_two", { disableChecks: true }))).toBe(two)
    expect(takeDraft(Session.ID.make("ses_two", { disableChecks: true }))).toBeUndefined()
  })

  test("each tab keeps its own draft, including home", () => {
    const one = draft("DRAFT-ONE")
    const home = draft("draft on home")
    saveDraft(Session.ID.make("ses_one", { disableChecks: true }), one)
    saveDraft(undefined, home)

    expect(takeDraft(undefined)).toBe(home)
    expect(takeDraft(Session.ID.make("ses_one", { disableChecks: true }))).toBe(one)
  })

  test("a newer draft for the same slot replaces the older one", () => {
    saveDraft(Session.ID.make("ses_a", { disableChecks: true }), draft("first"))
    const second = draft("second")
    saveDraft(Session.ID.make("ses_a", { disableChecks: true }), second)
    expect(takeDraft(Session.ID.make("ses_a", { disableChecks: true }))).toBe(second)
  })
})
