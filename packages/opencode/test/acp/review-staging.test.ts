import { afterEach, describe, expect, it } from "bun:test"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"
import { flushPendingWrites } from "@/acp/review-staging"
import { reset, setClientWriteTextFileSupported, syncEnabled } from "@/acp/review-mode"

describe("ACPReviewStaging", () => {
  afterEach(() => {
    delete process.env.OPENCODE_ACP_REVIEW
    delete process.env.OPENCODE_CLIENT
    reset()
  })

  it("awaits one writeTextFile per staged path", async () => {
    process.env.OPENCODE_ACP_REVIEW = "1"
    process.env.OPENCODE_CLIENT = "acp"
    setClientWriteTextFileSupported(true)
    syncEnabled()

    ReviewOverlay.setActiveSession("sess-1")
    ReviewOverlay.stage("/tmp/a.ts", "a")
    ReviewOverlay.stage("/tmp/b.ts", "b")

    const calls: Array<{ sessionId: string; path: string; content: string }> = []
    await flushPendingWrites({
      writeTextFile: async (input) => {
        calls.push(input)
        return {}
      },
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.sessionId).toBe("sess-1")
    expect(calls[0]?.content).toBe("a")
    expect(calls[1]?.content).toBe("b")
    expect(ReviewOverlay.drainPendingWrites()).toEqual([])
  })

  it("recovers staged files when session was set late", async () => {
    process.env.OPENCODE_ACP_REVIEW = "1"
    process.env.OPENCODE_CLIENT = "acp"
    setClientWriteTextFileSupported(true)
    syncEnabled()

    ReviewOverlay.stage("/tmp/late.ts", "late content")

    const calls: Array<{ sessionId: string; path: string; content: string }> = []
    await flushPendingWrites(
      {
        writeTextFile: async (input) => {
          calls.push(input)
          return {}
        },
      },
      "sess-late",
    )

    expect(calls).toEqual([
      {
        sessionId: "sess-late",
        path: expect.stringContaining("late.ts"),
        content: "late content",
      },
    ])
  })

  it("fails the flush and keeps the edit retryable when the client rejects the write", async () => {
    process.env.OPENCODE_ACP_REVIEW = "1"
    process.env.OPENCODE_CLIENT = "acp"
    setClientWriteTextFileSupported(true)
    syncEnabled()

    ReviewOverlay.setActiveSession("sess-reject")
    ReviewOverlay.stage("/tmp/rejected.ts", "content")

    let calls = 0
    await expect(
      flushPendingWrites({
        writeTextFile: async () => {
          calls++
          throw new Error("client refused write")
        },
      }),
    ).rejects.toThrow(/client rejected/)
    expect(calls).toBe(1)

    // The rejected write must not be marked flushed: end-of-turn recovery has to
    // re-queue it so the edit is not silently dropped while opencode never
    // writes it to disk in review mode.
    ReviewOverlay.enqueueUnflushed("sess-reject")
    expect(ReviewOverlay.drainPendingWrites()).toEqual([
      { sessionID: "sess-reject", path: expect.stringContaining("rejected.ts"), content: "content" },
    ])
  })

  it("serializes concurrent flushes so an in-flight write is not duplicated", async () => {
    process.env.OPENCODE_ACP_REVIEW = "1"
    process.env.OPENCODE_CLIENT = "acp"
    setClientWriteTextFileSupported(true)
    syncEnabled()

    ReviewOverlay.setActiveSession("sess-race")
    ReviewOverlay.stage("/tmp/race.ts", "content")

    const calls: string[] = []
    const connection = {
      writeTextFile: async (input: { sessionId: string; path: string; content: string }) => {
        calls.push(input.path)
        await new Promise((resolve) => setTimeout(resolve, 20))
        return {}
      },
    }

    // Kick off the per-tool flush and the end-of-turn flush without awaiting the
    // first. The end-of-turn flush must wait for the in-flight write to be marked
    // flushed rather than re-sending the same not-yet-acknowledged edit.
    const perTool = flushPendingWrites(connection, "sess-race")
    const endOfTurn = flushPendingWrites(connection, "sess-race")
    await Promise.all([perTool, endOfTurn])

    expect(calls).toHaveLength(1)
  })

  it("skips flush when review mode is inactive", async () => {
    ReviewOverlay.setEnabled(true)
    ReviewOverlay.setActiveSession("sess-1")
    ReviewOverlay.stage("/tmp/a.ts", "a")

    let called = false
    await flushPendingWrites({
      writeTextFile: async () => {
        called = true
        return {}
      },
    })

    expect(called).toBe(false)
    expect(ReviewOverlay.drainPendingWrites()).toHaveLength(1)
    ReviewOverlay.reset()
  })
})
