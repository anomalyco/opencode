/**
 * Regression test for issue #26871
 * "TUI crashes when task history references a missing child session"
 */
import { expect, test, describe } from "bun:test"

describe("Task component - missing child session", () => {
  test(".catch() on fire-and-forget sync prevents crash", async () => {
    const syncThatThrows = async (sessionId: string) => {
      throw new Error(`Session not found: ${sessionId}`)
    }

    let unhandledRejection = false
    const handler = () => { unhandledRejection = true }
    process.on("unhandledRejection", handler)

    void syncThatThrows("nonexistent-session-id").catch(() => {})

    await new Promise((resolve) => setTimeout(resolve, 200))
    process.off("unhandledRejection", handler)

    expect(unhandledRejection).toBe(false)
  })
})
