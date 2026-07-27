import { describe, expect, test } from "bun:test"
import type { SessionStatusStore } from "@opencode-ai/core/session/status-store"
import { deriveWriterStatus } from "../../src/session/status-derive"

// Above every platform's max PID, so signal 0 always reports ESRCH.
const DEAD_PID = 999_999_999
const time = { created: 1, updated: 2 }

function row(status: SessionStatusStore.Status, pid: number | null, detail?: string): SessionStatusStore.Row {
  return { sessionID: "ses_test", status, detail, pid, time }
}

describe("deriveWriterStatus", () => {
  test("keeps active statuses while the writer process is alive", () => {
    expect(deriveWriterStatus(row("working", process.pid)).status).toBe("working")
    expect(deriveWriterStatus(row("retrying", process.pid, "boom · attempt #2"))).toEqual({
      sessionID: "ses_test",
      status: "retrying",
      detail: "boom · attempt #2",
      time,
    })
    expect(deriveWriterStatus(row("needs_input", process.pid, "Approve?")).status).toBe("needs_input")
  })

  test("interrupts active statuses whose writer is gone", () => {
    expect(deriveWriterStatus(row("working", DEAD_PID)).status).toBe("interrupted")
    expect(deriveWriterStatus(row("retrying", DEAD_PID)).status).toBe("interrupted")
  })

  test("treats rows without a pid as written by dead processes", () => {
    expect(deriveWriterStatus(row("working", null)).status).toBe("interrupted")
  })

  test("a dead writer holding input becomes plain idle without the detail", () => {
    expect(deriveWriterStatus(row("needs_input", DEAD_PID, "Approve?"))).toEqual({
      sessionID: "ses_test",
      status: "idle",
      time,
    })
  })

  test("terminal statuses pass through regardless of the writer", () => {
    expect(deriveWriterStatus(row("done", DEAD_PID, "shipped it"))).toEqual({
      sessionID: "ses_test",
      status: "done",
      detail: "shipped it",
      time,
    })
    expect(deriveWriterStatus(row("idle", null)).status).toBe("idle")
  })
})
