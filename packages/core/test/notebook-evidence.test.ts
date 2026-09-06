import { describe, expect, test } from "bun:test"
import { nudgeFor, markCommitted, markExplore } from "@opencode-ai/core/notebook/evidence"

describe("NotebookEvidence nudge", () => {
  test("no nudge until the session explores, and only once per cooldown", () => {
    const id = "ses_nudge_1"
    expect(nudgeFor(id)).toBeUndefined()
    markExplore(id)
    expect(nudgeFor(id)).toContain("Save your learnings")
    expect(nudgeFor(id)).toBeUndefined() // cooldown suppress
  })

  test("a commit silences the nudge", () => {
    const id = "ses_nudge_2"
    markExplore(id)
    expect(nudgeFor(id)).toContain("Save your learnings")
    markCommitted(id)
    expect(nudgeFor(id)).toBeUndefined()
  })
})
