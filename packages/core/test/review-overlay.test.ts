import { describe, expect, it } from "bun:test"
import { ReviewOverlay } from "../src/review-overlay"

describe("ReviewOverlay", () => {
  ReviewOverlay.reset()

  it("stage and get", () => {
    ReviewOverlay.setEnabled(true)
    ReviewOverlay.setActiveSession("sess-1")
    ReviewOverlay.stage("/tmp/foo.ts", "hello")
    expect(ReviewOverlay.get("/tmp/foo.ts")).toEqual({ content: "hello" })
    expect(ReviewOverlay.has("/tmp/foo.ts")).toBe(true)
  })

  it("drainPendingWrites", () => {
    ReviewOverlay.reset()
    ReviewOverlay.setEnabled(true)
    ReviewOverlay.setActiveSession("sess-1")
    ReviewOverlay.stage("/tmp/a.ts", "a")
    ReviewOverlay.stage("/tmp/b.ts", "b")
    const drained = ReviewOverlay.drainPendingWrites()
    expect(drained).toEqual([
      { sessionID: "sess-1", path: expect.stringContaining("a.ts"), content: "a" },
      { sessionID: "sess-1", path: expect.stringContaining("b.ts"), content: "b" },
    ])
    expect(ReviewOverlay.drainPendingWrites()).toEqual([])
  })

  it("markDeleted", () => {
    ReviewOverlay.reset()
    ReviewOverlay.stage("/tmp/gone.ts", "soon deleted")
    ReviewOverlay.markDeleted("/tmp/gone.ts")
    expect(ReviewOverlay.get("/tmp/gone.ts")).toEqual({ deleted: true })
    expect(ReviewOverlay.has("/tmp/gone.ts")).toBe(true)
  })

  it("enqueueUnflushed recovers staged content without pending queue", () => {
    ReviewOverlay.reset()
    ReviewOverlay.setEnabled(true)
    ReviewOverlay.stage("/tmp/recover.ts", "staged")
    expect(ReviewOverlay.drainPendingWrites()).toEqual([])
    ReviewOverlay.enqueueUnflushed("sess-2")
    expect(ReviewOverlay.drainPendingWrites()).toEqual([
      { sessionID: "sess-2", path: expect.stringContaining("recover.ts"), content: "staged" },
    ])
  })

  it("clear", () => {
    ReviewOverlay.reset()
    ReviewOverlay.setActiveSession("sess-1")
    ReviewOverlay.stage("/tmp/x.ts", "x")
    ReviewOverlay.clear()
    expect(ReviewOverlay.has("/tmp/x.ts")).toBe(false)
    expect(ReviewOverlay.drainPendingWrites()).toEqual([])
  })
})
