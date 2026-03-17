import { describe, expect, mock, test } from "bun:test"
import { shouldResume, syncSession } from "../../../src/cli/cmd/tui/routes/session/resume"

describe("tui session resume", () => {
  test("skips resume when the route opts out", () => {
    expect(shouldResume({ sessionID: "ses_1", resume: false })).toBe(false)
  })

  test("skips resume after the session was already resumed", () => {
    expect(shouldResume({ sessionID: "ses_1", resumed: "ses_1" })).toBe(false)
  })

  test("resumes once after sync succeeds", async () => {
    const calls: string[] = []
    const result = await syncSession({
      sessionID: "ses_1",
      sync: async (sessionID) => {
        calls.push(`sync:${sessionID}`)
      },
      resumeSession: async ({ sessionID }) => {
        calls.push(`resume:${sessionID}`)
      },
      onScroll: () => {
        calls.push("scroll")
      },
      onResumeError: () => {
        calls.push("resume-error")
      },
      onSyncError: () => {
        calls.push("sync-error")
      },
      onMissing: () => {
        calls.push("missing")
      },
    })

    expect(result).toBe("ses_1")
    expect(calls).toEqual(["sync:ses_1", "scroll", "resume:ses_1"])
  })

  test("clears resumed state when resume fails so it can retry", async () => {
    const err = new Error("boom")
    const onResumeError = mock(() => {})

    const result = await syncSession({
      sessionID: "ses_1",
      resumed: "ses_old",
      sync: async () => {},
      resumeSession: async () => {
        throw err
      },
      onResumeError,
      onSyncError: mock(() => {}),
      onMissing: mock(() => {}),
    })

    expect(result).toBeUndefined()
    expect(onResumeError).toHaveBeenCalledWith(err)
  })

  test("shows missing-session flow when sync fails", async () => {
    const err = new Error("missing")
    const onSyncError = mock(() => {})
    const onMissing = mock(() => {})

    const result = await syncSession({
      sessionID: "ses_1",
      resumed: "ses_prev",
      sync: async () => {
        throw err
      },
      resumeSession: async () => {},
      onResumeError: mock(() => {}),
      onSyncError,
      onMissing,
    })

    expect(result).toBe("ses_prev")
    expect(onSyncError).toHaveBeenCalledWith(err)
    expect(onMissing).toHaveBeenCalledTimes(1)
  })
})
