import { describe, expect, test } from "bun:test"
import { Session } from "@opencode-ai/schema/session"
import { createPromptSubmission } from "../../src/prompt/submission"

describe("prompt submission identity", () => {
  test("reuses identities while retrying the same submission", async () => {
    const submission = createPromptSubmission()
    const firstSession = await submission.begin(1n)
    const firstMessage = await submission.message()

    expect(await submission.begin(1n)).toBe(firstSession)
    expect(await submission.message()).toBe(firstMessage)
    expect(await submission.begin(2n)).not.toBe(firstSession)
    expect(await submission.message()).not.toBe(firstMessage)
  })

  test("preserves an existing session while retrying its prompt", async () => {
    const submission = createPromptSubmission()
    const sessionID = Session.ID.create()

    expect(await submission.begin(1n, sessionID)).toBe(sessionID)
    expect(await submission.begin(1n, sessionID)).toBe(sessionID)
  })

  test("starts a new identity after completion", async () => {
    const submission = createPromptSubmission()
    const first = await submission.begin(1n)
    submission.complete()

    expect(await submission.begin(1n)).not.toBe(first)
  })
})
