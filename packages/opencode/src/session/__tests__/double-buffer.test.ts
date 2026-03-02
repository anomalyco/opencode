import { describe, test, expect, beforeEach } from "bun:test"
import { DoubleBuffer } from "../double-buffer"

describe("DoubleBuffer", () => {
  const sessionID = "test-session"

  beforeEach(() => {
    DoubleBuffer.resetState(sessionID)
  })

  test("starts in normal phase", () => {
    const state = DoubleBuffer.getState(sessionID)
    expect(state.phase).toBe("normal")
    expect(state.checkpointSummary).toBeNull()
    expect(state.generation).toBe(0)
  })

  test("beginCheckpoint transitions to checkpoint_pending", () => {
    DoubleBuffer.beginCheckpoint(sessionID, 10)
    const state = DoubleBuffer.getState(sessionID)
    expect(state.phase).toBe("checkpoint_pending")
    expect(state.checkpointMessageCount).toBe(10)
  })

  test("finishCheckpoint transitions to concurrent", () => {
    DoubleBuffer.beginCheckpoint(sessionID, 10)
    DoubleBuffer.finishCheckpoint(sessionID, "Summary of conversation so far")
    const state = DoubleBuffer.getState(sessionID)
    expect(state.phase).toBe("concurrent")
    expect(state.checkpointSummary).toBe("Summary of conversation so far")
    expect(state.generation).toBe(1)
  })

  test("completeSwap resets to normal", () => {
    DoubleBuffer.beginCheckpoint(sessionID, 10)
    DoubleBuffer.finishCheckpoint(sessionID, "Summary")
    DoubleBuffer.completeSwap(sessionID)
    const state = DoubleBuffer.getState(sessionID)
    expect(state.phase).toBe("normal")
    expect(state.checkpointSummary).toBeNull()
    expect(state.generation).toBe(1) // generation preserved
  })

  test("full lifecycle: normal -> checkpoint -> concurrent -> swap -> normal", () => {
    const state = DoubleBuffer.getState(sessionID)
    expect(state.phase).toBe("normal")

    DoubleBuffer.beginCheckpoint(sessionID, 5)
    expect(state.phase).toBe("checkpoint_pending")

    DoubleBuffer.finishCheckpoint(sessionID, "Checkpoint summary")
    expect(state.phase).toBe("concurrent")
    expect(state.generation).toBe(1)

    DoubleBuffer.completeSwap(sessionID)
    expect(state.phase).toBe("normal")
    expect(state.checkpointSummary).toBeNull()
    expect(state.generation).toBe(1)
  })

  test("multiple generations increment correctly", () => {
    for (let i = 0; i < 3; i++) {
      DoubleBuffer.beginCheckpoint(sessionID, 10)
      DoubleBuffer.finishCheckpoint(sessionID, `Summary gen ${i + 1}`)
      DoubleBuffer.completeSwap(sessionID)
    }
    const state = DoubleBuffer.getState(sessionID)
    expect(state.generation).toBe(3)
  })

  test("resetState clears everything", () => {
    DoubleBuffer.beginCheckpoint(sessionID, 10)
    DoubleBuffer.finishCheckpoint(sessionID, "Summary")
    DoubleBuffer.resetState(sessionID)
    const state = DoubleBuffer.getState(sessionID)
    expect(state.phase).toBe("normal")
    expect(state.generation).toBe(0)
  })
})
