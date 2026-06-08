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
